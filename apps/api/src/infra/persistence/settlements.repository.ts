import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  BillerCategory,
  CompletionRule,
  MeterType,
  PoolState,
  SettlementFailureReason,
  SettlementType
} from "@paadi/contracts";
import {
  LedgerRepository,
  OutboxMessage,
  OutboxRepository,
  assertPoolTransition,
  buildPayoutClearedPosting,
  buildSettlementPosting,
  buildSettlementReversePosting,
  buildWalletSettlementPosting
} from "@paadi/domain";
import {
  Prisma,
  PrismaService,
  PotStatus as DbPotStatus,
  SettlementStatus as DbSettlementStatus,
  SettlementType as DbSettlementType
} from "@paadi/db";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";
import { toAmountKoboBigInt } from "./mappers/payment.mapper";

const OUTBOX_TARGET = "organizer";

export interface SettlementContext {
  potId: string;
  creatorId: string;
  settlementType: SettlementType;
  collectedKobo: number;
  feeKobo: number;
  completionRule: CompletionRule;
  payoutAccountId: string | null;
  billerCategory: BillerCategory | null;
  billerProductCode: string | null;
  billerCustomerId: string | null;
  meterType: MeterType | null;
  billerMeta: Record<string, string>;
}

export interface BeginSettlementResult {
  settlementId: string;
  merchantTxRef: string;
  alreadyTerminal: boolean;
  context: SettlementContext;
}

export interface SettledOutcome {
  kind: "settled";
  netKobo: number;
  feeKobo: number;
  vendToken: string | null;
  vendUnits: string | null;
  nombaRef: string | null;
  providerStatus: string | null;
}

export interface PendingOutcome {
  kind: "pending";
  netKobo: number;
  feeKobo: number;
  nombaRef: string | null;
  providerStatus: string | null;
}

export type SettlementOutcome = SettledOutcome | PendingOutcome;

export interface FinalizeSettlementResult {
  settlementId: string;
  status: DbSettlementStatus;
  awaitingConfirmation: boolean;
}

