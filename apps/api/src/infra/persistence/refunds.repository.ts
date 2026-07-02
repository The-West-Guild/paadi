import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PaymentRecordStatus, PoolState } from "@paadi/contracts";
import {
  LedgerAccountKind,
  LedgerRepository,
  OutboxMessage,
  OutboxRepository,
  assertPoolTransition,
  buildRefundClearedPosting,
  buildRefundPosting
} from "@paadi/domain";
import {
  PotStatus as DbPotStatus,
  Prisma,
  PrismaService,
  RefundStatus as DbRefundStatus
} from "@paadi/db";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";
import { toAmountKoboBigInt } from "./mappers/payment.mapper";

const OUTBOX_TARGET = "organizer";
const REFUNDABLE_PAYMENT_STATUSES = [PaymentRecordStatus.Succeeded, PaymentRecordStatus.OverCollection];

export interface RefundTarget {
  refundId: string;
  merchantTxRef: string;
  paymentId: string;
  nombaTransactionId: string;
  amountKobo: number;
}

export interface BeginRefundResult {
  potId: string;
  targets: RefundTarget[];
}

export interface RecordRefundInput {
  potId: string;
  refundId: string;
  nombaRef: string | null;
}

@Injectable()
export class RefundsRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LedgerRepository) private readonly ledger: PrismaLedgerRepository,
    @Inject(OutboxRepository) private readonly outbox: PrismaOutboxRepository
  ) {}

  async beginRefund(potId: string): Promise<BeginRefundResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Pot" WHERE id = ${potId} FOR UPDATE`;
      const pot = await tx.pot.findUniqueOrThrow({ where: { id: potId } });

      if (pot.status === DbPotStatus.REFUNDED) {
        return { potId, targets: [] };
      }

      const payments = await tx.payment.findMany({
        where: { potId, status: { in: REFUNDABLE_PAYMENT_STATUSES } },
        orderBy: { createdAt: "asc" }
      });

      if (pot.status !== DbPotStatus.REFUNDING) {
        this.enterRefunding(pot.status);
        await this.drawDownLedger(tx, potId, Number(pot.collectedKobo), payments);
        await tx.pot.update({ where: { id: potId }, data: { status: DbPotStatus.REFUNDING } });
      }

      const targets: RefundTarget[] = [];
      for (const payment of payments) {
        const refund = await this.upsertRefund(tx, {
          potId,
          paymentId: payment.id,
          merchantTxRef: `refund:${payment.id}`,
          amountKobo: Number(payment.amountKobo)
        });
        if (refund.status === DbRefundStatus.COMPLETED) {
          continue;
        }
        targets.push({
          refundId: refund.id,
          merchantTxRef: refund.merchantTxRef,
          paymentId: payment.id,
          nombaTransactionId: payment.nombaTransactionId,
          amountKobo: Number(refund.amountKobo)
        });
      }

      return { potId, targets };
    });
  }

  private async drawDownLedger(
    tx: Prisma.TransactionClient,
    potId: string,
    liabilityKobo: number,
    payments: { amountKobo: bigint }[]
  ): Promise<void> {
    const grossInKobo = payments.reduce((sum, payment) => sum + Number(payment.amountKobo), 0);
    const suspenseKobo = grossInKobo - liabilityKobo;
    if (liabilityKobo > 0) {
      await this.ledger.record(buildRefundPosting({ potId, fromSuspense: false, amountKobo: liabilityKobo }), tx);
    }
    if (suspenseKobo > 0) {
      await this.ledger.record(buildRefundPosting({ potId, fromSuspense: true, amountKobo: suspenseKobo }), tx);
    }
    const clearedKobo = liabilityKobo + suspenseKobo;
    if (clearedKobo > 0) {
      await this.ledger.record(buildRefundClearedPosting({ potId, amountKobo: clearedKobo }), tx);
    }
  }

  async recordRefundCleared(input: RecordRefundInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Pot" WHERE id = ${input.potId} FOR UPDATE`;
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: input.refundId } });
      if (refund.status === DbRefundStatus.COMPLETED) {
        return;
      }

      await tx.refund.update({
        where: { id: input.refundId },
        data: { status: DbRefundStatus.COMPLETED, nombaRef: input.nombaRef, refundedAt: new Date() }
      });

      await this.settleIfFullyRefunded(tx, input.potId);
    });
  }

  async recordRefundFailed(refundId: string, failureReason: string): Promise<void> {
    await this.prisma.refund.update({
      where: { id: refundId },
      data: { status: DbRefundStatus.FAILED, failureReason }
    });
  }

  private async upsertRefund(
    tx: Prisma.TransactionClient,
    input: { potId: string; paymentId: string; merchantTxRef: string; amountKobo: number }
  ) {
    return tx.refund.upsert({
      where: { merchantTxRef: input.merchantTxRef },
      create: {
        id: randomUUID(),
        potId: input.potId,
        paymentId: input.paymentId,
        merchantTxRef: input.merchantTxRef,
        amountKobo: toAmountKoboBigInt(input.amountKobo),
        status: DbRefundStatus.PROCESSING
      },
      update: {}
    });
  }

  private async settleIfFullyRefunded(tx: Prisma.TransactionClient, potId: string): Promise<void> {
    const outstanding = await tx.refund.count({
      where: { potId, status: { not: DbRefundStatus.COMPLETED } }
    });
    if (outstanding > 0) {
      return;
    }

    const liabilityKobo = await this.accountBalance(tx, LedgerAccountKind.PotLiability, potId);
    if (liabilityKobo !== 0) {
      return;
    }

    const pot = await tx.pot.findUniqueOrThrow({ where: { id: potId } });
    if (pot.status !== DbPotStatus.REFUNDING) {
      return;
    }
    assertPoolTransition(PoolState.Refunding, PoolState.Refunded);
    await tx.pot.update({ where: { id: potId }, data: { status: DbPotStatus.REFUNDED } });
    await this.outbox.enqueue(this.poolRefunded(potId), tx);
  }

  private enterRefunding(status: DbPotStatus): void {
    const from =
      status === DbPotStatus.EXPIRED
        ? PoolState.Expired
        : status === DbPotStatus.CANCELLED
          ? PoolState.Cancelled
          : status === DbPotStatus.FUNDED
            ? PoolState.Funded
            : (status.toLowerCase() as PoolState);
    assertPoolTransition(from, PoolState.Refunding);
  }

  private async accountBalance(
    tx: Prisma.TransactionClient,
    kind: LedgerAccountKind,
    ownerRef: string
  ): Promise<number> {
    const account = await tx.ledgerAccount.findUnique({ where: { kind_ownerRef: { kind, ownerRef } } });
    if (!account) {
      return 0;
    }
    return this.ledger.balance(account.id, tx);
  }

  private poolRefunded(potId: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "pool.refunded", potId },
      attempts: 0
    };
  }
}
