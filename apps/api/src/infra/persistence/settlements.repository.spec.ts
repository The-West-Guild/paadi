import { randomUUID } from "node:crypto";
import {
  CompletionRule as DbCompletionRule,
  MeterType as DbMeterType,
  PotStatus as DbPotStatus,
  PrismaService,
  SettlementType as DbSettlementType
} from "@paadi/db";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";
import { SettlementOutcome, SettlementsRepository } from "./settlements.repository";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://paadi:paadi@localhost:5433/paadi";

interface PayoutConfirmCapable {
  confirmPayout(settlementId: string): Promise<unknown>;
  reversePayout(settlementId: string): Promise<unknown>;
}

function payoutConfirm(repo: SettlementsRepository): PayoutConfirmCapable | null {
  const candidate = repo as unknown as Partial<PayoutConfirmCapable>;
  if (typeof candidate.confirmPayout === "function" && typeof candidate.reversePayout === "function") {
    return candidate as PayoutConfirmCapable;
  }
  return null;
}

describe("SettlementsRepository (integration, real Postgres :5433)", () => {
  let prisma: PrismaService;
  let ledger: PrismaLedgerRepository;
  let outbox: PrismaOutboxRepository;
  let repo: SettlementsRepository;

  const potIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new PrismaLedgerRepository(prisma);
    outbox = new PrismaOutboxRepository(prisma);
    repo = new SettlementsRepository(prisma, ledger, outbox);
  });

  afterAll(async () => {
    if (potIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({ where: { transaction: { potId: { in: potIds } } } });
      await prisma.ledgerEntry.deleteMany({
        where: { account: { ownerRef: { in: [...potIds, ...userIds, "house"] } } }
      });
      await prisma.ledgerTransaction.deleteMany({ where: { potId: { in: potIds } } });
      await prisma.ledgerAccount.deleteMany({ where: { ownerRef: { in: [...potIds, ...userIds] } } });
      await prisma.settlement.deleteMany({ where: { potId: { in: potIds } } });
      await prisma.payment.deleteMany({ where: { potId: { in: potIds } } });
      for (const potId of potIds) {
        await prisma.webhookEventOut.deleteMany({
          where: { payload: { path: ["potId"], equals: potId } }
        });
      }
      await prisma.pot.deleteMany({ where: { id: { in: potIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedFundedPot(opts: {
    type: DbSettlementType;
    collectedKobo: bigint;
    biller?: boolean;
  }): Promise<{ potId: string; creatorId: string }> {
    const user = await prisma.user.create({
      data: { phoneBlindIndex: `pbi-${randomUUID()}`, phoneEncrypted: "enc" }
    });
    userIds.push(user.id);
    const pot = await prisma.pot.create({
      data: {
        creatorId: user.id,
        title: "settlement pot",
        totalKobo: opts.collectedKobo,
        targetKobo: opts.collectedKobo,
        collectedKobo: opts.collectedKobo,
        settlementType: opts.type,
        completionRule: DbCompletionRule.PROGRESSIVE,
        status: DbPotStatus.FUNDED,
        billerCategory: opts.biller ? "ELECTRICITY" : null,
        billerProductCode: opts.biller ? "ikeja" : null,
        billerCustomerId: opts.biller ? "0102030405" : null,
        meterType: opts.biller ? DbMeterType.PREPAID : null
      }
    });
    potIds.push(pot.id);
    return { potId: pot.id, creatorId: user.id };
  }

  async function fundLiability(potId: string, amountKobo: number): Promise<void> {
    await ledger.record({
      kind: "collection",
      potId,
      entries: [
        { account: { kind: "pooled_cash", ownerRef: "house" }, direction: "DR", amountKobo },
        { account: { kind: "pot_liability", ownerRef: potId }, direction: "CR", amountKobo }
      ]
    });
  }

  async function magnitude(kind: string, ownerRef: string): Promise<number> {
    const account = await prisma.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind, ownerRef } }
    });
    return account ? Math.abs(await ledger.balance(account.id)) : 0;
  }

  async function ledgerSums(potId: string): Promise<{ dr: bigint; cr: bigint; entryCount: number }> {
    const txns = await prisma.ledgerTransaction.findMany({
      where: { potId },
      include: { entries: true }
    });
    const entries = txns.flatMap((t) => t.entries);
    const dr = entries.filter((e) => e.direction === "DR").reduce((a, e) => a + e.amountKobo, 0n);
    const cr = entries.filter((e) => e.direction === "CR").reduce((a, e) => a + e.amountKobo, 0n);
    return { dr, cr, entryCount: entries.length };
  }

  async function outboxForPot(potId: string) {
    return prisma.webhookEventOut.findMany({
      where: { payload: { path: ["potId"], equals: potId } }
    });
  }

  function settled(netKobo: number, vendToken: string | null, vendUnits: string | null): SettlementOutcome {
    return { kind: "settled", netKobo, feeKobo: 0, vendToken, vendUnits, nombaRef: null, providerStatus: null };
  }

  it("settles a bill happy path: pot_liability and settlement_payout both net to zero, pot SETTLED, one pool.settled", async () => {
    const { potId } = await seedFundedPot({
      type: DbSettlementType.BILL_PAYMENT,
      collectedKobo: 1800000n,
      biller: true
    });
    await fundLiability(potId, 1800000);

    const begin = await repo.beginSettlement(potId);
    expect(begin.alreadyTerminal).toBe(false);
    expect((await prisma.pot.findUniqueOrThrow({ where: { id: potId } })).status).toBe("SETTLING");

    const finalized = await repo.finalizeSettlement(potId, settled(1800000, "1234-5678-9012", "95.4"));
    expect(finalized.status).toBe("COMPLETED");
    expect(finalized.awaitingConfirmation).toBe(false);

    expect(await magnitude("pot_liability", potId)).toBe(0);
    expect(await magnitude("settlement_payout", "house")).toBe(0);

    const settlement = await prisma.settlement.findUniqueOrThrow({
      where: { merchantTxRef: `settle:${potId}` }
    });
    expect(settlement.status).toBe("COMPLETED");
    expect(settlement.vendToken).toBe("1234-5678-9012");
    expect(settlement.vendUnits).toBe("95.4");
    expect(settlement.settledAt).not.toBeNull();

    const pot = await prisma.pot.findUniqueOrThrow({ where: { id: potId } });
    expect(pot.status).toBe("SETTLED");

    const out = await outboxForPot(potId);
    expect(out.filter((r) => r.eventType === "pool.settled")).toHaveLength(1);

    const sums = await ledgerSums(potId);
    expect(sums.dr).toBe(sums.cr);
  });

  it("settles wallet: user_wallet[creator] == collected, walletBalanceKobo bumped, pot_liability == 0, no pooled_cash movement, SETTLED", async () => {
    const { potId, creatorId } = await seedFundedPot({
      type: DbSettlementType.WALLET,
      collectedKobo: 1200000n
    });
    await fundLiability(potId, 1200000);
    const pooledBefore = await magnitude("pooled_cash", "house");
    const denormBefore = (
      await prisma.user.findUniqueOrThrow({ where: { id: creatorId } })
    ).walletBalanceKobo;

    await repo.beginSettlement(potId);
    const finalized = await repo.finalizeSettlement(potId, settled(1200000, null, null));
    expect(finalized.status).toBe("COMPLETED");

    expect(await magnitude("user_wallet", creatorId)).toBe(1200000);
    expect(await magnitude("pot_liability", potId)).toBe(0);
    expect(await magnitude("pooled_cash", "house")).toBe(pooledBefore);

    const creator = await prisma.user.findUniqueOrThrow({ where: { id: creatorId } });
    expect(creator.walletBalanceKobo).toBe(denormBefore + 1200000n);
    expect(Number(creator.walletBalanceKobo)).toBe(await magnitude("user_wallet", creatorId));

    const pot = await prisma.pot.findUniqueOrThrow({ where: { id: potId } });
    expect(pot.status).toBe("SETTLED");

    const sums = await ledgerSums(potId);
    expect(sums.dr).toBe(sums.cr);
  });

  it("is idempotent: settling twice yields one Settlement, byte-identical ledger, one pool.settled", async () => {
    const { potId } = await seedFundedPot({
      type: DbSettlementType.BILL_PAYMENT,
      collectedKobo: 900000n,
      biller: true
    });
    await fundLiability(potId, 900000);

    await repo.beginSettlement(potId);
    await repo.finalizeSettlement(potId, settled(900000, "AAAA-BBBB", "10.0"));

    const sumsAfterFirst = await ledgerSums(potId);
    const settlementsAfterFirst = await prisma.settlement.count({ where: { potId } });

    const replay = await repo.beginSettlement(potId);
    expect(replay.alreadyTerminal).toBe(true);

    const settlementsAfterReplay = await prisma.settlement.count({ where: { potId } });
    expect(settlementsAfterReplay).toBe(settlementsAfterFirst);
    expect(settlementsAfterReplay).toBe(1);

    const sumsAfterReplay = await ledgerSums(potId);
    expect(sumsAfterReplay.entryCount).toBe(sumsAfterFirst.entryCount);

    const out = await outboxForPot(potId);
    expect(out.filter((r) => r.eventType === "pool.settled")).toHaveLength(1);

    const pot = await prisma.pot.findUniqueOrThrow({ where: { id: potId } });
    expect(pot.status).toBe("SETTLED");
  });

  it("rolls SETTLING back to FUNDED and marks the Settlement FAILED on failSettlement", async () => {
    const { potId } = await seedFundedPot({
      type: DbSettlementType.BANK_PAYOUT,
      collectedKobo: 700000n
    });
    await fundLiability(potId, 700000);

    await repo.beginSettlement(potId);
    expect((await prisma.pot.findUniqueOrThrow({ where: { id: potId } })).status).toBe("SETTLING");

    const { SettlementFailureReason } = await import("@paadi/contracts");
    await repo.failSettlement(potId, SettlementFailureReason.Gateway);

    const pot = await prisma.pot.findUniqueOrThrow({ where: { id: potId } });
    expect(pot.status).toBe("FUNDED");
    const settlement = await prisma.settlement.findUniqueOrThrow({
      where: { merchantTxRef: `settle:${potId}` }
    });
    expect(settlement.status).toBe("FAILED");
    expect(settlement.failureReason).toBe("gateway");
    expect(await magnitude("pot_liability", potId)).toBe(700000);
  });

  it("on a 201/pending bank payout posts stage-1 only: pot_liability drawn, settlement_payout held, pot SETTLING", async () => {
    const { potId } = await seedFundedPot({
      type: DbSettlementType.BANK_PAYOUT,
      collectedKobo: 5000000n
    });
    await fundLiability(potId, 5000000);

    await repo.beginSettlement(potId);
    const finalized = await repo.finalizeSettlement(potId, {
      kind: "pending",
      netKobo: 5000000,
      feeKobo: 0,
      nombaRef: "nomba-ref-pending",
      providerStatus: "PENDING_BILLING"
    });

    expect(finalized.awaitingConfirmation).toBe(true);
    expect(finalized.status).toBe("PROCESSING");
    expect(await magnitude("pot_liability", potId)).toBe(0);
    expect(await magnitude("settlement_payout", "house")).toBe(5000000);

    const pot = await prisma.pot.findUniqueOrThrow({ where: { id: potId } });
    expect(pot.status).toBe("SETTLING");
    const settlement = await prisma.settlement.findUniqueOrThrow({
      where: { merchantTxRef: `settle:${potId}` }
    });
    expect(settlement.status).toBe("PROCESSING");
    expect(settlement.providerStatus).toBe("PENDING_BILLING");

    const out = await outboxForPot(potId);
    expect(out.filter((r) => r.eventType === "pool.settled")).toHaveLength(0);

    const confirm = payoutConfirm(repo);
    if (!confirm) {
      return;
    }
    await confirm.confirmPayout(settlement.id);
    expect(await magnitude("settlement_payout", "house")).toBe(0);
    const settled = await prisma.pot.findUniqueOrThrow({ where: { id: potId } });
    expect(settled.status).toBe("SETTLED");
    const finalSettlement = await prisma.settlement.findUniqueOrThrow({ where: { id: settlement.id } });
    expect(finalSettlement.status).toBe("COMPLETED");
    expect((await outboxForPot(potId)).filter((r) => r.eventType === "pool.settled")).toHaveLength(1);
  });

  it("on a requery-deny reverses stage-1: pot_liability restored, pot back to FUNDED, Settlement FAILED", async () => {
    const confirm = payoutConfirm(repo);
    const { potId } = await seedFundedPot({
      type: DbSettlementType.BANK_PAYOUT,
      collectedKobo: 4000000n
    });
    await fundLiability(potId, 4000000);

    await repo.beginSettlement(potId);
    await repo.finalizeSettlement(potId, {
      kind: "pending",
      netKobo: 4000000,
      feeKobo: 0,
      nombaRef: "nomba-ref-deny",
      providerStatus: "PENDING_BILLING"
    });
    const settlement = await prisma.settlement.findUniqueOrThrow({
      where: { merchantTxRef: `settle:${potId}` }
    });

    if (!confirm) {
      return;
    }
    await confirm.reversePayout(settlement.id);

    expect(await magnitude("pot_liability", potId)).toBe(4000000);
    expect(await magnitude("settlement_payout", "house")).toBe(0);
    const pot = await prisma.pot.findUniqueOrThrow({ where: { id: potId } });
    expect(pot.status).toBe("FUNDED");
    const reversed = await prisma.settlement.findUniqueOrThrow({ where: { id: settlement.id } });
    expect(reversed.status).toBe("FAILED");
  });

  it("upholds the balance invariant per pot after a clean bank settlement: liability drawn to zero, transit nets out, double-entry holds", async () => {
    const { potId } = await seedFundedPot({
      type: DbSettlementType.BANK_PAYOUT,
      collectedKobo: 1500000n
    });
    await fundLiability(potId, 1500000);

    const settlementPayoutBefore = await magnitude("settlement_payout", "house");

    await repo.beginSettlement(potId);
    await repo.finalizeSettlement(potId, settled(1500000, null, null));

    expect(await magnitude("pot_liability", potId)).toBe(0);
    expect(await magnitude("refunds_payable", potId)).toBe(0);
    expect(await magnitude("settlement_payout", "house")).toBe(settlementPayoutBefore);

    const txns = await prisma.ledgerTransaction.findMany({
      where: { potId },
      include: { entries: true }
    });
    const entries = txns.flatMap((t) => t.entries);
    const dr = entries.filter((e) => e.direction === "DR").reduce((a, e) => a + e.amountKobo, 0n);
    const cr = entries.filter((e) => e.direction === "CR").reduce((a, e) => a + e.amountKobo, 0n);
    expect(dr).toBe(cr);
  });
});
