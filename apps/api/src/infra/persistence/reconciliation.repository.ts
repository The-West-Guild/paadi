import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ExceptionResolutionAction, ExceptionStatus } from "@paadi/contracts";
import {
  LedgerRepository,
  OutboxMessage,
  OutboxRepository,
  buildExceptionAssignmentPosting,
  buildExceptionRefundPosting,
  buildSuspensePosting
} from "@paadi/domain";
import {
  ExceptionReason as DbExceptionReason,
  ExceptionStatus as DbExceptionStatus,
  Prisma,
  PrismaService,
  ReconciliationException
} from "@paadi/db";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";

const OUTBOX_TARGET = "user";
const REFUND_STATUS_PENDING = "PENDING";
const REFUND_STATUS_FAILED = "FAILED";
const REFUND_REF_PREFIX = "rcx_";

export interface AssignExceptionInput {
  userId: string;
  resolvedBy: string;
  note?: string;
}

export interface RefundExceptionInput {
  senderAccount: string;
  bankCode: string;
  senderName: string;
  resolvedBy: string;
  note?: string;
}

export interface HoldExceptionInput {
  resolvedBy: string;
  matchedUserId?: string;
  note?: string;
}

export interface RefundResolution {
  exception: ReconciliationException;
  merchantTxRef: string;
  senderAccount: string;
  bankCode: string;
  senderName: string;
  amountKobo: number;
}

export interface RecordRefundOutcomeInput {
  refundStatus: string;
  refundNombaRef?: string;
}

export interface ListExceptionsFilter {
  status?: ExceptionStatus;
  reason?: string;
  cursor?: string;
  limit: number;
}

export interface ListExceptionsPage {
  items: ReconciliationException[];
  nextCursor: string | null;
}

export interface ExceptionTotals {
  openCount: number;
  openAmountKobo: number;
}

