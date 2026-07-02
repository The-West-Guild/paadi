import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { PaymentMethod } from "@paadi/contracts";
import { LedgerAccountKind, buildWalletCreditPosting } from "@paadi/domain";
import {
  CompletionRule as DbCompletionRule,
  PotStatus as DbPotStatus,
  PrismaService,
  SettlementType as DbSettlementType
} from "@paadi/db";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";
import { IngestPaymentInput, PaymentIngestionRepository } from "./payment-ingestion.repository";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://paadi:paadi@localhost:5433/paadi";

describe("PaymentIngestionRepository (integration, real Postgres :5433)", () => {
  let prisma: PrismaService;
  let ledger: PrismaLedgerRepository;
  let outbox: PrismaOutboxRepository;
  let repo: PaymentIngestionRepository;

  const potIds: string[] = [];
  const userIds: string[] = [];
  const webhookEventInIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new PrismaLedgerRepository(prisma);
    outbox = new PrismaOutboxRepository(prisma);
    repo = new PaymentIngestionRepository(prisma, ledger, outbox);
  });

  afterAll(async () => {
    if (potIds.length > 0 || userIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({
        where: { account: { ownerRef: { in: [...potIds, ...userIds, "house"] } } }
      });
    }
    if (potIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({ where: { transaction: { potId: { in: potIds } } } });
      await prisma.ledgerTransaction.deleteMany({ where: { potId: { in: potIds } } });
      await prisma.payment.deleteMany({ where: { potId: { in: potIds } } });
      await prisma.split.deleteMany({ where: { potId: { in: potIds } } });
      for (const potId of potIds) {
        await prisma.webhookEventOut.deleteMany({
          where: { payload: { path: ["potId"], equals: potId } }
        });
      }
      await prisma.pot.deleteMany({ where: { id: { in: potIds } } });
    }
    if (userIds.length > 0) {
      for (const userId of userIds) {
        await prisma.webhookEventOut.deleteMany({
          where: { payload: { path: ["userId"], equals: userId } }
        });
      }
      await prisma.ledgerAccount.deleteMany({ where: { ownerRef: { in: [...potIds, ...userIds] } } });
    } else if (potIds.length > 0) {
      await prisma.ledgerAccount.deleteMany({ where: { ownerRef: { in: potIds } } });
    }
    if (webhookEventInIds.length > 0) {
      await prisma.webhookEventIn.deleteMany({ where: { id: { in: webhookEventInIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedPot(opts: {
    shareKobo: bigint;
    targetKobo: bigint;
    completionRule?: DbCompletionRule;
    status?: DbPotStatus;
  }) {
    const user = await prisma.user.create({
      data: { phoneBlindIndex: `pbi-${randomUUID()}`, phoneEncrypted: "enc" }
    });
    userIds.push(user.id);
    const pot = await prisma.pot.create({
      data: {
        creatorId: user.id,
        title: "integration pot",
        totalKobo: opts.targetKobo,
        targetKobo: opts.targetKobo,
        settlementType: DbSettlementType.BANK_PAYOUT,
        completionRule: opts.completionRule ?? DbCompletionRule.PROGRESSIVE,
        status: opts.status ?? DbPotStatus.OPEN
      }
    });
    potIds.push(pot.id);
    const split = await prisma.split.create({
      data: {
        potId: pot.id,
        label: "Ada",
        weight: 1,
        shareKobo: opts.shareKobo,
        checkoutOrderRef: `ref-${randomUUID()}`,
        payToken: `tok-${randomUUID()}`
      }
    });
    return { user, pot, split };
  }

  async function makeWebhookEvent(): Promise<string> {
    const event = await prisma.webhookEventIn.create({
      data: {
        provider: "nomba",
        providerEventId: `pe-${randomUUID()}`,
        signatureOk: true,
        payload: {}
      }
    });
    webhookEventInIds.push(event.id);
    return event.id;
  }

  function baseInput(overrides: Partial<IngestPaymentInput>): IngestPaymentInput {
    return {
      webhookEventInId: "",
      nombaTransactionId: `txn-${randomUUID()}`,
      splitId: null,
      potId: null,
      amountKobo: 0,
      method: PaymentMethod.Card,
      senderName: "Ada",
      senderAccount: "0123456789",
      senderBank: "GTBank",
      ...overrides
    };
  }

  async function accountMagnitude(kind: string, ownerRef: string): Promise<number> {
    const account = await prisma.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind, ownerRef } }
    });
    if (!account) {
      return 0;
    }
    return Math.abs(await ledger.balance(account.id));
  }

  async function ledgerSums(potId: string): Promise<{ dr: bigint; cr: bigint; entryCount: number }> {
    const txns = await prisma.ledgerTransaction.findMany({
      where: { potId },
      include: { entries: true }
    });
    const entries = txns.flatMap((t) => t.entries);
    const dr = entries
      .filter((e) => e.direction === "DR")
      .reduce((acc, e) => acc + e.amountKobo, 0n);
    const cr = entries
      .filter((e) => e.direction === "CR")
      .reduce((acc, e) => acc + e.amountKobo, 0n);
    return { dr, cr, entryCount: entries.length };
  }

  async function outboxForPot(potId: string) {
    return prisma.webhookEventOut.findMany({
      where: { payload: { path: ["potId"], equals: potId } }
    });
  }

  async function seedWalletBalance(userId: string, amountKobo: number): Promise<void> {
    await ledger.record(buildWalletCreditPosting({ userId, amountKobo }));
    await prisma.user.update({
      where: { id: userId },
      data: { walletBalanceKobo: { increment: BigInt(amountKobo) } }
    });
  }

  async function walletSpendableKobo(userId: string): Promise<number> {
    const account = await prisma.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind: LedgerAccountKind.UserWallet, ownerRef: userId } }
    });
    if (!account) {
      return 0;
    }
    return -(await ledger.balance(account.id)) + 0;
  }

  async function denormWalletKobo(userId: string): Promise<number> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return Number(user.walletBalanceKobo);
  }

  async function walletTxnCount(userId: string): Promise<number> {
    const account = await prisma.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind: LedgerAccountKind.UserWallet, ownerRef: userId } }
    });
    if (!account) {
      return 0;
    }
    const txns = await prisma.ledgerTransaction.findMany({
      where: { kind: "wallet_contribution", entries: { some: { accountId: account.id } } }
    });
    return txns.length;
  }

  it("ingests one payment into a balanced ledger and advances split + pot", async () => {
    const { pot, split } = await seedPot({ shareKobo: 300000n, targetKobo: 1000000n });
    const webhookEventInId = await makeWebhookEvent();

    const result = await repo.ingest(
      baseInput({ webhookEventInId, splitId: split.id, potId: pot.id, amountKobo: 300000 })
    );

    expect(result.status).toBe("succeeded");
    expect(result.alreadyProcessed).toBe(false);
    expect(result.attributedKobo).toBe(300000);

    const payments = await prisma.payment.findMany({ where: { potId: pot.id } });
    expect(payments).toHaveLength(1);

    const sums = await ledgerSums(pot.id);
    expect(sums.dr).toBe(sums.cr);

    const freshSplit = await prisma.split.findUniqueOrThrow({ where: { id: split.id } });
    expect(Number(freshSplit.paidKobo)).toBe(300000);
    expect(freshSplit.status).toBe("PAID");

    const freshPot = await prisma.pot.findUniqueOrThrow({ where: { id: pot.id } });
    expect(Number(freshPot.collectedKobo)).toBe(300000);

    expect(await accountMagnitude("pot_liability", pot.id)).toBe(300000);

    const out = await outboxForPot(pot.id);
    expect(out.filter((r) => r.eventType === "payment.succeeded")).toHaveLength(1);
  });

  it("splits an overpayment into pot_liability (attributed) and exceptions_suspense (excess)", async () => {
    const { pot, split } = await seedPot({ shareKobo: 300000n, targetKobo: 1000000n });
    const webhookEventInId = await makeWebhookEvent();

    const result = await repo.ingest(
      baseInput({ webhookEventInId, splitId: split.id, potId: pot.id, amountKobo: 500000 })
    );

    expect(result.attributedKobo).toBe(300000);
    expect(result.excessKobo).toBe(200000);

    const freshSplit = await prisma.split.findUniqueOrThrow({ where: { id: split.id } });
    expect(freshSplit.status).toBe("OVERPAID");
    expect(Number(freshSplit.paidKobo)).toBe(500000);

    const freshPot = await prisma.pot.findUniqueOrThrow({ where: { id: pot.id } });
    expect(Number(freshPot.collectedKobo)).toBe(300000);

    expect(await accountMagnitude("pot_liability", pot.id)).toBe(300000);
    expect(await accountMagnitude("exceptions_suspense", pot.id)).toBe(200000);

    const sums = await ledgerSums(pot.id);
    expect(sums.dr).toBe(sums.cr);
  });

  it("parks a further payment on an already-overpaid split to suspense without throwing (overpaid -> overpaid)", async () => {
    const { pot, split } = await seedPot({ shareKobo: 2000n, targetKobo: 1000000n });

    const firstEvent = await makeWebhookEvent();
    const first = await repo.ingest(
      baseInput({ webhookEventInId: firstEvent, splitId: split.id, potId: pot.id, amountKobo: 2500 })
    );
    expect(first.status).toBe("succeeded");
    expect(first.attributedKobo).toBe(2000);
    expect(first.excessKobo).toBe(500);

    const overpaidSplit = await prisma.split.findUniqueOrThrow({ where: { id: split.id } });
    expect(overpaidSplit.status).toBe("OVERPAID");

    const suspenseBefore = await accountMagnitude("exceptions_suspense", pot.id);
    const collectedBefore = Number(
      (await prisma.pot.findUniqueOrThrow({ where: { id: pot.id } })).collectedKobo
    );

    const secondEvent = await makeWebhookEvent();
    const second = await repo.ingest(
      baseInput({ webhookEventInId: secondEvent, splitId: split.id, potId: pot.id, amountKobo: 100 })
    );

    expect(second.status).toBe("over_collection");
    expect(second.attributedKobo).toBe(0);
    expect(second.excessKobo).toBe(100);
    expect(second.funded).toBe(false);

    const suspenseAfter = await accountMagnitude("exceptions_suspense", pot.id);
    expect(suspenseAfter - suspenseBefore).toBe(100);

    const collectedAfter = Number(
      (await prisma.pot.findUniqueOrThrow({ where: { id: pot.id } })).collectedKobo
    );
    expect(collectedAfter).toBe(collectedBefore);
    expect(collectedAfter).toBe(2000);

    const stillOverpaid = await prisma.split.findUniqueOrThrow({ where: { id: split.id } });
    expect(stillOverpaid.status).toBe("OVERPAID");
    expect(Number(stillOverpaid.paidKobo)).toBe(2500);

    const payments = await prisma.payment.findMany({ where: { potId: pot.id } });
    expect(payments).toHaveLength(2);

    const sums = await ledgerSums(pot.id);
    expect(sums.dr).toBe(sums.cr);
  });

  it("is replay-safe: a duplicate nombaTransactionId leaves exactly one payment and an unchanged ledger", async () => {
    const { pot, split } = await seedPot({ shareKobo: 300000n, targetKobo: 1000000n });
    const firstEvent = await makeWebhookEvent();
    const nombaTransactionId = `txn-${randomUUID()}`;

    await repo.ingest(
      baseInput({ webhookEventInId: firstEvent, splitId: split.id, potId: pot.id, amountKobo: 300000, nombaTransactionId })
    );
    const before = await ledgerSums(pot.id);
    const collectedBefore = Number((await prisma.pot.findUniqueOrThrow({ where: { id: pot.id } })).collectedKobo);

    const secondEvent = await makeWebhookEvent();
    const replay = await repo.ingest(
      baseInput({ webhookEventInId: secondEvent, splitId: split.id, potId: pot.id, amountKobo: 300000, nombaTransactionId })
    );

    expect(replay.alreadyProcessed).toBe(true);

    const loser = await prisma.webhookEventIn.findUniqueOrThrow({ where: { id: secondEvent } });
    expect(loser.processedAt).not.toBeNull();

    const payments = await prisma.payment.findMany({ where: { potId: pot.id } });
    expect(payments).toHaveLength(1);

    const after = await ledgerSums(pot.id);
    expect(after.entryCount).toBe(before.entryCount);
    const collectedAfter = Number((await prisma.pot.findUniqueOrThrow({ where: { id: pot.id } })).collectedKobo);
    expect(collectedAfter).toBe(collectedBefore);
  });

  it("funds the pot at target, emits exactly one pool.funded, and parks later money in suspense", async () => {
    const { pot, split } = await seedPot({ shareKobo: 300000n, targetKobo: 300000n });
    const fundEvent = await makeWebhookEvent();

    const funding = await repo.ingest(
      baseInput({ webhookEventInId: fundEvent, splitId: split.id, potId: pot.id, amountKobo: 300000 })
    );
    expect(funding.funded).toBe(true);

    const fundedPot = await prisma.pot.findUniqueOrThrow({ where: { id: pot.id } });
    expect(fundedPot.status).toBe("FUNDED");

    let out = await outboxForPot(pot.id);
    expect(out.filter((r) => r.eventType === "pool.funded")).toHaveLength(1);

    const lateEvent = await makeWebhookEvent();
    const late = await repo.ingest(
      baseInput({ webhookEventInId: lateEvent, splitId: split.id, potId: pot.id, amountKobo: 50000 })
    );

    expect(late.status).toBe("over_collection");
    expect(late.funded).toBe(false);

    const afterLatePot = await prisma.pot.findUniqueOrThrow({ where: { id: pot.id } });
    expect(Number(afterLatePot.collectedKobo)).toBe(300000);
    expect(await accountMagnitude("exceptions_suspense", pot.id)).toBe(50000);

    out = await outboxForPot(pot.id);
    expect(out.filter((r) => r.eventType === "pool.funded")).toHaveLength(1);
  });

  describe("pay-from-wallet (source = wallet)", () => {
    it("debits user_wallet, credits pot_liability, leaves pooled_cash untouched, advances the split, decrements the denorm", async () => {
      const { user, pot, split } = await seedPot({ shareKobo: 250000n, targetKobo: 1000000n });
      await seedWalletBalance(user.id, 500000);
      const pooledBefore = await accountMagnitude("pooled_cash", "house");

      const result = await repo.payFromWallet({
        payerUserId: user.id,
        potId: pot.id,
        splitId: split.id,
        amountKobo: 250000,
        idempotencyKey: `idem-${randomUUID()}`,
        payerName: "Ada"
      });

      expect(result.status).toBe("succeeded");
      expect(result.alreadyProcessed).toBe(false);
      expect(result.attributedKobo).toBe(250000);
      expect(result.excessKobo).toBe(0);

      const payments = await prisma.payment.findMany({ where: { potId: pot.id } });
      expect(payments).toHaveLength(1);
      expect(payments[0].method).toBe("WALLET");
      expect(payments[0].nombaTransactionId.startsWith("wallet:")).toBe(true);

      expect(await walletSpendableKobo(user.id)).toBe(250000);
      expect(await denormWalletKobo(user.id)).toBe(250000);
      expect(await denormWalletKobo(user.id)).toBe(await walletSpendableKobo(user.id));
      expect(await accountMagnitude("pot_liability", pot.id)).toBe(250000);
      expect(await accountMagnitude("pooled_cash", "house")).toBe(pooledBefore);
      expect(await walletTxnCount(user.id)).toBe(1);

      const freshSplit = await prisma.split.findUniqueOrThrow({ where: { id: split.id } });
      expect(freshSplit.status).toBe("PAID");
      expect(Number(freshSplit.paidKobo)).toBe(250000);

      const sums = await ledgerSums(pot.id);
      expect(sums.dr).toBe(sums.cr);

      const out = await prisma.webhookEventOut.findMany({
        where: { payload: { path: ["userId"], equals: user.id } }
      });
      expect(out.filter((r) => r.eventType === "wallet.debited")).toHaveLength(1);
      const potOut = await outboxForPot(pot.id);
      expect(potOut.filter((r) => r.eventType === "payment.succeeded")).toHaveLength(1);
    });

    it("rejects with 402 and debits nothing when the wallet balance is below the amount", async () => {
      const { user, pot, split } = await seedPot({ shareKobo: 250000n, targetKobo: 1000000n });
      await seedWalletBalance(user.id, 100000);

      await expect(
        repo.payFromWallet({
          payerUserId: user.id,
          potId: pot.id,
          splitId: split.id,
          amountKobo: 250000,
          idempotencyKey: `idem-${randomUUID()}`,
          payerName: "Ada"
        })
      ).rejects.toBeInstanceOf(HttpException);

      expect(await walletSpendableKobo(user.id)).toBe(100000);
      expect(await denormWalletKobo(user.id)).toBe(100000);
      expect(await prisma.payment.count({ where: { potId: pot.id } })).toBe(0);
      expect(await walletTxnCount(user.id)).toBe(0);
      const freshSplit = await prisma.split.findUniqueOrThrow({ where: { id: split.id } });
      expect(freshSplit.status).toBe("PENDING");
    });

    it("splits a wallet overpay into pot_liability (attributed) and exceptions_suspense (excess), still no pooled_cash movement", async () => {
      const { user, pot, split } = await seedPot({ shareKobo: 200000n, targetKobo: 1000000n });
      await seedWalletBalance(user.id, 500000);
      const pooledBefore = await accountMagnitude("pooled_cash", "house");

      const result = await repo.payFromWallet({
        payerUserId: user.id,
        potId: pot.id,
        splitId: split.id,
        amountKobo: 300000,
        idempotencyKey: `idem-${randomUUID()}`,
        payerName: "Ada"
      });

      expect(result.attributedKobo).toBe(200000);
      expect(result.excessKobo).toBe(100000);
      expect(await accountMagnitude("pot_liability", pot.id)).toBe(200000);
      expect(await accountMagnitude("exceptions_suspense", pot.id)).toBe(100000);
      expect(await accountMagnitude("pooled_cash", "house")).toBe(pooledBefore);
      expect(await walletSpendableKobo(user.id)).toBe(200000);
      expect(await denormWalletKobo(user.id)).toBe(200000);

      const freshSplit = await prisma.split.findUniqueOrThrow({ where: { id: split.id } });
      expect(freshSplit.status).toBe("OVERPAID");

      const sums = await ledgerSums(pot.id);
      expect(sums.dr).toBe(sums.cr);
    });

    it("is replay-safe on the same Idempotency-Key: one debit, one payment, one wallet_contribution, second returns the first result", async () => {
      const { user, pot, split } = await seedPot({ shareKobo: 250000n, targetKobo: 1000000n });
      await seedWalletBalance(user.id, 500000);
      const idempotencyKey = `idem-${randomUUID()}`;

      const first = await repo.payFromWallet({
        payerUserId: user.id,
        potId: pot.id,
        splitId: split.id,
        amountKobo: 250000,
        idempotencyKey,
        payerName: "Ada"
      });
      expect(first.alreadyProcessed).toBe(false);

      const replay = await repo.payFromWallet({
        payerUserId: user.id,
        potId: pot.id,
        splitId: split.id,
        amountKobo: 250000,
        idempotencyKey,
        payerName: "Ada"
      });
      expect(replay.alreadyProcessed).toBe(true);
      expect(replay.paymentId).toBe(first.paymentId);

      expect(await prisma.payment.count({ where: { potId: pot.id } })).toBe(1);
      expect(await walletTxnCount(user.id)).toBe(1);
      expect(await walletSpendableKobo(user.id)).toBe(250000);
      expect(await denormWalletKobo(user.id)).toBe(250000);
    });

    it("double-spend proof: two concurrent payFromWallet(5000) on a 5000 wallet -> exactly one succeeds, one 402; balance 0, never negative; one wallet_contribution", async () => {
      const { user, pot } = await seedPot({ shareKobo: 5000n, targetKobo: 1000000n });
      await seedWalletBalance(user.id, 5000);
      const splitA = await prisma.split.create({
        data: {
          potId: pot.id,
          label: "A",
          weight: 1,
          shareKobo: 5000n,
          payToken: `tok-${randomUUID()}`
        }
      });
      const splitB = await prisma.split.create({
        data: {
          potId: pot.id,
          label: "B",
          weight: 1,
          shareKobo: 5000n,
          payToken: `tok-${randomUUID()}`
        }
      });

      const outcomes = await Promise.allSettled([
        repo.payFromWallet({
          payerUserId: user.id,
          potId: pot.id,
          splitId: splitA.id,
          amountKobo: 5000,
          idempotencyKey: `idem-${randomUUID()}`,
          payerName: "Ada"
        }),
        repo.payFromWallet({
          payerUserId: user.id,
          potId: pot.id,
          splitId: splitB.id,
          amountKobo: 5000,
          idempotencyKey: `idem-${randomUUID()}`,
          payerName: "Ada"
        })
      ]);

      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter((o) => o.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(HttpException);
      expect((rejected[0] as PromiseRejectedResult).reason.getStatus()).toBe(402);

      const spendable = await walletSpendableKobo(user.id);
      expect(spendable).toBe(0);
      expect(spendable).toBeGreaterThanOrEqual(0);
      expect(await denormWalletKobo(user.id)).toBe(0);
      expect(await walletTxnCount(user.id)).toBe(1);
      expect(await prisma.payment.count({ where: { potId: pot.id } })).toBe(1);

      const sums = await ledgerSums(pot.id);
      expect(sums.dr).toBe(sums.cr);
    });

    it("concurrent same-key double-submit: both resolve, exactly one debit, the retry replays the first result (no 402)", async () => {
      const { user, pot, split } = await seedPot({ shareKobo: 5000n, targetKobo: 1000000n });
      await seedWalletBalance(user.id, 5000);
      const idempotencyKey = `idem-${randomUUID()}`;

      const command = {
        payerUserId: user.id,
        potId: pot.id,
        splitId: split.id,
        amountKobo: 5000,
        idempotencyKey,
        payerName: "Ada"
      };

      const outcomes = await Promise.allSettled([
        repo.payFromWallet(command),
        repo.payFromWallet(command)
      ]);

      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      expect(fulfilled).toHaveLength(2);
      const results = (fulfilled as PromiseFulfilledResult<Awaited<ReturnType<typeof repo.payFromWallet>>>[]).map(
        (o) => o.value
      );
      expect(results.every((r) => r.status === "succeeded")).toBe(true);
      expect(results.filter((r) => r.alreadyProcessed).length).toBeGreaterThanOrEqual(1);
      const paymentIds = new Set(results.map((r) => r.paymentId));
      expect(paymentIds.size).toBe(1);

      expect(await prisma.payment.count({ where: { potId: pot.id } })).toBe(1);
      expect(await walletTxnCount(user.id)).toBe(1);
      const spendable = await walletSpendableKobo(user.id);
      expect(spendable).toBe(0);
      expect(spendable).toBeGreaterThanOrEqual(0);
      expect(await denormWalletKobo(user.id)).toBe(0);

      const sums = await ledgerSums(pot.id);
      expect(sums.dr).toBe(sums.cr);
    });
  });
});
