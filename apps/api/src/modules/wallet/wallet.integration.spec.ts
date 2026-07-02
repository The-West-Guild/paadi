import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import {
  CompletionRule as DbCompletionRule,
  LedgerDirection as DbLedgerDirection,
  PaymentMethod as DbPaymentMethod,
  PotStatus as DbPotStatus,
  PrismaService,
  SettlementType as DbSettlementType,
  ShareStatus as DbShareStatus,
} from "@paadi/db";
import { LedgerAccountKind } from "@paadi/domain";
import type { AccessClaims } from "../../infra/auth/token.service";
import { PrismaLedgerRepository } from "../../infra/persistence/ledger.repository";
import { MockNombaProvider } from "../../integrations/nomba/mock-nomba.provider";
import { ActivityController } from "../activity/activity.controller";
import { ActivityFeedService } from "../activity/activity-feed.service";
import { ReceiptsController } from "../receipts/receipts.controller";
import { ReceiptsService } from "../receipts/receipts.service";
import { ReconciliationReportService } from "../reconciliation/reconciliation-report.service";
import { WalletStatementService } from "./wallet-statement.service";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://paadi:paadi@localhost:5433/paadi";

function claims(sub: string): AccessClaims {
  return { sub, sid: "sid-1", tier: "TIER_1" } as AccessClaims;
}