@Injectable()
export class ReconciliationRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LedgerRepository) private readonly ledger: PrismaLedgerRepository,
    @Inject(OutboxRepository) private readonly outbox: PrismaOutboxRepository
  ) {}

  findById(exceptionId: string): Promise<ReconciliationException | null> {
    return this.prisma.reconciliationException.findUnique({ where: { id: exceptionId } });
  }

  async assign(exceptionId: string, input: AssignExceptionInput): Promise<ReconciliationException> {
    return this.prisma.$transaction(async (tx) => {
      const exception = await this.lockOpen(tx, exceptionId);
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } });
      if (!user) {
        throw new NotFoundException("user not found");
      }
      await this.ledger.record(
        buildExceptionAssignmentPosting({
          userId: input.userId,
          amountKobo: Number(exception.amountKobo),
          suspenseOwnerRef: exception.suspenseOwnerRef
        }),
        tx
      );
      await tx.user.update({
        where: { id: input.userId },
        data: { walletBalanceKobo: { increment: exception.amountKobo } }
      });
      const resolved = await tx.reconciliationException.update({
        where: { id: exceptionId },
        data: {
          status: DbExceptionStatus.RESOLVED,
          matchedUserId: input.userId,
          resolvedBy: input.resolvedBy,
          resolvedAt: new Date(),
          note: input.note ?? exception.note
        }
      });
      await this.outbox.enqueue(
        this.resolved(exceptionId, ExceptionResolutionAction.Assign, Number(exception.amountKobo), input.userId),
        tx
      );
      return resolved;
    });
  }

  async refund(exceptionId: string, input: RefundExceptionInput): Promise<RefundResolution> {
    return this.prisma.$transaction(async (tx) => {
      const exception = await this.lockOpen(tx, exceptionId);
      const merchantTxRef = `${REFUND_REF_PREFIX}${exceptionId}`;
      await this.ledger.record(
        buildExceptionRefundPosting({
          amountKobo: Number(exception.amountKobo),
          suspenseOwnerRef: exception.suspenseOwnerRef
        }),
        tx
      );
      const resolved = await tx.reconciliationException.update({
        where: { id: exceptionId },
        data: {
          status: DbExceptionStatus.REFUNDED,
          resolvedBy: input.resolvedBy,
          resolvedAt: new Date(),
          refundMerchantTxRef: merchantTxRef,
          refundStatus: REFUND_STATUS_PENDING,
          note: input.note ?? exception.note
        }
      });
      await this.outbox.enqueue(
        this.resolved(exceptionId, ExceptionResolutionAction.Refund, Number(exception.amountKobo)),
        tx
      );
      return {
        exception: resolved,
        merchantTxRef,
        senderAccount: input.senderAccount,
        bankCode: input.bankCode,
        senderName: input.senderName,
        amountKobo: Number(exception.amountKobo)
      };
    });
  }

  async hold(exceptionId: string, input: HoldExceptionInput): Promise<ReconciliationException> {
    return this.prisma.$transaction(async (tx) => {
      const exception = await this.lockOpen(tx, exceptionId);
      return tx.reconciliationException.update({
        where: { id: exceptionId },
        data: {
          note: input.note ?? exception.note,
          matchedUserId: input.matchedUserId ?? exception.matchedUserId
        }
      });
    });
  }

  recordRefundOutcome(
    exceptionId: string,
    input: RecordRefundOutcomeInput
  ): Promise<ReconciliationException> {
    return this.prisma.reconciliationException.update({
      where: { id: exceptionId },
      data: {
        refundStatus: input.refundStatus,
        refundNombaRef: input.refundNombaRef ?? null
      }
    });
  }

  async reopenAfterFailedRefund(exceptionId: string): Promise<ReconciliationException> {
    return this.prisma.$transaction(async (tx) => {
      const exception = await this.lockRow(tx, exceptionId);
      await this.ledger.record(
        buildSuspensePosting({ potId: null, amountKobo: Number(exception.amountKobo) }),
        tx
      );
      return tx.reconciliationException.update({
        where: { id: exceptionId },
        data: {
          status: DbExceptionStatus.OPEN,
          refundStatus: REFUND_STATUS_FAILED,
          refundMerchantTxRef: null
        }
      });
    });
  }

  async list(filter: ListExceptionsFilter): Promise<ListExceptionsPage> {
    const where: Prisma.ReconciliationExceptionWhereInput = {};
    if (filter.status) {
      where.status = filter.status as DbExceptionStatus;
    }
    if (filter.reason) {
      where.reason = filter.reason as DbExceptionReason;
    }
    const rows = await this.prisma.reconciliationException.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {})
    });
    const hasMore = rows.length > filter.limit;
    const items = hasMore ? rows.slice(0, filter.limit) : rows;
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null
    };
  }

  async totals(): Promise<ExceptionTotals> {
    const result = await this.prisma.reconciliationException.aggregate({
      where: { status: DbExceptionStatus.OPEN },
      _count: { _all: true },
      _sum: { amountKobo: true }
    });
    return {
      openCount: result._count._all,
      openAmountKobo: Number(result._sum.amountKobo ?? 0n)
    };
  }

  private async lockOpen(
    tx: Prisma.TransactionClient,
    exceptionId: string
  ): Promise<ReconciliationException> {
    const exception = await this.lockRow(tx, exceptionId);
    if (exception.status !== DbExceptionStatus.OPEN) {
      throw new ConflictException("exception already resolved");
    }
    return exception;
  }

  private async lockRow(
    tx: Prisma.TransactionClient,
    exceptionId: string
  ): Promise<ReconciliationException> {
    await tx.$queryRaw`SELECT id FROM "ReconciliationException" WHERE id = ${exceptionId} FOR UPDATE`;
    const exception = await tx.reconciliationException.findUnique({ where: { id: exceptionId } });
    if (!exception) {
      throw new NotFoundException("exception not found");
    }
    return exception;
  }

  private resolved(
    exceptionId: string,
    action: string,
    amountKobo: number,
    userId?: string
  ): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "exception.resolved", exceptionId, action, amountKobo, userId },
      attempts: 0
    };
  }
}
