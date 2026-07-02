import { BadRequestException } from "@nestjs/common";
import { LedgerDirection, LedgerRepository } from "@paadi/domain";
import { SettlementType as DbSettlementType } from "@paadi/db";
import type { PaginationQuery } from "@paadi/contracts";
import { ActivityFeedService } from "./activity-feed.service";
import {
  ActivityRow,
  compareRowsDesc,
  composeHeadline,
  decodeActivityCursor,
  encodeActivityCursor,
  isBeforeCursor,
  paymentToRow,
  potExpiredRow,
  settlementToRow,
  walletEntryToRow,
} from "./activity.mappers";

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: overrides.id ?? "row-1",
    type: overrides.type ?? "contribution_received",
    occurredAt: overrides.occurredAt ?? new Date("2026-07-01T10:00:00.000Z"),
    sourceTag: overrides.sourceTag ?? "payment",
    sourceId: overrides.sourceId ?? "p1",
    potId: overrides.potId ?? null,
    potTitle: overrides.potTitle ?? null,
    actorName: overrides.actorName ?? null,
    amountKobo: overrides.amountKobo ?? null,
    meta: overrides.meta ?? null,
  };
}

describe("activity mappers: source -> ActivityRow", () => {
  it("paymentToRow: contribution_received, actor from senderName, positive amount", () => {
    const r = paymentToRow(
      {
        id: "pay-1",
        potId: "pot-1",
        amountKobo: 250000n,
        senderName: "Marcus Smith",
        status: "succeeded",
        splitId: "split-1",
        createdAt: new Date("2026-07-01T09:00:00.000Z"),
      },
      "Friday Pizza",
    );

    expect(r.type).toBe("contribution_received");
    expect(r.actorName).toBe("Marcus Smith");
    expect(r.amountKobo).toBe(250000);
    expect(r.potTitle).toBe("Friday Pizza");
    expect(r.sourceTag).toBe("payment");
    expect(r.sourceId).toBe("pay-1");
  });

  it("paymentToRow: a card payer with no originator becomes 'Someone'", () => {
    const r = paymentToRow(
      {
        id: "pay-2",
        potId: "pot-1",
        amountKobo: 100000n,
        senderName: null,
        status: "succeeded",
        splitId: null,
        createdAt: new Date(),
      },
      "Friday Pizza",
    );
    expect(r.actorName).toBe("Someone");
  });

  it("potExpiredRow: carries collectedPct rounded from collected/target", () => {
    const r = potExpiredRow({
      id: "pot-1",
      title: "Dinner Split",
      status: "EXPIRED",
      collectedKobo: 800000n,
      targetKobo: 1000000n,
      createdAt: new Date("2026-06-30T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(r.type).toBe("pot_expired");
    expect(r.meta).toEqual({ collectedPct: 80 });
  });

  it("settlementToRow: BILL_PAYMENT maps to pot_settled_bill and carries the vend token", () => {
    const r = settlementToRow(
      {
        id: "st-1",
        potId: "pot-1",
        type: DbSettlementType.BILL_PAYMENT,
        amountKobo: 1800000n,
        vendToken: "1234-5678",
        nombaRef: "nomba-ref-1",
        settledAt: new Date("2026-07-01T08:00:00.000Z"),
        createdAt: new Date("2026-07-01T07:00:00.000Z"),
      },
      "Ikeja Light",
    );
    expect(r.type).toBe("pot_settled_bill");
    expect(r.meta).toEqual({ nombaRef: "nomba-ref-1", vendToken: "1234-5678" });
    expect(r.occurredAt).toEqual(new Date("2026-07-01T08:00:00.000Z"));
  });

  it("settlementToRow: BANK_PAYOUT maps to pot_settled_bank without a vend token", () => {
    const r = settlementToRow(
      {
        id: "st-2",
        potId: "pot-1",
        type: DbSettlementType.BANK_PAYOUT,
        amountKobo: 1500000n,
        vendToken: null,
        nombaRef: "nomba-ref-2",
        settledAt: null,
        createdAt: new Date("2026-07-01T07:30:00.000Z"),
      },
      "Rent June",
    );
    expect(r.type).toBe("pot_settled_bank");
    expect(r.meta).toEqual({ nombaRef: "nomba-ref-2" });
    expect(r.occurredAt).toEqual(new Date("2026-07-01T07:30:00.000Z"));
  });

  it("walletEntryToRow: a CR entry is wallet_credit (positive); a DR entry is wallet_withdrawal (negative)", () => {
    const credit = walletEntryToRow(
      {
        entryId: "w1",
        transactionId: "t1",
        kind: "wallet_credit",
        ownerRef: "user-1",
        direction: LedgerDirection.Credit,
        amountKobo: 500000,
        refType: null,
        refId: null,
        memo: null,
        occurredAt: new Date("2026-07-01T10:00:00.000Z"),
        potId: null,
      },
      null,
    );
    const debit = walletEntryToRow(
      {
        entryId: "w2",
        transactionId: "t2",
        kind: "withdrawal",
        ownerRef: "user-1",
        direction: LedgerDirection.Debit,
        amountKobo: 300000,
        refType: null,
        refId: null,
        memo: null,
        occurredAt: new Date("2026-07-01T09:00:00.000Z"),
        potId: null,
      },
      null,
    );

    expect(credit.type).toBe("wallet_credit");
    expect(credit.amountKobo).toBe(500000);
    expect(debit.type).toBe("wallet_withdrawal");
    expect(debit.amountKobo).toBe(-300000);
  });

  it("walletEntryToRow: wallet_settlement maps to wallet_settlement_in", () => {
    const r = walletEntryToRow(
      {
        entryId: "w3",
        transactionId: "t3",
        kind: "wallet_settlement",
        ownerRef: "user-1",
        direction: LedgerDirection.Credit,
        amountKobo: 1200000,
        refType: "settlement",
        refId: "st-1",
        memo: null,
        occurredAt: new Date(),
        potId: "pot-1",
      },
      "Rent June",
    );
    expect(r.type).toBe("wallet_settlement_in");
  });
});

describe("activity headline composition (screen-copy shape)", () => {
  it("contribution_received -> 'X paid ₦N to <pot>'", () => {
    expect(
      composeHeadline(
        row({
          type: "contribution_received",
          actorName: "Marcus Smith",
          amountKobo: 250000,
          potTitle: "Friday Pizza",
        }),
      ),
    ).toBe("Marcus Smith paid ₦2,500 to Friday Pizza");
  });

  it("pot_created -> 'You created a new pot: <pot>'", () => {
    expect(
      composeHeadline(row({ type: "pot_created", potTitle: "Weekend Trip" })),
    ).toBe("You created a new pot: Weekend Trip");
  });

  it("pot_settled_wallet -> '<pot> settled to your wallet'", () => {
    expect(
      composeHeadline(row({ type: "pot_settled_wallet", potTitle: "Rent June" })),
    ).toBe("Rent June settled to your wallet");
  });

  it("pot_expired -> '<pot> expired with N% collected'", () => {
    expect(
      composeHeadline(
        row({
          type: "pot_expired",
          potTitle: "Dinner Split",
          meta: { collectedPct: 80 },
        }),
      ),
    ).toBe("Dinner Split expired with 80% collected");
  });

  it("wallet_withdrawal -> uses the absolute amount despite the negative signed value", () => {
    expect(
      composeHeadline(row({ type: "wallet_withdrawal", amountKobo: -300000 })),
    ).toBe("Withdrew ₦3,000 from your wallet");
  });
});

describe("activity keyset ordering + cursor tie-break", () => {
  it("compareRowsDesc: newest first, then breaks ties on sourceTag, then sourceId", () => {
    const older = row({ occurredAt: new Date("2026-07-01T09:00:00.000Z") });
    const newer = row({ occurredAt: new Date("2026-07-01T10:00:00.000Z") });
    expect(compareRowsDesc(older, newer)).toBeGreaterThan(0);
    expect(compareRowsDesc(newer, older)).toBeLessThan(0);

    const at = new Date("2026-07-01T10:00:00.000Z");
    const payment = row({ occurredAt: at, sourceTag: "payment", sourceId: "x" });
    const wallet = row({ occurredAt: at, sourceTag: "wallet", sourceId: "x" });
    expect(compareRowsDesc(wallet, payment)).toBeLessThan(0);
    expect(compareRowsDesc(payment, wallet)).toBeGreaterThan(0);

    const a = row({ occurredAt: at, sourceTag: "payment", sourceId: "a" });
    const b = row({ occurredAt: at, sourceTag: "payment", sourceId: "b" });
    expect(compareRowsDesc(b, a)).toBeLessThan(0);
    expect(compareRowsDesc(a, b)).toBeGreaterThan(0);
  });

  it("encode/decode round-trips the (occurredAt, sourceTag, sourceId) cursor", () => {
    const cursor = {
      occurredAt: new Date("2026-07-01T10:00:00.000Z"),
      sourceTag: "wallet",
      sourceId: "entry-9",
    };
    expect(decodeActivityCursor(encodeActivityCursor(cursor))).toEqual(cursor);
  });

  it("isBeforeCursor keeps the walk total-ordered across source types at an equal instant", () => {
    const at = new Date("2026-07-01T10:00:00.000Z");
    const cursor = { occurredAt: at, sourceTag: "payment", sourceId: "m" };
    expect(isBeforeCursor(row({ occurredAt: at, sourceTag: "wallet", sourceId: "m" }), cursor)).toBe(true);
    expect(isBeforeCursor(row({ occurredAt: at, sourceTag: "payment", sourceId: "z" }), cursor)).toBe(true);
    expect(isBeforeCursor(row({ occurredAt: at, sourceTag: "payment", sourceId: "a" }), cursor)).toBe(false);
    expect(
      isBeforeCursor(
        row({ occurredAt: new Date("2026-07-01T11:00:00.000Z"), sourceTag: "payment", sourceId: "m" }),
        cursor,
      ),
    ).toBe(false);
  });

  it("rejects a tampered cursor with 400", () => {
    const bad = Buffer.from("only|two", "utf8").toString("base64url");
    expect(() => decodeActivityCursor(bad)).toThrow(BadRequestException);
    expect(decodeActivityCursor(undefined)).toBeUndefined();
  });
});

interface PrismaActivityFixtures {
  pots?: {
    id: string;
    title: string;
    status: string;
    collectedKobo: bigint;
    targetKobo: bigint;
    createdAt: Date;
    updatedAt: Date;
  }[];
  potsByCreator?: string[];
  payments?: {
    id: string;
    potId: string;
    amountKobo: bigint;
    senderName: string | null;
    status: string;
    splitId: string | null;
    createdAt: Date;
  }[];
  settlements?: {
    id: string;
    potId: string;
    type: DbSettlementType;
    amountKobo: bigint;
    vendToken: string | null;
    nombaRef: string | null;
    settledAt: Date | null;
    createdAt: Date;
  }[];
  potNudges?: {
    potId: string;
    sentAt: Date;
    recipientCount: number;
  }[];
  splitCount?: number;
  distinctPaidSplits?: { splitId: string | null }[];
}

function makeActivityPrisma(fixtures: PrismaActivityFixtures) {
  return {
    pot: {
      findMany: jest.fn(async (arg: { where: Record<string, unknown> }) => {
        const where = arg.where as {
          creatorId?: string;
          id?: { in: string[] };
        };
        if (where.creatorId) {
          return (fixtures.potsByCreator ?? []).map((id) => ({ id }));
        }
        if (where.id) {
          return (fixtures.pots ?? []).filter((p) =>
            where.id!.in.includes(p.id),
          );
        }
        return [];
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const pot = (fixtures.pots ?? []).find((p) => p.id === where.id);
        return pot
          ? { collectedKobo: pot.collectedKobo, targetKobo: pot.targetKobo }
          : null;
      }),
    },
    payment: {
      findMany: jest.fn(async (arg: { distinct?: string[] }) => {
        if (arg.distinct) {
          return fixtures.distinctPaidSplits ?? [];
        }
        return fixtures.payments ?? [];
      }),
    },
    settlement: {
      findMany: jest.fn(async () => fixtures.settlements ?? []),
    },
    potNudge: {
      findMany: jest.fn(async () => fixtures.potNudges ?? []),
    },
    split: {
      count: jest.fn(async () => fixtures.splitCount ?? 0),
    },
  };
}

function makeLedger(entries: unknown[]) {
  return {
    listAccountEntries: jest.fn(async () => ({ items: entries, nextCursor: null })),
  };
}

function makeActivityService(
  prisma: unknown,
  ledger: unknown,
): ActivityFeedService {
  return new ActivityFeedService(
    prisma as never,
    ledger as unknown as LedgerRepository,
  );
}

const PAGE: PaginationQuery = { limit: 20 };

describe("ActivityFeedService.getContributionsSummary (COUNT DISTINCT paid split)", () => {
  it("counts a split paid in two installments once; two paid splits count twice", async () => {
    const twoInstallmentsOneSplit = makeActivityService(
      makeActivityPrisma({
        pots: [
          {
            id: "pot-1",
            title: "Friday Pizza",
            status: "OPEN",
            collectedKobo: 500000n,
            targetKobo: 900000n,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        splitCount: 3,
        distinctPaidSplits: [{ splitId: "split-1" }],
      }),
      makeLedger([]),
    );

    const oneSplit = await twoInstallmentsOneSplit.getContributionsSummary("pot-1");
    expect(oneSplit.contributorCount).toBe(1);
    expect(oneSplit.paidSplitCount).toBe(1);
    expect(oneSplit.totalSplitCount).toBe(3);
    expect(oneSplit.collectedKobo).toBe(500000);
    expect(oneSplit.targetKobo).toBe(900000);

    const twoSplits = makeActivityService(
      makeActivityPrisma({
        pots: [
          {
            id: "pot-1",
            title: "Friday Pizza",
            status: "OPEN",
            collectedKobo: 600000n,
            targetKobo: 900000n,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        splitCount: 3,
        distinctPaidSplits: [{ splitId: "split-1" }, { splitId: "split-2" }],
      }),
      makeLedger([]),
    );
    const summary = await twoSplits.getContributionsSummary("pot-1");
    expect(summary.contributorCount).toBe(2);
    expect(summary.paidSplitCount).toBe(2);
  });
});

describe("ActivityFeedService pot nudges", () => {
  it("surfaces a PotNudge row as reminder_sent with recipientCount metadata", async () => {
    const service = makeActivityService(
      makeActivityPrisma({
        pots: [
          {
            id: "pot-1",
            title: "Friday Pizza",
            status: "OPEN",
            collectedKobo: 100000n,
            targetKobo: 300000n,
            createdAt: new Date("2026-07-01T09:00:00.000Z"),
            updatedAt: new Date("2026-07-01T09:00:00.000Z"),
          },
        ],
        potsByCreator: ["pot-1"],
        splitCount: 3,
        potNudges: [
          {
            potId: "pot-1",
            sentAt: new Date("2026-07-01T10:00:00.000Z"),
            recipientCount: 2,
          },
        ],
      }),
      makeLedger([]),
    );

    const page = await service.getGlobalActivity("user-1", PAGE);
    const reminder = page.items.find((item) => item.type === "reminder_sent");

    expect(reminder).toBeDefined();
    expect(reminder?.meta).toEqual({ recipientCount: 2 });
  });
});

describe("ActivityFeedService.getPotActivity", () => {
  it("lists contributions on the paid splits with the summary, newest first", async () => {
    const service = makeActivityService(
      makeActivityPrisma({
        pots: [
          {
            id: "pot-1",
            title: "Friday Pizza",
            status: "OPEN",
            collectedKobo: 400000n,
            targetKobo: 900000n,
            createdAt: new Date("2026-07-01T08:00:00.000Z"),
            updatedAt: new Date("2026-07-01T08:00:00.000Z"),
          },
        ],
        payments: [
          {
            id: "pay-1",
            potId: "pot-1",
            amountKobo: 250000n,
            senderName: "Marcus Smith",
            status: "succeeded",
            splitId: "split-1",
            createdAt: new Date("2026-07-01T09:00:00.000Z"),
          },
          {
            id: "pay-2",
            potId: "pot-1",
            amountKobo: 150000n,
            senderName: "Sarah Lee",
            status: "succeeded",
            splitId: "split-2",
            createdAt: new Date("2026-07-01T10:00:00.000Z"),
          },
        ],
        splitCount: 3,
        distinctPaidSplits: [{ splitId: "split-1" }, { splitId: "split-2" }],
      }),
      makeLedger([]),
    );

    const result = await service.getPotActivity("pot-1", PAGE);

    const contributions = result.items.filter(
      (i) => i.type === "contribution_received",
    );
    expect(contributions).toHaveLength(2);
    expect(contributions[0].actorName).toBe("Sarah Lee");
    expect(result.contributions.contributorCount).toBe(2);
    expect(result.contributions.paidSplitCount).toBe(2);
    expect(result.contributions.totalSplitCount).toBe(3);

    const times = result.items.map((i) => Date.parse(i.occurredAt));
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });
});

describe("ActivityFeedService.getGlobalActivity (union across pots + wallet)", () => {
  it("merges pot activity and wallet movements into one reverse-chron feed with headlines", async () => {
    const walletEntry = {
      entryId: "w1",
      transactionId: "t1",
      kind: "wallet_settlement",
      ownerRef: "user-1",
      direction: LedgerDirection.Credit,
      amountKobo: 1200000,
      refType: "settlement",
      refId: "st-1",
      memo: null,
      occurredAt: new Date("2026-07-01T11:00:00.000Z"),
      potId: null,
    };
    const service = makeActivityService(
      makeActivityPrisma({
        potsByCreator: ["pot-1"],
        pots: [
          {
            id: "pot-1",
            title: "Beach Trip",
            status: "OPEN",
            collectedKobo: 400000n,
            targetKobo: 900000n,
            createdAt: new Date("2026-07-01T08:00:00.000Z"),
            updatedAt: new Date("2026-07-01T08:00:00.000Z"),
          },
        ],
        payments: [
          {
            id: "pay-1",
            potId: "pot-1",
            amountKobo: 250000n,
            senderName: "Marcus Smith",
            status: "succeeded",
            splitId: "split-1",
            createdAt: new Date("2026-07-01T09:00:00.000Z"),
          },
        ],
      }),
      makeLedger([walletEntry]),
    );

    const result = await service.getGlobalActivity("user-1", PAGE);

    const types = result.items.map((i) => i.type);
    expect(types).toContain("contribution_received");
    expect(types).toContain("pot_created");
    expect(types).toContain("wallet_settlement_in");

    const times = result.items.map((i) => Date.parse(i.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(result.items[0].type).toBe("wallet_settlement_in");
    for (const item of result.items) {
      expect(item.headline.length).toBeGreaterThan(0);
    }
  });

  it("a user with zero pots and zero wallet activity gets an empty page", async () => {
    const service = makeActivityService(
      makeActivityPrisma({ potsByCreator: [] }),
      makeLedger([]),
    );
    const result = await service.getGlobalActivity("ghost", PAGE);
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("trims to limit and sets nextCursor when more rows exist than the page size", async () => {
    const payments = Array.from({ length: 5 }, (_, i) => ({
      id: `pay-${i}`,
      potId: "pot-1",
      amountKobo: 100000n,
      senderName: `Payer ${i}`,
      status: "succeeded",
      splitId: `split-${i}`,
      createdAt: new Date(Date.UTC(2026, 6, 1, 9 + i)),
    }));
    const service = makeActivityService(
      makeActivityPrisma({
        potsByCreator: ["pot-1"],
        pots: [
          {
            id: "pot-1",
            title: "Beach Trip",
            status: "OPEN",
            collectedKobo: 500000n,
            targetKobo: 900000n,
            createdAt: new Date(Date.UTC(2026, 6, 1, 8)),
            updatedAt: new Date(Date.UTC(2026, 6, 1, 8)),
          },
        ],
        payments,
      }),
      makeLedger([]),
    );

    const result = await service.getGlobalActivity("user-1", { limit: 3 });

    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).not.toBeNull();
    const ids = result.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