@Injectable()
export class SettlementsRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LedgerRepository) private readonly ledger: PrismaLedgerRepository,
    @Inject(OutboxRepository) private readonly outbox: PrismaOutboxRepository
  ) {}

  async beginSettlement(potId: string): Promise<BeginSettlementResult> {
    return this.prisma.$transaction((tx) => this.beginSettlementTx(tx, potId));
  }

  async finalizeSettlement(
    potId: string,
    outcome: SettlementOutcome
  ): Promise<FinalizeSettlementResult> {
    return this.prisma.$transaction((tx) => this.finalizeSettlementTx(tx, potId, outcome));
  }

  async failSettlement(potId: string, reason: SettlementFailureReason): Promise<void> {
    await this.prisma.$transaction((tx) => this.failSettlementTx(tx, potId, reason));
  }

  async findSettlementForConfirm(
    settlementId: string
  ): Promise<{ status: DbSettlementStatus; merchantTxRef: string; nombaRef: string | null } | null> {
    return this.prisma.settlement.findUnique({
      where: { id: settlementId },
      select: { status: true, merchantTxRef: true, nombaRef: true }
    });
  }

  async confirmPayout(settlementId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUniqueOrThrow({ where: { id: settlementId } });
      if (settlement.status !== DbSettlementStatus.PROCESSING) {
        return;
      }
      await tx.$queryRaw`SELECT id FROM "Pot" WHERE id = ${settlement.potId} FOR UPDATE`;
      const netKobo = Number(settlement.amountKobo - settlement.feeKobo);
      await this.ledger.record(buildPayoutClearedPosting({ netKobo }), tx);
      await this.completeSettlement(tx, settlement.potId, settlement.id, {
        kind: "settled",
        netKobo,
        feeKobo: Number(settlement.feeKobo),
        vendToken: settlement.vendToken,
        vendUnits: settlement.vendUnits,
        nombaRef: settlement.nombaRef,
        providerStatus: settlement.providerStatus
      });
    });
  }

  async reversePayout(settlementId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.findUniqueOrThrow({ where: { id: settlementId } });
      if (settlement.status !== DbSettlementStatus.PROCESSING) {
        return;
      }
      await tx.$queryRaw`SELECT id FROM "Pot" WHERE id = ${settlement.potId} FOR UPDATE`;
      const netKobo = Number(settlement.amountKobo - settlement.feeKobo);
      await this.ledger.record(
        buildSettlementReversePosting({
          potId: settlement.potId,
          netKobo,
          feeKobo: Number(settlement.feeKobo)
        }),
        tx
      );
      await tx.settlement.update({
        where: { id: settlement.id },
        data: {
          status: DbSettlementStatus.FAILED,
          failureReason: SettlementFailureReason.ProviderDeclined
        }
      });
      const pot = await tx.pot.findUniqueOrThrow({ where: { id: settlement.potId } });
      if (pot.status === DbPotStatus.SETTLING) {
        assertPoolTransition(PoolState.Settling, PoolState.Funded);
        await tx.pot.update({
          where: { id: settlement.potId },
          data: { status: DbPotStatus.FUNDED }
        });
      }
    });
  }

  private async beginSettlementTx(
    tx: Prisma.TransactionClient,
    potId: string
  ): Promise<BeginSettlementResult> {
    await tx.$queryRaw`SELECT id FROM "Pot" WHERE id = ${potId} FOR UPDATE`;
    const pot = await tx.pot.findUniqueOrThrow({ where: { id: potId } });
    const merchantTxRef = this.merchantTxRefFor(potId);
    const context = this.contextOf(pot);

    if (pot.status === DbPotStatus.SETTLING || pot.status === DbPotStatus.SETTLED) {
      const existing = await tx.settlement.findUniqueOrThrow({ where: { merchantTxRef } });
      return { settlementId: existing.id, merchantTxRef, alreadyTerminal: true, context };
    }

    if (pot.status !== DbPotStatus.FUNDED) {
      throw new Error(`pot ${potId} is not funded (status ${pot.status})`);
    }

    assertPoolTransition(PoolState.Funded, PoolState.Settling);
    await tx.pot.update({ where: { id: potId }, data: { status: DbPotStatus.SETTLING } });

    const settlement = await tx.settlement.upsert({
      where: { merchantTxRef },
      update: { status: DbSettlementStatus.PROCESSING, failureReason: null },
      create: {
        potId,
        type: this.toDbSettlementType(context.settlementType),
        merchantTxRef,
        amountKobo: BigInt(context.collectedKobo),
        feeKobo: BigInt(context.feeKobo),
        status: DbSettlementStatus.PROCESSING
      }
    });

    return { settlementId: settlement.id, merchantTxRef, alreadyTerminal: false, context };
  }

  private async finalizeSettlementTx(
    tx: Prisma.TransactionClient,
    potId: string,
    outcome: SettlementOutcome
  ): Promise<FinalizeSettlementResult> {
    const merchantTxRef = this.merchantTxRefFor(potId);
    const settlement = await tx.settlement.findUniqueOrThrow({ where: { merchantTxRef } });

    if (settlement.type === DbSettlementType.WALLET) {
      return this.finalizeWallet(tx, potId, settlement.id, outcome);
    }

    await this.ledger.record(
      buildSettlementPosting({ potId, netKobo: outcome.netKobo, feeKobo: outcome.feeKobo }),
      tx
    );

    if (outcome.kind === "pending") {
      await tx.settlement.update({
        where: { id: settlement.id },
        data: {
          status: DbSettlementStatus.PROCESSING,
          nombaRef: outcome.nombaRef,
          providerStatus: outcome.providerStatus
        }
      });
      return {
        settlementId: settlement.id,
        status: DbSettlementStatus.PROCESSING,
        awaitingConfirmation: true
      };
    }

    await this.ledger.record(buildPayoutClearedPosting({ netKobo: outcome.netKobo }), tx);
    await this.completeSettlement(tx, potId, settlement.id, outcome);
    return {
      settlementId: settlement.id,
      status: DbSettlementStatus.COMPLETED,
      awaitingConfirmation: false
    };
  }

  private async finalizeWallet(
    tx: Prisma.TransactionClient,
    potId: string,
    settlementId: string,
    outcome: SettlementOutcome
  ): Promise<FinalizeSettlementResult> {
    const pot = await tx.pot.findUniqueOrThrow({ where: { id: potId } });
    await this.ledger.record(
      buildWalletSettlementPosting({ potId, creatorId: pot.creatorId, amountKobo: outcome.netKobo }),
      tx
    );
    await tx.user.update({
      where: { id: pot.creatorId },
      data: { walletBalanceKobo: { increment: toAmountKoboBigInt(outcome.netKobo) } }
    });
    await this.completeSettlement(tx, potId, settlementId, {
      kind: "settled",
      netKobo: outcome.netKobo,
      feeKobo: outcome.feeKobo,
      vendToken: null,
      vendUnits: null,
      nombaRef: null,
      providerStatus: null
    });
    return {
      settlementId,
      status: DbSettlementStatus.COMPLETED,
      awaitingConfirmation: false
    };
  }

  private async completeSettlement(
    tx: Prisma.TransactionClient,
    potId: string,
    settlementId: string,
    outcome: SettledOutcome
  ): Promise<void> {
    await tx.settlement.update({
      where: { id: settlementId },
      data: {
        status: DbSettlementStatus.COMPLETED,
        vendToken: outcome.vendToken,
        vendUnits: outcome.vendUnits,
        nombaRef: outcome.nombaRef,
        providerStatus: outcome.providerStatus,
        settledAt: new Date()
      }
    });
    assertPoolTransition(PoolState.Settling, PoolState.Settled);
    await tx.pot.update({ where: { id: potId }, data: { status: DbPotStatus.SETTLED } });
    await this.outbox.enqueue(this.poolSettled(potId, outcome.vendToken), tx);
  }

  private async failSettlementTx(
    tx: Prisma.TransactionClient,
    potId: string,
    reason: SettlementFailureReason
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Pot" WHERE id = ${potId} FOR UPDATE`;
    const pot = await tx.pot.findUniqueOrThrow({ where: { id: potId } });
    const merchantTxRef = this.merchantTxRefFor(potId);
    await tx.settlement.update({
      where: { merchantTxRef },
      data: { status: DbSettlementStatus.FAILED, failureReason: reason }
    });
    if (pot.status === DbPotStatus.SETTLING) {
      assertPoolTransition(PoolState.Settling, PoolState.Funded);
      await tx.pot.update({ where: { id: potId }, data: { status: DbPotStatus.FUNDED } });
    }
  }

  private contextOf(pot: {
    id: string;
    creatorId: string;
    settlementType: DbSettlementType;
    collectedKobo: bigint;
    completionRule: { toLowerCase(): string };
    payoutAccountId: string | null;
    billerCategory: { toLowerCase(): string } | null;
    billerProductCode: string | null;
    billerCustomerId: string | null;
    meterType: string | null;
    billerMeta: Prisma.JsonValue;
  }): SettlementContext {
    return {
      potId: pot.id,
      creatorId: pot.creatorId,
      settlementType: pot.settlementType.toLowerCase() as SettlementType,
      collectedKobo: Number(pot.collectedKobo),
      feeKobo: 0,
      completionRule: pot.completionRule.toLowerCase() as CompletionRule,
      payoutAccountId: pot.payoutAccountId,
      billerCategory: pot.billerCategory
        ? (pot.billerCategory.toLowerCase() as BillerCategory)
        : null,
      billerProductCode: pot.billerProductCode,
      billerCustomerId: pot.billerCustomerId,
      meterType: pot.meterType ? (pot.meterType as MeterType) : null,
      billerMeta: this.billerMetaOf(pot.billerMeta, pot.meterType)
    };
  }

  private billerMetaOf(value: Prisma.JsonValue, meterType: string | null): Record<string, string> {
    const meta: Record<string, string> = {};
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, raw] of Object.entries(value)) {
        if (typeof raw === "string") {
          meta[key] = raw;
        }
      }
    }
    if (meterType !== null && meta.meterType === undefined) {
      meta.meterType = meterType;
    }
    return meta;
  }

  private toDbSettlementType(type: SettlementType): DbSettlementType {
    return type.toUpperCase() as DbSettlementType;
  }

  private merchantTxRefFor(potId: string): string {
    return `settle:${potId}`;
  }

  private poolSettled(potId: string, vendToken: string | null): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "pool.settled", potId, vendToken },
      attempts: 0
    };
  }
}
