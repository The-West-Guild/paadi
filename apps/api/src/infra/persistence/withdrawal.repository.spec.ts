import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { SettlementFailureReason } from "@paadi/contracts";
import { LedgerAccountKind, buildWalletCreditPosting } from "@paadi/domain";
import { PrismaService, Tier as DbTier } from "@paadi/db";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";
import { WithdrawalRepository } from "./withdrawal.repository";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://paadi:paadi@localhost:5433/paadi";

describe("WithdrawalRepository (integration, real Postgres :5433)", () => {
  let prisma: PrismaService;
  let ledger: PrismaLedgerRepository;
  let outbox: PrismaOutboxRepository;
  let repo: WithdrawalRepository;

  const userIds: string[] = [];
  const payoutAccountIds: string[] = [];
  const withdrawalIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new PrismaLedgerRepository(prisma);
    outbox = new PrismaOutboxRepository(prisma);
    repo = new WithdrawalRepository(prisma, ledger, outbox);
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      const scopedAccounts = await prisma.ledgerAccount.findMany({
        where: { ownerRef: { in: userIds } },
        select: { id: true }
      });
      const scopedEntries = await prisma.ledgerEntry.findMany({
        where: { accountId: { in: scopedAccounts.map((a) => a.id) } },
        select: { transactionId: true }
      });
      const scopedTxnIds = [...new Set(scopedEntries.map((e) => e.transactionId))];
      await prisma.ledgerEntry.deleteMany({ where: { transactionId: { in: scopedTxnIds } } });
      await prisma.ledgerTransaction.deleteMany({ where: { id: { in: scopedTxnIds } } });
      await prisma.ledgerAccount.deleteMany({ where: { ownerRef: { in: userIds } } });
      for (const userId of userIds) {
        await prisma.webhookEventOut.deleteMany({
          where: { payload: { path: ["userId"], equals: userId } }
        });
      }
    }
    if (withdrawalIds.length > 0) {
      await prisma.withdrawal.deleteMany({ where: { id: { in: withdrawalIds } } });
    }
    if (payoutAccountIds.length > 0) {
      await prisma.payoutAccount.deleteMany({ where: { id: { in: payoutAccountIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedUserWithWallet(amountKobo: number): Promise<{ userId: string; payoutAccountId: string }> {
    const user = await prisma.user.create({
      data: { phoneBlindIndex: `pbi-${randomUUID()}`, phoneEncrypted: "enc", tier: DbTier.TIER_1 }
    });
    userIds.push(user.id);
    const account = await prisma.payoutAccount.create({
      data: {
        userId: user.id,
        bankCode: "058",
        bankName: "Guaranty Trust Bank",
        accountNumberEnc: "enc-0123456789",
        accountNumberLast4: "6789",
        accountName: "Tunde Ade",
        nameMatchVerified: true,
        isPrimary: true
      }
    });
    payoutAccountIds.push(account.id);
    if (amountKobo > 0) {
      await ledger.record(buildWalletCreditPosting({ userId: user.id, amountKobo }));
      await prisma.user.update({
        where: { id: user.id },
        data: { walletBalanceKobo: { increment: BigInt(amountKobo) } }
      });
    }
    return { userId: user.id, payoutAccountId: account.id };
  }

  async function magnitude(kind: string, ownerRef: string): Promise<number> {
    const account = await prisma.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind, ownerRef } }
    });
    return account ? Math.abs(await ledger.balance(account.id)) : 0;
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

  function trackWithdrawal(id: string): void {
    if (!withdrawalIds.includes(id)) {
      withdrawalIds.push(id);
    }
  }

  async function outboxForUser(userId: string) {
    return prisma.webhookEventOut.findMany({
      where: { payload: { path: ["userId"], equals: userId } }
    });
  }

  it("stage-1 hold then confirm: DR user_wallet/CR settlement_payout, then DR settlement_payout/CR pooled_cash; nets to zero; COMPLETED", async () => {
    const { userId, payoutAccountId } = await seedUserWithWallet(1000000);
    const pooledBefore = await magnitude("pooled_cash", "house");
    const payoutBefore = await magnitude("settlement_payout", "house");

    const begin = await repo.requestWithdrawal({
      userId,
      payoutAccountId,
      amountKobo: 600000,
      feeKobo: 0,
      idempotencyKey: `k-${randomUUID()}`
    });
    trackWithdrawal(begin.withdrawalId);
    expect(begin.alreadyExisted).toBe(false);
    expect(begin.status).toBe("PROCESSING");

    expect(await walletSpendableKobo(userId)).toBe(400000);
    expect(await denormWalletKobo(userId)).toBe(400000);
    expect(await magnitude("settlement_payout", "house")).toBe(payoutBefore + 600000);
    expect(await magnitude("pooled_cash", "house")).toBe(pooledBefore);

    await repo.confirmWithdrawal(begin.withdrawalId, { nombaRef: "nomba-1", providerStatus: "SUCCESS" });

    expect(await magnitude("settlement_payout", "house")).toBe(payoutBefore);
    expect(await magnitude("pooled_cash", "house")).toBe(pooledBefore - 600000);
    expect(await walletSpendableKobo(userId)).toBe(400000);

    const withdrawal = await prisma.withdrawal.findUniqueOrThrow({ where: { id: begin.withdrawalId } });
    expect(withdrawal.status).toBe("COMPLETED");
    expect(withdrawal.nombaRef).toBe("nomba-1");
    expect(withdrawal.completedAt).not.toBeNull();

    const out = await outboxForUser(userId);
    expect(out.filter((r) => r.eventType === "withdrawal.completed")).toHaveLength(1);
    expect(out.filter((r) => r.eventType === "wallet.debited")).toHaveLength(1);
  });

  it("requery-deny reverses stage-1: settlement_payout un-earmarked, wallet + denorm restored, FAILED, one withdrawal.failed, zero suspense movement", async () => {
    const { userId, payoutAccountId } = await seedUserWithWallet(1000000);
    const suspenseBefore = await magnitude("exceptions_suspense", "house");

    const begin = await repo.requestWithdrawal({
      userId,
      payoutAccountId,
      amountKobo: 600000,
      feeKobo: 0,
      idempotencyKey: `k-${randomUUID()}`
    });
    trackWithdrawal(begin.withdrawalId);
    expect(await walletSpendableKobo(userId)).toBe(400000);

    await repo.reverseWithdrawal(begin.withdrawalId, SettlementFailureReason.ProviderDeclined);

    expect(await walletSpendableKobo(userId)).toBe(1000000);
    expect(await denormWalletKobo(userId)).toBe(1000000);
    expect(await magnitude("settlement_payout", "house")).toBe(0);
    expect(await magnitude("exceptions_suspense", "house")).toBe(suspenseBefore);

    const withdrawal = await prisma.withdrawal.findUniqueOrThrow({ where: { id: begin.withdrawalId } });
    expect(withdrawal.status).toBe("FAILED");
    expect(withdrawal.failureReason).toBe(SettlementFailureReason.ProviderDeclined);

    const out = await outboxForUser(userId);
    expect(out.filter((r) => r.eventType === "withdrawal.failed")).toHaveLength(1);
  });

  it("is idempotent on the merchantTxRef: a replay loads the existing Withdrawal with no second debit", async () => {
    const { userId, payoutAccountId } = await seedUserWithWallet(1000000);
    const payoutBefore = await magnitude("settlement_payout", "house");
    const idempotencyKey = `k-${randomUUID()}`;

    const first = await repo.requestWithdrawal({
      userId,
      payoutAccountId,
      amountKobo: 600000,
      feeKobo: 0,
      idempotencyKey
    });
    trackWithdrawal(first.withdrawalId);
    expect(first.alreadyExisted).toBe(false);
    expect(await walletSpendableKobo(userId)).toBe(400000);

    const replay = await repo.requestWithdrawal({
      userId,
      payoutAccountId,
      amountKobo: 600000,
      feeKobo: 0,
      idempotencyKey
    });
    expect(replay.alreadyExisted).toBe(true);
    expect(replay.withdrawalId).toBe(first.withdrawalId);

    expect(await prisma.withdrawal.count({ where: { userId } })).toBe(1);
    expect(await walletSpendableKobo(userId)).toBe(400000);
    expect(await denormWalletKobo(userId)).toBe(400000);
    expect(await magnitude("settlement_payout", "house")).toBe(payoutBefore + 600000);
  });

  it("rejects with 402 and debits nothing when the wallet balance is below the amount", async () => {
    const { userId, payoutAccountId } = await seedUserWithWallet(100000);
    const payoutBefore = await magnitude("settlement_payout", "house");

    await expect(
      repo.requestWithdrawal({
        userId,
        payoutAccountId,
        amountKobo: 600000,
        feeKobo: 0,
        idempotencyKey: `k-${randomUUID()}`
      })
    ).rejects.toBeInstanceOf(HttpException);

    expect(await walletSpendableKobo(userId)).toBe(100000);
    expect(await denormWalletKobo(userId)).toBe(100000);
    expect(await prisma.withdrawal.count({ where: { userId } })).toBe(0);
    expect(await magnitude("settlement_payout", "house")).toBe(payoutBefore);
  });

  it("allows a full-balance withdraw: wallet drawn to exactly zero, never negative", async () => {
    const { userId, payoutAccountId } = await seedUserWithWallet(750000);

    const begin = await repo.requestWithdrawal({
      userId,
      payoutAccountId,
      amountKobo: 750000,
      feeKobo: 0,
      idempotencyKey: `k-${randomUUID()}`
    });
    trackWithdrawal(begin.withdrawalId);

    const spendable = await walletSpendableKobo(userId);
    expect(spendable).toBe(0);
    expect(spendable).toBeGreaterThanOrEqual(0);
    expect(await denormWalletKobo(userId)).toBe(0);
  });

  it("double-spend proof: two concurrent requestWithdrawal(5000) on a 5000 wallet -> exactly one succeeds, one 402; balance 0, never negative; one Withdrawal", async () => {
    const { userId, payoutAccountId } = await seedUserWithWallet(5000);
    const payoutBefore = await magnitude("settlement_payout", "house");

    const outcomes = await Promise.allSettled([
      repo.requestWithdrawal({
        userId,
        payoutAccountId,
        amountKobo: 5000,
        feeKobo: 0,
        idempotencyKey: `k-${randomUUID()}`
      }),
      repo.requestWithdrawal({
        userId,
        payoutAccountId,
        amountKobo: 5000,
        feeKobo: 0,
        idempotencyKey: `k-${randomUUID()}`
      })
    ]);

    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        trackWithdrawal(outcome.value.withdrawalId);
      }
    }

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(HttpException);
    expect((rejected[0] as PromiseRejectedResult).reason.getStatus()).toBe(402);

    const spendable = await walletSpendableKobo(userId);
    expect(spendable).toBe(0);
    expect(spendable).toBeGreaterThanOrEqual(0);
    expect(await denormWalletKobo(userId)).toBe(0);
    expect(await prisma.withdrawal.count({ where: { userId } })).toBe(1);
    expect(await magnitude("settlement_payout", "house")).toBe(payoutBefore + 5000);
  });

  it("upholds the balance invariant after a hold+confirm: user_wallet down by net, settlement_payout back to base, pooled_cash down by net, double-entry holds", async () => {
    const { userId, payoutAccountId } = await seedUserWithWallet(900000);
    const pooledBefore = await magnitude("pooled_cash", "house");
    const payoutBefore = await magnitude("settlement_payout", "house");

    const begin = await repo.requestWithdrawal({
      userId,
      payoutAccountId,
      amountKobo: 300000,
      feeKobo: 0,
      idempotencyKey: `k-${randomUUID()}`
    });
    trackWithdrawal(begin.withdrawalId);
    await repo.confirmWithdrawal(begin.withdrawalId, { nombaRef: "nomba-9", providerStatus: "SUCCESS" });

    expect(await walletSpendableKobo(userId)).toBe(600000);
    expect(await denormWalletKobo(userId)).toBe(600000);
    expect(await magnitude("settlement_payout", "house")).toBe(payoutBefore);
    expect(await magnitude("pooled_cash", "house")).toBe(pooledBefore - 300000);

    const walletAccount = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { kind_ownerRef: { kind: LedgerAccountKind.UserWallet, ownerRef: userId } }
    });
    const entries = await prisma.ledgerEntry.findMany({ where: { accountId: walletAccount.id } });
    const drTotal = entries
      .filter((e) => e.direction === "DR")
      .reduce((acc, e) => acc + e.amountKobo, 0n);
    const crTotal = entries
      .filter((e) => e.direction === "CR")
      .reduce((acc, e) => acc + e.amountKobo, 0n);
    expect(Number(crTotal - drTotal)).toBe(600000);
  });
});