describe("Chunk 9 statements/reporting (integration, real Postgres :5433)", () => {
  let prisma: PrismaService;
  let ledger: PrismaLedgerRepository;
  let provider: MockNombaProvider;
  let walletStatement: WalletStatementService;
  let activity: ActivityFeedService;
  let activityController: ActivityController;
  let receipts: ReceiptsService;
  let receiptsController: ReceiptsController;
  let reconciliation: ReconciliationReportService;

  const userIds: string[] = [];
  const potIds: string[] = [];
  const nombaTransactionIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new PrismaLedgerRepository(prisma);
    provider = new MockNombaProvider();
    walletStatement = new WalletStatementService(prisma, ledger);
    activity = new ActivityFeedService(prisma, ledger);
    activityController = new ActivityController(activity, prisma);
    receipts = new ReceiptsService(prisma);
    receiptsController = new ReceiptsController(receipts);
    reconciliation = new ReconciliationReportService(prisma, ledger, provider);
  });

  afterAll(async () => {
    if (potIds.length > 0 || userIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({
        where: { account: { ownerRef: { in: [...potIds, ...userIds, "house"] } } },
      });
      await prisma.ledgerEntry.deleteMany({
        where: { transaction: { potId: { in: potIds } } },
      });
      await prisma.ledgerTransaction.deleteMany({
        where: { OR: [{ potId: { in: potIds } }, { refId: { in: nombaTransactionIds } }] },
      });
      await prisma.ledgerAccount.deleteMany({
        where: { ownerRef: { in: [...potIds, ...userIds] } },
      });
    }
    if (nombaTransactionIds.length > 0) {
      await prisma.walletCredit.deleteMany({
        where: { nombaTransactionId: { in: nombaTransactionIds } },
      });
    }
    if (potIds.length > 0) {
      await prisma.settlement.deleteMany({ where: { potId: { in: potIds } } });
      await prisma.payment.deleteMany({ where: { potId: { in: potIds } } });
      await prisma.split.deleteMany({ where: { potId: { in: potIds } } });
      await prisma.pot.deleteMany({ where: { id: { in: potIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { phoneBlindIndex: `pbi-${randomUUID()}`, phoneEncrypted: "enc" },
    });
    userIds.push(user.id);
    return user.id;
  }

  async function creditWalletFromVa(
    userId: string,
    amountKobo: number,
    sender: { name: string; bank: string },
  ): Promise<string> {
    const nombaTransactionId = `ntx-${randomUUID()}`;
    nombaTransactionIds.push(nombaTransactionId);
    const credit = await prisma.walletCredit.create({
      data: {
        userId,
        nombaTransactionId,
        amountKobo: BigInt(amountKobo),
        senderName: sender.name,
        senderBank: sender.bank,
        senderAccount: "0123456789",
        senderBankCode: "058",
        status: "succeeded",
      },
    });
    await postWalletTxn({
      kind: "wallet_credit",
      refType: "payment",
      refId: credit.id,
      userDirection: "CR",
      userId,
      amountKobo,
    });
    return credit.id;
  }

  async function debitWalletForShare(
    userId: string,
    amountKobo: number,
  ): Promise<void> {
    await postWalletTxn({
      kind: "wallet_contribution",
      userDirection: "DR",
      userId,
      amountKobo,
    });
  }

  async function postWalletTxn(args: {
    kind: string;
    refType?: string;
    refId?: string;
    userDirection: "CR" | "DR";
    userId: string;
    amountKobo: number;
    potId?: string;
  }): Promise<void> {
    const walletAccountId = await resolveAccount(
      LedgerAccountKind.UserWallet,
      args.userId,
    );
    const pooledAccountId = await resolveAccount(
      LedgerAccountKind.PooledCash,
      "house",
    );
    const userSide =
      args.userDirection === "CR" ? DbLedgerDirection.CR : DbLedgerDirection.DR;
    const houseSide =
      args.userDirection === "CR" ? DbLedgerDirection.DR : DbLedgerDirection.CR;
    const userEntry = {
      accountId: walletAccountId,
      direction: userSide,
      amountKobo: BigInt(args.amountKobo),
    };
    const houseEntry = {
      accountId: pooledAccountId,
      direction: houseSide,
      amountKobo: BigInt(args.amountKobo),
    };
    await prisma.ledgerTransaction.create({
      data: {
        kind: args.kind,
        potId: args.potId ?? null,
        refType: args.refType ?? null,
        refId: args.refId ?? null,
        entries: { create: [userEntry, houseEntry] },
      },
    });
  }

  async function resolveAccount(kind: string, ownerRef: string): Promise<string> {
    await prisma.$executeRaw`
      INSERT INTO "LedgerAccount" (id, kind, "ownerRef")
      VALUES (${randomUUID()}, ${kind}, ${ownerRef})
      ON CONFLICT (kind, "ownerRef") DO NOTHING
    `;
    const account = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { kind_ownerRef: { kind, ownerRef } },
    });
    return account.id;
  }

  async function fundLiability(potId: string, amountKobo: number): Promise<void> {
    await ledger.record({
      kind: "collection",
      potId,
      entries: [
        { account: { kind: "pooled_cash", ownerRef: "house" }, direction: "DR", amountKobo },
        { account: { kind: "pot_liability", ownerRef: potId }, direction: "CR", amountKobo },
      ],
    });
  }

  async function directWalletBalance(userId: string): Promise<number> {
    const account = await prisma.ledgerAccount.findUnique({
      where: {
        kind_ownerRef: { kind: LedgerAccountKind.UserWallet, ownerRef: userId },
      },
    });
    if (!account) {
      return 0;
    }
    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId: account.id },
      select: { direction: true, amountKobo: true },
    });
    const netDrMinusCr = entries.reduce(
      (acc, e) => acc + (e.direction === "DR" ? e.amountKobo : -e.amountKobo),
      0n,
    );
    return -Number(netDrMinusCr);
  }

  it("statement reflects the ledger: a VA credit and a pay-from-wallet debit produce 2 rows with correct directions and balance", async () => {
    const userId = await seedUser();
    await creditWalletFromVa(userId, 500000, { name: "Marcus Smith", bank: "GTBank" });
    await debitWalletForShare(userId, 200000);

    const page = await walletStatement.getStatement(userId, { limit: 20 });
    expect(page.items).toHaveLength(2);

    const credit = page.items.find((i) => i.direction === "credit");
    const debit = page.items.find((i) => i.direction === "debit");
    expect(credit).toBeDefined();
    expect(debit).toBeDefined();
    expect(credit!.amountKobo).toBe(500000);
    expect(debit!.amountKobo).toBe(-200000);
    expect(credit!.kind).toBe("va_credit");
    expect(credit!.counterparty).toBe("Marcus Smith");

    const balance = await walletStatement.getBalance(userId);
    expect(balance.balanceKobo).toBe(300000);
    expect(page.balanceKobo).toBe(300000);

    const direct = await directWalletBalance(userId);
    expect(direct).toBe(300000);
    expect(page.balanceKobo).toBe(direct);

    const accountBalance = await ledger.accountBalanceKobo(
      LedgerAccountKind.UserWallet,
      userId,
    );
    expect(accountBalance).toBe(300000);
    expect(balance.balanceKobo).toBe(accountBalance);
  });

  it("pagination completeness: walking nextCursor yields exactly N rows, no dupes, no gaps, strict reverse-chron", async () => {
    const userId = await seedUser();
    const total = 7;
    for (let i = 0; i < total; i += 1) {
      await creditWalletFromVa(userId, 10000 * (i + 1), {
        name: `Payer ${i}`,
        bank: "GTBank",
      });
    }

    const seen: string[] = [];
    const times: number[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const page = await walletStatement.getStatement(userId, { limit: 2, cursor });
      for (const item of page.items) {
        seen.push(item.id);
        times.push(Date.parse(item.occurredAt));
      }
      cursor = page.nextCursor ?? undefined;
      guard += 1;
      expect(guard).toBeLessThan(20);
    } while (cursor);

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    const descTimes = [...times].sort((a, b) => b - a);
    expect(times).toEqual(descTimes);
  });

  it("pot activity + summary: two paid splits of three -> two contributions, contributorCount 2, paidSplitCount 2, totalSplitCount 3", async () => {
    const creatorId = await seedUser();
    const pot = await prisma.pot.create({
      data: {
        creatorId,
        title: "Beach Trip",
        totalKobo: 900000n,
        targetKobo: 900000n,
        collectedKobo: 400000n,
        settlementType: DbSettlementType.WALLET,
        completionRule: DbCompletionRule.PROGRESSIVE,
        status: DbPotStatus.OPEN,
      },
    });
    potIds.push(pot.id);
    const splits = await Promise.all(
      [0, 1, 2].map((i) =>
        prisma.split.create({
          data: {
            potId: pot.id,
            label: `Share ${i}`,
            weight: 1,
            shareKobo: 300000n,
            status: DbShareStatus.PENDING,
            payToken: `pt-${randomUUID()}`,
          },
        }),
      ),
    );
    for (const [i, split] of [splits[0], splits[1]].entries()) {
      const ntx = `ntx-${randomUUID()}`;
      nombaTransactionIds.push(ntx);
      await prisma.payment.create({
        data: {
          potId: pot.id,
          splitId: split.id,
          nombaTransactionId: ntx,
          amountKobo: 200000n,
          method: DbPaymentMethod.TRANSFER,
          senderName: i === 0 ? "Marcus Smith" : "Sarah Lee",
          status: "succeeded",
        },
      });
    }

    const result = await activity.getPotActivity(pot.id, { limit: 20 });
    const contributions = result.items.filter(
      (i) => i.type === "contribution_received",
    );
    expect(contributions).toHaveLength(2);
    expect(result.contributions.contributorCount).toBe(2);
    expect(result.contributions.paidSplitCount).toBe(2);
    expect(result.contributions.totalSplitCount).toBe(3);

    const created = result.items.filter((i) => i.type === "pot_created");
    expect(created).toHaveLength(1);
  });

  it("contributorCount counts a split paid in two installments once", async () => {
    const creatorId = await seedUser();
    const pot = await prisma.pot.create({
      data: {
        creatorId,
        title: "Installments",
        totalKobo: 300000n,
        targetKobo: 300000n,
        collectedKobo: 300000n,
        settlementType: DbSettlementType.WALLET,
        completionRule: DbCompletionRule.PROGRESSIVE,
        status: DbPotStatus.OPEN,
      },
    });
    potIds.push(pot.id);
    const split = await prisma.split.create({
      data: {
        potId: pot.id,
        label: "Only",
        weight: 1,
        shareKobo: 300000n,
        status: DbShareStatus.PAID,
        payToken: `pt-${randomUUID()}`,
      },
    });
    for (const amount of [150000n, 150000n]) {
      const ntx = `ntx-${randomUUID()}`;
      nombaTransactionIds.push(ntx);
      await prisma.payment.create({
        data: {
          potId: pot.id,
          splitId: split.id,
          nombaTransactionId: ntx,
          amountKobo: amount,
          method: DbPaymentMethod.TRANSFER,
          status: "succeeded",
        },
      });
    }

    const summary = await activity.getContributionsSummary(pot.id);
    expect(summary.contributorCount).toBe(1);
    expect(summary.paidSplitCount).toBe(1);
    expect(summary.totalSplitCount).toBe(1);
  });

  it("authorization: user B cannot read user A's pot activity (403) nor A's receipts (403)", async () => {
    const creatorId = await seedUser();
    const strangerId = await seedUser();
    const pot = await prisma.pot.create({
      data: {
        creatorId,
        title: "Private Pot",
        totalKobo: 500000n,
        targetKobo: 500000n,
        collectedKobo: 500000n,
        settlementType: DbSettlementType.WALLET,
        completionRule: DbCompletionRule.PROGRESSIVE,
        status: DbPotStatus.FUNDED,
      },
    });
    potIds.push(pot.id);
    const ntx = `ntx-${randomUUID()}`;
    nombaTransactionIds.push(ntx);
    const payment = await prisma.payment.create({
      data: {
        potId: pot.id,
        nombaTransactionId: ntx,
        amountKobo: 500000n,
        method: DbPaymentMethod.TRANSFER,
        senderName: "Marcus Smith",
        status: "succeeded",
      },
    });
    const settlement = await prisma.settlement.create({
      data: {
        potId: pot.id,
        type: DbSettlementType.WALLET,
        merchantTxRef: `settle:${pot.id}`,
        amountKobo: 500000n,
        status: "COMPLETED",
      },
    });

    await expect(
      activityController.potFeed(claims(strangerId), { id: pot.id }, { limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      receiptsController.payment(claims(strangerId), payment.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      receiptsController.settlement(claims(strangerId), settlement.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const ownerFeed = await activityController.potFeed(
      claims(creatorId),
      { id: pot.id },
      { limit: 20 },
    );
    expect(ownerFeed.contributions.paidSplitCount).toBe(0);
    const ownerReceipt = await receiptsController.payment(
      claims(creatorId),
      payment.id,
    );
    expect(ownerReceipt.kind).toBe("contribution");
  });

  it("reconciliation internal invariant: a balanced collection leaves internalDrift unchanged and moves pooled == pot_liability by the amount", async () => {
    const creatorId = await seedUser();
    const pot = await prisma.pot.create({
      data: {
        creatorId,
        title: "Reconciled Pot",
        totalKobo: 750000n,
        targetKobo: 750000n,
        collectedKobo: 750000n,
        settlementType: DbSettlementType.WALLET,
        completionRule: DbCompletionRule.PROGRESSIVE,
        status: DbPotStatus.FUNDED,
      },
    });
    potIds.push(pot.id);

    const before = await reconciliation.build();
    expect(before.internalDriftKobo).toBe(
      before.pooledCashKobo - before.sumLiabilitiesKobo,
    );
    expect(before.balanced).toBe(before.internalDriftKobo === 0);

    await fundLiability(pot.id, 750000);

    const after = await reconciliation.build();
    expect(after.pooledCashKobo).toBe(before.pooledCashKobo + 750000);
    expect(after.breakdown.potLiabilityKobo).toBe(
      before.breakdown.potLiabilityKobo + 750000,
    );
    expect(after.sumLiabilitiesKobo).toBe(before.sumLiabilitiesKobo + 750000);
    expect(after.internalDriftKobo).toBe(before.internalDriftKobo);
    expect(after.internalDriftKobo).toBe(
      after.pooledCashKobo - after.sumLiabilitiesKobo,
    );
  });

  it("reconciliation balanced flag is exactly (internalDriftKobo == 0) and itemizes per-kind subtotals", async () => {
    const report = await reconciliation.build();
    expect(report.balanced).toBe(report.internalDriftKobo === 0);
    expect(report.internalDriftKobo).toBe(
      report.pooledCashKobo - report.sumLiabilitiesKobo,
    );
    const b = report.breakdown;
    const reconstructed =
      b.potLiabilityKobo +
      b.userWalletKobo +
      b.exceptionsSuspenseKobo +
      b.refundsPayableKobo -
      b.settlementPayoutKobo -
      b.platformFeeKobo;
    expect(report.sumLiabilitiesKobo).toBe(reconstructed);
    expect(report.counts.wallets).toBeGreaterThanOrEqual(0);
  });

  it("reconciliation external cross-check: the mock provider yields a concrete nombaKobo and drift (no HTTP)", async () => {
    const report = await reconciliation.build();
    expect(report.external).not.toBe("unavailable");
    if (report.external !== "unavailable") {
      expect(report.external.nombaKobo).toBe(1_000_000_000);
      expect(report.external.externalDriftKobo).toBe(
        report.pooledCashKobo - 1_000_000_000,
      );
    }
  });

  it("read-only proof: hitting every Chunk-9 endpoint leaves Payment/Settlement/LedgerEntry/LedgerTransaction row counts unchanged", async () => {
    const creatorId = await seedUser();
    await creditWalletFromVa(creatorId, 400000, { name: "Ada Lovelace", bank: "GTBank" });
    const pot = await prisma.pot.create({
      data: {
        creatorId,
        title: "Snapshot Pot",
        totalKobo: 400000n,
        targetKobo: 400000n,
        collectedKobo: 400000n,
        settlementType: DbSettlementType.WALLET,
        completionRule: DbCompletionRule.PROGRESSIVE,
        status: DbPotStatus.FUNDED,
      },
    });
    potIds.push(pot.id);
    const ntx = `ntx-${randomUUID()}`;
    nombaTransactionIds.push(ntx);
    const payment = await prisma.payment.create({
      data: {
        potId: pot.id,
        nombaTransactionId: ntx,
        amountKobo: 400000n,
        method: DbPaymentMethod.TRANSFER,
        senderName: "Ada Lovelace",
        status: "succeeded",
      },
    });
    const settlement = await prisma.settlement.create({
      data: {
        potId: pot.id,
        type: DbSettlementType.WALLET,
        merchantTxRef: `settle:${pot.id}`,
        amountKobo: 400000n,
        status: "COMPLETED",
      },
    });

    const before = await snapshotCounts();

    await walletStatement.getBalance(creatorId);
    await walletStatement.getStatement(creatorId, { limit: 20 });
    await activityController.globalFeed(claims(creatorId), { limit: 20 });
    await activityController.potFeed(claims(creatorId), { id: pot.id }, { limit: 20 });
    await activity.getContributionsSummary(pot.id);
    await receiptsController.payment(claims(creatorId), payment.id);
    await receiptsController.settlement(claims(creatorId), settlement.id);
    await reconciliation.build();

    const after = await snapshotCounts();
    expect(after).toEqual(before);
  });

  async function snapshotCounts(): Promise<{
    payments: number;
    settlements: number;
    ledgerEntries: number;
    ledgerTransactions: number;
  }> {
    const [payments, settlements, ledgerEntries, ledgerTransactions] =
      await Promise.all([
        prisma.payment.count(),
        prisma.settlement.count(),
        prisma.ledgerEntry.count(),
        prisma.ledgerTransaction.count(),
      ]);
    return { payments, settlements, ledgerEntries, ledgerTransactions };
  }
});
