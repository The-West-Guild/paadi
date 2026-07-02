import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ExceptionReason } from "@paadi/contracts";
import { OutboxMessage, OutboxRepository } from "@paadi/domain";
import {
  ExceptionReason as DbExceptionReason,
  ExceptionStatus,
  Prisma,
  PrismaService,
  ReconciliationException
} from "@paadi/db";
import { PrismaOutboxRepository } from "../../infra/persistence/outbox.repository";
import { toAmountKoboBigInt } from "../../infra/persistence/mappers/payment.mapper";

const OUTBOX_TARGET = "user";
const HOUSE_SUSPENSE_OWNER = "house";

export interface RaiseExceptionInput {
  nombaTransactionId: string;
  amountKobo: number;
  reason: ExceptionReason;
  senderName?: string;
  senderAccount?: string;
  senderBank?: string;
  senderBankCode?: string;
  vaAccountNumber?: string;
  suspenseOwnerRef?: string;
  ledgerTxnId?: string;
}

@Injectable()
export class RaiseExceptionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OutboxRepository) private readonly outbox: PrismaOutboxRepository
  ) {}

  async raiseException(
    input: RaiseExceptionInput,
    tx?: Prisma.TransactionClient
  ): Promise<ReconciliationException> {
    if (tx) {
      return this.insert(tx, input);
    }
    return this.prisma.$transaction((client) => this.insert(client, input));
  }

  private async insert(
    client: Prisma.TransactionClient,
    input: RaiseExceptionInput
  ): Promise<ReconciliationException> {
    try {
      const exception = await client.reconciliationException.create({
        data: {
          nombaTransactionId: input.nombaTransactionId,
          amountKobo: toAmountKoboBigInt(input.amountKobo),
          reason: input.reason as DbExceptionReason,
          status: ExceptionStatus.OPEN,
          senderName: input.senderName ?? null,
          senderAccount: input.senderAccount ?? null,
          senderBank: input.senderBank ?? null,
          senderBankCode: input.senderBankCode ?? null,
          vaAccountNumber: input.vaAccountNumber ?? null,
          suspenseOwnerRef: input.suspenseOwnerRef ?? HOUSE_SUSPENSE_OWNER,
          ledgerTxnId: input.ledgerTxnId ?? null
        }
      });
      await this.outbox.enqueue(this.raised(exception.id, input.amountKobo, input.reason), client);
      return exception;
    } catch (error) {
      if (this.isDuplicateTransaction(error)) {
        return this.prisma.$transaction((fresh) =>
          fresh.reconciliationException.findUniqueOrThrow({
            where: { nombaTransactionId: input.nombaTransactionId }
          })
        );
      }
      throw error;
    }
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

  private raised(exceptionId: string, amountKobo: number, reason: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "exception.raised", exceptionId, amountKobo, reason },
      attempts: 0
    };
  }
}
