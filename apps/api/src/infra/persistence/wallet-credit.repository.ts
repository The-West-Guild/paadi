import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ExceptionReason, PaymentRecordStatus } from "@paadi/contracts";
import {
  LedgerRepository,
  OutboxMessage,
  OutboxRepository,
  buildSuspensePosting,
  buildWalletCreditPosting
} from "@paadi/domain";
import { Prisma, PrismaService } from "@paadi/db";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";
import { RaiseExceptionService } from "../../modules/reconciliation/raise-exception.service";
import { toAmountKoboBigInt } from "./mappers/payment.mapper";

const OUTBOX_TARGET = "user";
const HOUSE_SUSPENSE_OWNER = "house";

export interface CreditWalletInput {
  userId: string;
  virtualAccountId: string | null;
  nombaTransactionId: string;
  amountKobo: number;
  senderName: string | null;
  senderAccount: string | null;
  senderBank: string | null;
  senderBankCode: string | null;
  rawEventId: string;
}

export interface CreditWalletResult {
  walletCreditId: string | null;
  userId: string;
  amountKobo: number;
  alreadyProcessed: boolean;
}

export interface RecordUnmatchedInput {
  webhookEventInId: string;
  accountNumber: string | null;
  nombaTransactionId: string;
  amountKobo: number;
  reason: ExceptionReason | PaymentRecordStatus;
  senderName: string | null;
  senderAccount: string | null;
  senderBank: string | null;
}

export interface RecordUnmatchedResult {
  reason: ExceptionReason | PaymentRecordStatus;
  accountNumber: string | null;
  nombaTransactionId: string;
  amountKobo: number;
  exceptionId: string;
}

const EXCEPTION_REASON_BY_RESULT_STATUS: Partial<Record<PaymentRecordStatus, ExceptionReason>> = {
  [PaymentRecordStatus.AmountMismatch]: ExceptionReason.AmountMismatch
};

function toExceptionReason(reason: ExceptionReason | PaymentRecordStatus): ExceptionReason {
  return EXCEPTION_REASON_BY_RESULT_STATUS[reason as PaymentRecordStatus] ?? (reason as ExceptionReason);
}

@Injectable()
export class WalletCreditRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LedgerRepository) private readonly ledger: PrismaLedgerRepository,
    @Inject(OutboxRepository) private readonly outbox: PrismaOutboxRepository,
    private readonly raiseException: RaiseExceptionService
  ) {}

  async creditWallet(input: CreditWalletInput): Promise<CreditWalletResult> {
    try {
      return await this.prisma.$transaction((tx) => this.runCredit(tx, input));
    } catch (error) {
      if (this.isDuplicateTransaction(error)) {
        await this.markProcessedAfterRollback(input.rawEventId);
        return {
          walletCreditId: null,
          userId: input.userId,
          amountKobo: input.amountKobo,
          alreadyProcessed: true
        };
      }
      throw error;
    }
  }

  async recordUnmatched(input: RecordUnmatchedInput): Promise<RecordUnmatchedResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.ledger.record(buildSuspensePosting({ potId: null, amountKobo: input.amountKobo }), tx);
      const exception = await this.raiseException.raiseException(
        {
          nombaTransactionId: input.nombaTransactionId,
          amountKobo: input.amountKobo,
          reason: toExceptionReason(input.reason),
          senderName: input.senderName ?? undefined,
          senderAccount: input.senderAccount ?? undefined,
          senderBank: input.senderBank ?? undefined,
          vaAccountNumber: input.accountNumber ?? undefined,
          suspenseOwnerRef: HOUSE_SUSPENSE_OWNER
        },
        tx
      );
      await this.outbox.enqueue(
        this.creditUnmatched(input.reason, input.accountNumber, input.nombaTransactionId, input.amountKobo),
        tx
      );
      await this.markProcessed(tx, input.webhookEventInId);
      return {
        reason: input.reason,
        accountNumber: input.accountNumber,
        nombaTransactionId: input.nombaTransactionId,
        amountKobo: input.amountKobo,
        exceptionId: exception.id
      };
    });
  }

  private async runCredit(
    tx: Prisma.TransactionClient,
    input: CreditWalletInput
  ): Promise<CreditWalletResult> {
    const walletCredit = await tx.walletCredit.create({
      data: {
        userId: input.userId,
        virtualAccountId: input.virtualAccountId,
        nombaTransactionId: input.nombaTransactionId,
        amountKobo: toAmountKoboBigInt(input.amountKobo),
        senderName: input.senderName,
        senderAccount: input.senderAccount,
        senderBank: input.senderBank,
        senderBankCode: input.senderBankCode,
        rawEventId: input.rawEventId,
        status: "succeeded"
      }
    });

    await this.ledger.record(
      buildWalletCreditPosting({ userId: input.userId, amountKobo: input.amountKobo }),
      tx
    );

    await tx.user.update({
      where: { id: input.userId },
      data: { walletBalanceKobo: { increment: toAmountKoboBigInt(input.amountKobo) } }
    });

    await this.outbox.enqueue(
      this.credited(input.userId, input.amountKobo, input.nombaTransactionId),
      tx
    );

    await this.markProcessed(tx, input.rawEventId);

    return {
      walletCreditId: walletCredit.id,
      userId: input.userId,
      amountKobo: input.amountKobo,
      alreadyProcessed: false
    };
  }

  private isDuplicateTransaction(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return false;
    }
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.some((field) => String(field).includes("nombaTransactionId"));
    }
    return typeof target === "string" && target.includes("nombaTransactionId");
  }

  private markProcessedAfterRollback(webhookEventInId: string): Promise<unknown> {
    return this.prisma.webhookEventIn.update({
      where: { id: webhookEventInId },
      data: { processedAt: new Date() }
    });
  }

  private markProcessed(tx: Prisma.TransactionClient, webhookEventInId: string): Promise<unknown> {
    return tx.webhookEventIn.update({
      where: { id: webhookEventInId },
      data: { processedAt: new Date() }
    });
  }

  private credited(userId: string, amountKobo: number, nombaTransactionId: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "wallet.credited", userId, amountKobo, nombaTransactionId },
      attempts: 0
    };
  }

  private creditUnmatched(
    reason: string,
    accountNumber: string | null,
    nombaTransactionId: string,
    amountKobo: number
  ): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "wallet.credit_unmatched", reason, accountNumber, nombaTransactionId, amountKobo },
      attempts: 0
    };
  }
}
