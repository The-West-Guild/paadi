import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SettlementFailureReason } from "@paadi/contracts";
import {
  LedgerAccountKind,
  LedgerRepository,
  OutboxMessage,
  OutboxRepository,
  buildWithdrawalClearedPosting,
  buildWithdrawalPosting,
  buildWithdrawalReversePosting
} from "@paadi/domain";
import {
  Prisma,
  PrismaService,
  WithdrawalStatus as DbWithdrawalStatus
} from "@paadi/db";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";

const OUTBOX_TARGET = "user";
const INSUFFICIENT_WALLET_BALANCE = "insufficient wallet balance";

export interface RequestWithdrawalInput {
  userId: string;
  payoutAccountId: string;
  amountKobo: number;
  feeKobo: number;
  idempotencyKey: string;
}

export interface RequestWithdrawalResult {
  withdrawalId: string;
  merchantTxRef: string;
  amountKobo: number;
  feeKobo: number;
  netKobo: number;
  status: DbWithdrawalStatus;
  alreadyExisted: boolean;
}

export interface FinalizeWithdrawalInput {
  nombaRef: string | null;
  providerStatus: string | null;
}

export interface WithdrawalConfirmView {
  status: DbWithdrawalStatus;
  merchantTxRef: string;
  nombaRef: string | null;
}

@Injectable()
export class WithdrawalRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LedgerRepository) private readonly ledger: PrismaLedgerRepository,
    @Inject(OutboxRepository) private readonly outbox: PrismaOutboxRepository
  ) {}

  async requestWithdrawal(input: RequestWithdrawalInput): Promise<RequestWithdrawalResult> {
    return this.prisma.$transaction((tx) => this.requestWithdrawalTx(tx, input));
  }

  async markPending(withdrawalId: string, input: FinalizeWithdrawalInput): Promise<void> {
    await this.prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: DbWithdrawalStatus.PROCESSING,
        nombaRef: input.nombaRef,
        providerStatus: input.providerStatus
      }
    });
  }

  async findForConfirm(withdrawalId: string): Promise<WithdrawalConfirmView | null> {
    return this.prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      select: { status: true, merchantTxRef: true, nombaRef: true }
    });
  }

  async confirmWithdrawal(withdrawalId: string, input: FinalizeWithdrawalInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      if (withdrawal.status !== DbWithdrawalStatus.PROCESSING) {
        return;
      }
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${withdrawal.userId} FOR UPDATE`;
      const netKobo = Number(withdrawal.amountKobo - withdrawal.feeKobo);
      await this.ledger.record(buildWithdrawalClearedPosting({ netKobo }), tx);
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: DbWithdrawalStatus.COMPLETED,
          nombaRef: input.nombaRef ?? withdrawal.nombaRef,
          providerStatus: input.providerStatus ?? withdrawal.providerStatus,
          completedAt: new Date()
        }
      });
      await this.outbox.enqueue(
        this.withdrawalCompleted(withdrawal.userId, withdrawal.id, Number(withdrawal.amountKobo), input.nombaRef ?? withdrawal.nombaRef),
        tx
      );
      await this.outbox.enqueue(
        this.walletDebited(withdrawal.userId, Number(withdrawal.amountKobo), withdrawal.id),
        tx
      );
    });
  }

  async reverseWithdrawal(withdrawalId: string, reason: SettlementFailureReason): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      if (withdrawal.status !== DbWithdrawalStatus.PROCESSING) {
        return;
      }
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${withdrawal.userId} FOR UPDATE`;
      const netKobo = Number(withdrawal.amountKobo - withdrawal.feeKobo);
      const feeKobo = Number(withdrawal.feeKobo);
      await this.ledger.record(
        buildWithdrawalReversePosting({ userId: withdrawal.userId, netKobo, feeKobo }),
        tx
      );
      await tx.user.update({
        where: { id: withdrawal.userId },
        data: { walletBalanceKobo: { increment: withdrawal.amountKobo } }
      });
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: DbWithdrawalStatus.FAILED, failureReason: reason }
      });
      await this.outbox.enqueue(
        this.withdrawalFailed(withdrawal.userId, withdrawal.id, Number(withdrawal.amountKobo), reason),
        tx
      );
    });
  }

  private async requestWithdrawalTx(
    tx: Prisma.TransactionClient,
    input: RequestWithdrawalInput
  ): Promise<RequestWithdrawalResult> {
    const merchantTxRef = this.merchantTxRefFor(input.idempotencyKey);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;

    const existing = await tx.withdrawal.findUnique({ where: { merchantTxRef } });
    if (existing !== null) {
      const netKobo = Number(existing.amountKobo - existing.feeKobo);
      return {
        withdrawalId: existing.id,
        merchantTxRef,
        amountKobo: Number(existing.amountKobo),
        feeKobo: Number(existing.feeKobo),
        netKobo,
        status: existing.status,
        alreadyExisted: true
      };
    }

    const balanceKobo = await this.spendableBalance(tx, input.userId);
    if (balanceKobo < input.amountKobo) {
      throw new HttpException(INSUFFICIENT_WALLET_BALANCE, HttpStatus.PAYMENT_REQUIRED);
    }

    const netKobo = input.amountKobo - input.feeKobo;
    const withdrawal = await tx.withdrawal.create({
      data: {
        userId: input.userId,
        payoutAccountId: input.payoutAccountId,
        merchantTxRef,
        amountKobo: BigInt(input.amountKobo),
        feeKobo: BigInt(input.feeKobo),
        status: DbWithdrawalStatus.PROCESSING
      }
    });

    await this.ledger.record(
      buildWithdrawalPosting({ userId: input.userId, netKobo, feeKobo: input.feeKobo }),
      tx
    );

    await tx.user.update({
      where: { id: input.userId },
      data: { walletBalanceKobo: { decrement: BigInt(input.amountKobo) } }
    });

    return {
      withdrawalId: withdrawal.id,
      merchantTxRef,
      amountKobo: input.amountKobo,
      feeKobo: input.feeKobo,
      netKobo,
      status: withdrawal.status,
      alreadyExisted: false
    };
  }

  private async spendableBalance(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const account = await tx.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind: LedgerAccountKind.UserWallet, ownerRef: userId } },
      select: { id: true }
    });
    if (account === null) {
      return 0;
    }
    const net = await this.ledger.balance(account.id, tx);
    return Math.max(0, -net);
  }

  private merchantTxRefFor(idempotencyKey: string): string {
    return `wd:${idempotencyKey}`;
  }

  private walletDebited(userId: string, amountKobo: number, withdrawalId: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "wallet.debited", userId, amountKobo, reason: "withdrawal", withdrawalId },
      attempts: 0
    };
  }

  private withdrawalCompleted(
    userId: string,
    withdrawalId: string,
    amountKobo: number,
    nombaRef: string | null
  ): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "withdrawal.completed", userId, withdrawalId, amountKobo, nombaRef },
      attempts: 0
    };
  }

  private withdrawalFailed(
    userId: string,
    withdrawalId: string,
    amountKobo: number,
    reason: string
  ): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "withdrawal.failed", userId, withdrawalId, amountKobo, reason },
      attempts: 0
    };
  }
}
