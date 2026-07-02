import { randomUUID } from "node:crypto";
import { PaymentRecordStatus } from "@paadi/contracts";
import { buildContributionPosting } from "@paadi/domain";
import {
  CompletionRule as DbCompletionRule,
  PaymentMethod as DbPaymentMethod,
  PotStatus as DbPotStatus,
  PrismaService,
  SettlementType as DbSettlementType
} from "@paadi/db";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";
import { RefundsRepository } from "./refunds.repository";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://paadi:paadi@localhost:5433/paadi";

describe("RefundsRepository (integration, real Postgres :5433)", () => {
  let prisma: PrismaService;
  let ledger: PrismaLedgerRepository;
  let outbox: PrismaOutboxRepository;
  let repo: RefundsRepository;

  const potIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new PrismaLedgerRepository(prisma);
    outbox = new PrismaOutboxRepository(prisma);
    repo = new RefundsRepository(prisma, ledger, outbox);
  });

  afterAll(async () => {
    if (potIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({ where: { transaction: { potId: { in: potIds } } } });
      await prisma.ledgerEntry.deleteMany({
        where: { account: { ownerRef: { in: [...potIds, "house"] } } }
      });
      await prisma.ledgerTransaction.deleteMany({ where: { potId: { in: potIds } } });
      await prisma.ledgerAccount.deleteMany({ where: { ownerRef: { in: potIds } } });
      await prisma.refund.deleteMany({ where: { potId: { in: potIds } } });
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

  async function seedExpiredPot(collectedKobo: bigint): Promise<string> {
    const user = await prisma.user.create({
      data: { phoneBlindIndex: `pbi-${randomUUID()}`, phoneEncrypted: "enc" }
    });
    userIds.push(user.id);
    const pot = await prisma.pot.create({
      data: {
        creatorId: user.id,
        title: "refund pot",
        totalKobo: 1000000n,
        targetKobo: 1000000n,
        collectedKobo,
        settlementType: DbSettlementType.BANK_PAYOUT,
        completionRule: DbCompletionRule.ALL_OR_NOTHING,
        status: DbPotStatus.EXPIRED
      }
    });
    potIds.push(pot.id);
    return pot.id;
  }

  async function seedPayment(
    potId: string,
    amountKobo: bigint,
    status: PaymentRecordStatus
  ): Promise<string> {
    const payment = await prisma.payment.create({
      data: {
        potId,
        nombaTransactionId: `ntx-${randomUUID()}`,
        amountKobo,
        method: DbPaymentMethod.CARD,
        status
      }
    });
    return payment.id;
  }

  async function record(
    potId: string,
    kind: string,
    legs: { kind: string; ownerRef: string; direction: "DR" | "CR"; amountKobo: number }[]
  ): Promise<void> {
    await ledger.record({
      kind,
      potId,
      entries: legs.map((l) => ({
        account: { kind: l.kind, ownerRef: l.ownerRef },
        direction: l.direction,
        amountKobo: l.amountKobo
      }))
    });
  }

  async function balance(kind: string, ownerRef: string): Promise<number> {
    const account = await prisma.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind, ownerRef } }
    });
    return account ? await ledger.balance(account.id) : 0;
  }

  async function magnitude(kind: string, ownerRef: string): Promise<number> {
    return Math.abs(await balance(kind, ownerRef));
  }

  async function outboxForPot(potId: string) {
    return prisma.webhookEventOut.findMany({
      where: { payload: { path: ["potId"], equals: potId } }
    });
  }

  it("refunds all contributions: one Refund per Payment, refunds_payable and pot_liability net to zero, pot REFUNDED", async () => {
    const potId = await seedExpiredPot(500000n);
    const p1 = await seedPayment(potId, 300000n, PaymentRecordStatus.Succeeded);
    const p2 = await seedPayment(potId, 200000n, PaymentRecordStatus.Succeeded);
    await record(potId, "collection", [
      { kind: "pooled_cash", ownerRef: "house", direction: "DR", amountKobo: 500000 },
      { kind: "pot_liability", ownerRef: potId, direction: "CR", amountKobo: 500000 }
    ]);

    const begin = await repo.beginRefund(potId);
    expect(begin.targets).toHaveLength(2);
    expect((await prisma.pot.findUniqueOrThrow({ where: { id: potId } })).status).toBe("REFUNDING");
    expect(await magnitude("pot_liability", potId)).toBe(0);
    expect(await magnitude("refunds_payable", potId)).toBe(0);

    const byPayment = new Map(begin.targets.map((t) => [t.paymentId, t]));
    expect(byPayment.has(p1)).toBe(true);
    expect(byPayment.has(p2)).toBe(true);

    for (const t of begin.targets) {
      await repo.recordRefundCleared({ potId, refundId: t.refundId, nombaRef: `ref-${t.paymentId}` });
    }

    expect(await magnitude("pot_liability", potId)).toBe(0);
    expect(await magnitude("refunds_payable", potId)).toBe(0);

    const refunds = await prisma.refund.findMany({ where: { potId } });
    expect(refunds).toHaveLength(2);
    expect(refunds.every((r) => r.status === "COMPLETED")).toBe(true);

    const pot = await prisma.pot.findUniqueOrThrow({ where: { id: potId } });
    expect(pot.status).toBe("REFUNDED");

    const out = await outboxForPot(potId);
    expect(out.filter((r) => r.eventType === "pool.refunded")).toHaveLength(1);
  });

  it("refunds a partially-overpaid single payment once: liability and suspense both drained, pooled_cash down by the full gross, pot REFUNDED", async () => {
    const potId = await seedExpiredPot(3000n);
    const overpayId = await seedPayment(potId, 3500n, PaymentRecordStatus.Succeeded);
    const contribution = buildContributionPosting({
      potId,
      shareKobo: 3000,
      priorPaidKobo: 0,
      amountKobo: 3500
    });
    await ledger.record(contribution.posting);
    expect(contribution.attributedKobo).toBe(3000);
    expect(contribution.excessKobo).toBe(500);
    expect(await balance("pot_liability", potId)).toBe(-3000);
    expect(await balance("exceptions_suspense", potId)).toBe(-500);
    const pooledBefore = await balance("pooled_cash", "house");

    const begin = await repo.beginRefund(potId);
    expect(begin.targets).toHaveLength(1);
    expect(begin.targets[0].paymentId).toBe(overpayId);
    expect(begin.targets[0].amountKobo).toBe(3500);

    expect(await magnitude("pot_liability", potId)).toBe(0);
    expect(await magnitude("exceptions_suspense", potId)).toBe(0);
    expect(await magnitude("refunds_payable", potId)).toBe(0);
    expect(await balance("pooled_cash", "house")).toBe(pooledBefore - 3500);

    await repo.recordRefundCleared({
      potId,
      refundId: begin.targets[0].refundId,
      nombaRef: `ref-${overpayId}`
    });

    expect(await magnitude("pot_liability", potId)).toBe(0);
    expect(await magnitude("exceptions_suspense", potId)).toBe(0);
    expect(await magnitude("refunds_payable", potId)).toBe(0);

    const refunds = await prisma.refund.findMany({ where: { potId } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].status).toBe("COMPLETED");

    const pot = await prisma.pot.findUniqueOrThrow({ where: { id: potId } });
    expect(pot.status).toBe("REFUNDED");
  });

  it("reaches REFUNDED with pot-owned exception suspense left intact for reconciliation", async () => {
    const potId = await seedExpiredPot(3000n);
    const succeededId = await seedPayment(potId, 3000n, PaymentRecordStatus.Succeeded);
    await record(potId, "collection", [
      { kind: "pooled_cash", ownerRef: "house", direction: "DR", amountKobo: 3000 },
      { kind: "pot_liability", ownerRef: potId, direction: "CR", amountKobo: 3000 }
    ]);
    await seedPayment(potId, 700n, PaymentRecordStatus.AmountMismatch);
    await record(potId, "suspense", [
      { kind: "pooled_cash", ownerRef: "house", direction: "DR", amountKobo: 700 },
      { kind: "exceptions_suspense", ownerRef: potId, direction: "CR", amountKobo: 700 }
    ]);
    const pooledBefore = await balance("pooled_cash", "house");

    const begin = await repo.beginRefund(potId);
    expect(begin.targets).toHaveLength(1);
    expect(begin.targets[0].paymentId).toBe(succeededId);
    await repo.recordRefundCleared({
      potId,
      refundId: begin.targets[0].refundId,
      nombaRef: `ref-${succeededId}`
    });

    const pot = await prisma.pot.findUniqueOrThrow({ where: { id: potId } });
    expect(pot.status).toBe("REFUNDED");
    expect(await magnitude("pot_liability", potId)).toBe(0);
    expect(await magnitude("refunds_payable", potId)).toBe(0);
    expect(await magnitude("exceptions_suspense", potId)).toBe(700);
    expect(await balance("pooled_cash", "house")).toBe(pooledBefore - 3000);
    expect(await prisma.refund.count({ where: { potId } })).toBe(1);

    const out = await outboxForPot(potId);
    expect(out.filter((r) => r.eventType === "pool.refunded")).toHaveLength(1);
  });

  it("is idempotent per refund: replaying recordRefundCleared settles the pot once", async () => {
    const potId = await seedExpiredPot(400000n);
    await seedPayment(potId, 400000n, PaymentRecordStatus.Succeeded);
    await record(potId, "collection", [
      { kind: "pooled_cash", ownerRef: "house", direction: "DR", amountKobo: 400000 },
      { kind: "pot_liability", ownerRef: potId, direction: "CR", amountKobo: 400000 }
    ]);

    const begin = await repo.beginRefund(potId);
    expect(begin.targets).toHaveLength(1);
    const target = begin.targets[0];
    const cleared = { potId, refundId: target.refundId, nombaRef: "ref-once" };

    await repo.recordRefundCleared(cleared);
    const entriesAfterFirst = await prisma.ledgerEntry.count({ where: { transaction: { potId } } });
    expect((await prisma.pot.findUniqueOrThrow({ where: { id: potId } })).status).toBe("REFUNDED");

    await repo.recordRefundCleared(cleared);

    const entriesAfterReplay = await prisma.ledgerEntry.count({ where: { transaction: { potId } } });
    expect(entriesAfterReplay).toBe(entriesAfterFirst);
    expect(await prisma.refund.count({ where: { potId } })).toBe(1);
    expect(await magnitude("refunds_payable", potId)).toBe(0);

    const out = await outboxForPot(potId);
    expect(out.filter((r) => r.eventType === "pool.refunded")).toHaveLength(1);
  });

  it("does not draw the ledger twice and is a clean no-op when beginRefund is re-run on a REFUNDED pot", async () => {
    const potId = await seedExpiredPot(250000n);
    await seedPayment(potId, 250000n, PaymentRecordStatus.Succeeded);
    await record(potId, "collection", [
      { kind: "pooled_cash", ownerRef: "house", direction: "DR", amountKobo: 250000 },
      { kind: "pot_liability", ownerRef: potId, direction: "CR", amountKobo: 250000 }
    ]);

    const first = await repo.beginRefund(potId);
    expect(first.targets).toHaveLength(1);
    await repo.recordRefundCleared({ potId, refundId: first.targets[0].refundId, nombaRef: "ref-1" });
    expect((await prisma.pot.findUniqueOrThrow({ where: { id: potId } })).status).toBe("REFUNDED");
    const entriesAfterFirst = await prisma.ledgerEntry.count({ where: { transaction: { potId } } });
    const refundsAfterFirst = await prisma.refund.count({ where: { potId } });

    const second = await repo.beginRefund(potId);
    expect(second.targets).toHaveLength(0);
    expect(await prisma.ledgerEntry.count({ where: { transaction: { potId } } })).toBe(entriesAfterFirst);
    expect(await prisma.refund.count({ where: { potId } })).toBe(refundsAfterFirst);
    expect((await prisma.pot.findUniqueOrThrow({ where: { id: potId } })).status).toBe("REFUNDED");
    expect(await magnitude("pot_liability", potId)).toBe(0);
  });

  it("does not duplicate Refund rows or re-draw the ledger when beginRefund is re-run while still REFUNDING", async () => {
    const potId = await seedExpiredPot(250000n);
    await seedPayment(potId, 250000n, PaymentRecordStatus.Succeeded);
    await record(potId, "collection", [
      { kind: "pooled_cash", ownerRef: "house", direction: "DR", amountKobo: 250000 },
      { kind: "pot_liability", ownerRef: potId, direction: "CR", amountKobo: 250000 }
    ]);

    const first = await repo.beginRefund(potId);
    expect(first.targets).toHaveLength(1);
    const refundsAfterFirst = await prisma.refund.count({ where: { potId } });
    const entriesAfterFirst = await prisma.ledgerEntry.count({ where: { transaction: { potId } } });

    const second = await repo.beginRefund(potId);
    expect(second.targets).toHaveLength(1);
    expect(second.targets[0].refundId).toBe(first.targets[0].refundId);
    expect(await prisma.refund.count({ where: { potId } })).toBe(refundsAfterFirst);
    expect(await prisma.ledgerEntry.count({ where: { transaction: { potId } } })).toBe(entriesAfterFirst);
    expect(await magnitude("pot_liability", potId)).toBe(0);
    expect((await prisma.pot.findUniqueOrThrow({ where: { id: potId } })).status).toBe("REFUNDING");
  });

  it("holds the pot in REFUNDING when an individual refund fails, leaving a FAILED Refund for ops", async () => {
    const potId = await seedExpiredPot(300000n);
    await seedPayment(potId, 300000n, PaymentRecordStatus.Succeeded);
    await record(potId, "collection", [
      { kind: "pooled_cash", ownerRef: "house", direction: "DR", amountKobo: 300000 },
      { kind: "pot_liability", ownerRef: potId, direction: "CR", amountKobo: 300000 }
    ]);

    const begin = await repo.beginRefund(potId);
    await repo.recordRefundFailed(begin.targets[0].refundId, "provider_declined");

    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: begin.targets[0].refundId } });
    expect(refund.status).toBe("FAILED");
    expect(refund.failureReason).toBe("provider_declined");
    expect((await prisma.pot.findUniqueOrThrow({ where: { id: potId } })).status).toBe("REFUNDING");
  });
});
