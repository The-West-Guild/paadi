import { BadRequestException } from "@nestjs/common";
import {
  LedgerAccountKind,
  LedgerDirection,
  LedgerEntryView,
  ListAccountEntriesArgs,
  ListAccountEntriesResult,
  LedgerRepository,
} from "@paadi/domain";
import type { StatementQuery } from "@paadi/contracts";
import {
  decodeLedgerEntryCursor,
  encodeLedgerEntryCursor,
} from "../../infra/persistence/mappers/ledger.mapper";
import { decodeStatementCursor, encodeStatementCursor } from "./statement-cursor";
import { WalletStatementService } from "./wallet-statement.service";

interface LedgerState {
  balances: Record<string, number>;
  entries: (LedgerEntryView & { potId?: string | null })[];
}

interface ListCall {
  kind: string;
  ownerRef: string;
  args: ListAccountEntriesArgs;
}

function makeLedger(state: LedgerState, listCalls: ListCall[]) {
  const ledger = {
    accountBalanceKobo: jest.fn(async (kind: string, ownerRef: string) => {
      return state.balances[`${kind}:${ownerRef}`] ?? 0;
    }),
    listAccountEntries: jest.fn(
      async (
        kind: string,
        ownerRef: string,
        args: ListAccountEntriesArgs,
      ): Promise<ListAccountEntriesResult> => {
        listCalls.push({ kind, ownerRef, args });
        let rows = state.entries;
        if (args.direction) {
          rows = rows.filter((e) => e.direction === args.direction);
        }
        if (args.from) {
          rows = rows.filter((e) => e.occurredAt >= args.from!);
        }
        if (args.to) {
          rows = rows.filter((e) => e.occurredAt <= args.to!);
        }
        const hasMore = rows.length > args.limit;
        const page = hasMore ? rows.slice(0, args.limit) : rows;
        const last = page.length > 0 ? page[page.length - 1] : null;
        const nextCursor =
          hasMore && last
            ? encodeLedgerEntryCursor({
                occurredAt: last.occurredAt,
                entryId: last.entryId,
              })
            : null;
        return { items: page, nextCursor };
      },
    ),
  };
  return ledger;
}

interface PrismaFixtures {
  pots?: { id: string; title: string }[];
  walletCredits?: { id: string; senderName: string | null; senderBank: string | null }[];
  settlements?: { id: string; nombaRef: string | null; potTitle: string | null }[];
  exceptions?: { id: string; nombaTransactionId: string }[];
  user?: { walletBalanceKobo: bigint } | null;
}

function makePrisma(fixtures: PrismaFixtures) {
  return {
    pot: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        (fixtures.pots ?? []).filter((p) => where.id.in.includes(p.id)),
      ),
    },
    walletCredit: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        (fixtures.walletCredits ?? []).filter((c) => where.id.in.includes(c.id)),
      ),
    },
    settlement: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        (fixtures.settlements ?? [])
          .filter((s) => where.id.in.includes(s.id))
          .map((s) => ({
            id: s.id,
            nombaRef: s.nombaRef,
            pot: s.potTitle ? { title: s.potTitle } : null,
          })),
      ),
    },
    reconciliationException: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        (fixtures.exceptions ?? []).filter((e) => where.id.in.includes(e.id)),
      ),
    },
    virtualAccount: {
      findUnique: jest.fn(async () => null),
    },
    user: {
      findUnique: jest.fn(async () =>
        fixtures.user === undefined ? null : fixtures.user,
      ),
    },
  };
}

type LedgerEntryWithPot = LedgerEntryView & { potId: string | null };

function entry(
  overrides: Partial<LedgerEntryWithPot>,
): LedgerEntryWithPot {
  return {
    entryId: overrides.entryId ?? "entry-1",
    transactionId: overrides.transactionId ?? "txn-1",
    kind: overrides.kind ?? "wallet_credit",
    ownerRef: overrides.ownerRef ?? "user-1",
    direction: overrides.direction ?? LedgerDirection.Credit,
    amountKobo: overrides.amountKobo ?? 500000,
    refType: overrides.refType ?? null,
    refId: overrides.refId ?? null,
    memo: overrides.memo ?? null,
    occurredAt: overrides.occurredAt ?? new Date("2026-07-01T10:00:00.000Z"),
    potId: overrides.potId ?? null,
  };
}

function makeService(ledger: unknown, prisma: unknown): WalletStatementService {
  return new WalletStatementService(
    prisma as never,
    ledger as unknown as LedgerRepository,
  );
}

const BASE_QUERY: StatementQuery = { limit: 20 };

describe("WalletStatementService.getBalance CR-normal sign", () => {
  it("returns +3000 for a user_wallet with CR 5000 / DR 2000 (never negative for the holder)", async () => {
    const listCalls: ListCall[] = [];
    const ledger = makeLedger(
      { balances: { "user_wallet:user-1": 3000 }, entries: [] },
      listCalls,
    );
    const service = makeService(ledger, makePrisma({ user: null }));

    const result = await service.getBalance("user-1");

    expect(ledger.accountBalanceKobo).toHaveBeenCalledWith(
      LedgerAccountKind.UserWallet,
      "user-1",
    );
    expect(result.balanceKobo).toBe(3000);
    expect(result.currency).toBe("NGN");
    expect(result.virtualAccount).toBeNull();
  });

  it("returns 0 and virtualAccount null for a user with no wallet activity (never 404s)", async () => {
    const ledger = makeLedger({ balances: {}, entries: [] }, []);
    const service = makeService(ledger, makePrisma({ user: null }));

    const result = await service.getBalance("ghost");

    expect(result.balanceKobo).toBe(0);
    expect(result.virtualAccount).toBeNull();
  });

  it("returns the ledger value (not the denorm) and does not throw when the denorm disagrees", async () => {
    const ledger = makeLedger(
      { balances: { "user_wallet:user-1": 3000 }, entries: [] },
      [],
    );
    const service = makeService(
      ledger,
      makePrisma({ user: { walletBalanceKobo: 9999n } }),
    );

    const result = await service.getBalance("user-1");

    expect(result.balanceKobo).toBe(3000);
  });
});

describe("WalletStatementService.getStatement enrichment mapping", () => {
  async function firstItem(
    e: LedgerEntryWithPot,
    fixtures: PrismaFixtures = {},
  ) {
    const ledger = makeLedger({ balances: {}, entries: [e] }, []);
    const service = makeService(ledger, makePrisma(fixtures));
    const page = await service.getStatement("user-1", BASE_QUERY);
    return page.items[0];
  }

  it("va_credit (wallet_credit + refType payment) -> credit, names the sender, positive amount", async () => {
    const item = await firstItem(
      entry({
        kind: "wallet_credit",
        direction: LedgerDirection.Credit,
        amountKobo: 500000,
        refType: "payment",
        refId: "wc-1",
      }),
      {
        walletCredits: [{ id: "wc-1", senderName: "Marcus Smith", senderBank: "GTBank" }],
      },
    );

    expect(item.kind).toBe("va_credit");
    expect(item.direction).toBe("credit");
    expect(item.amountKobo).toBe(500000);
    expect(item.counterparty).toBe("Marcus Smith");
    expect(item.description).toBe("Received ₦5,000 from Marcus Smith");
  });

  it("va_credit with no sender record -> generic 'Received', counterparty null, never blank", async () => {
    const item = await firstItem(
      entry({
        kind: "wallet_credit",
        direction: LedgerDirection.Credit,
        amountKobo: 250000,
        refType: "va_credit",
        refId: "missing",
      }),
    );

    expect(item.kind).toBe("va_credit");
    expect(item.counterparty).toBeNull();
    expect(item.description).toBe("Received ₦2,500");
    expect(item.description.length).toBeGreaterThan(0);
  });

  it("wallet_contribution (split payment) -> debit, negative amount, names the pot", async () => {
    const item = await firstItem(
      entry({
        kind: "wallet_contribution",
        direction: LedgerDirection.Debit,
        amountKobo: 200000,
        potId: "pot-1",
      }),
      { pots: [{ id: "pot-1", title: "Friday Pizza" }] },
    );

    expect(item.kind).toBe("split_payment");
    expect(item.direction).toBe("debit");
    expect(item.amountKobo).toBe(-200000);
    expect(item.potTitle).toBe("Friday Pizza");
    expect(item.description).toBe("Paid your ₦2,000 share of Friday Pizza");
  });

  it("wallet_settlement -> credit, pot settled to wallet, carries nombaRef from settlement", async () => {
    const item = await firstItem(
      entry({
        kind: "wallet_settlement",
        direction: LedgerDirection.Credit,
        amountKobo: 1200000,
        refType: "settlement",
        refId: "st-1",
      }),
      { settlements: [{ id: "st-1", nombaRef: "nomba-ref-9", potTitle: "Rent June" }] },
    );

    expect(item.kind).toBe("pot_settlement");
    expect(item.direction).toBe("credit");
    expect(item.nombaRef).toBe("nomba-ref-9");
    expect(item.potTitle).toBe("Rent June");
    expect(item.description).toBe("Pot settled to your wallet");
  });

  it("wallet_settlement with a potId in the posting -> names the pot in the description", async () => {
    const item = await firstItem(
      entry({
        kind: "wallet_settlement",
        direction: LedgerDirection.Credit,
        amountKobo: 1200000,
        potId: "pot-3",
        refType: "settlement",
        refId: "st-3",
      }),
      {
        pots: [{ id: "pot-3", title: "Rent June" }],
        settlements: [{ id: "st-3", nombaRef: "nomba-ref-3", potTitle: "Rent June" }],
      },
    );

    expect(item.description).toBe("Rent June settled to your wallet");
    expect(item.nombaRef).toBe("nomba-ref-3");
  });

  it("withdrawal -> debit, negative amount, carries nombaRef", async () => {
    const item = await firstItem(
      entry({
        kind: "withdrawal",
        direction: LedgerDirection.Debit,
        amountKobo: 300000,
        refType: "settlement",
        refId: "st-2",
      }),
      { settlements: [{ id: "st-2", nombaRef: "nomba-wd-7", potTitle: null }] },
    );

    expect(item.kind).toBe("withdrawal");
    expect(item.direction).toBe("debit");
    expect(item.amountKobo).toBe(-300000);
    expect(item.nombaRef).toBe("nomba-wd-7");
    expect(item.description).toBe("Withdrew ₦3,000");
  });

  it("exception_assignment -> exception_credit, credited from review", async () => {
    const item = await firstItem(
      entry({
        kind: "exception_assignment",
        direction: LedgerDirection.Credit,
        amountKobo: 400000,
        refType: "reconciliation_exception",
        refId: "exc-1",
      }),
      { exceptions: [{ id: "exc-1", nombaTransactionId: "ntx-1" }] },
    );

    expect(item.kind).toBe("exception_credit");
    expect(item.direction).toBe("credit");
    expect(item.description).toBe("₦4,000 credited from review");
  });

  it("refund -> credit, references the pot", async () => {
    const item = await firstItem(
      entry({
        kind: "refund",
        direction: LedgerDirection.Credit,
        amountKobo: 150000,
        potId: "pot-2",
      }),
      { pots: [{ id: "pot-2", title: "Beach Trip" }] },
    );

    expect(item.kind).toBe("refund");
    expect(item.description).toBe("Refund of ₦1,500 for Beach Trip");
  });

  it("unknown txn kind with no refType -> generic label, never blank, never crashes", async () => {
    const credit = await firstItem(
      entry({ kind: "mystery", direction: LedgerDirection.Credit, amountKobo: 100 }),
    );
    const debit = await firstItem(
      entry({ kind: "mystery", direction: LedgerDirection.Debit, amountKobo: 100 }),
    );

    expect(credit.kind).toBe("other");
    expect(credit.description).toBe("Wallet credit");
    expect(debit.description).toBe("Wallet debit");
    expect(credit.description.length).toBeGreaterThan(0);
    expect(debit.description.length).toBeGreaterThan(0);
  });
});

describe("WalletStatementService.getStatement pagination + filters", () => {
  it("passes the decoded cursor, limit, direction, from/to through to the ledger", async () => {
    const listCalls: ListCall[] = [];
    const cursor = encodeStatementCursor({
      occurredAt: new Date("2026-07-01T10:00:00.000Z"),
      entryId: "entry-9",
    });
    const ledger = makeLedger({ balances: {}, entries: [] }, listCalls);
    const service = makeService(ledger, makePrisma({}));

    await service.getStatement("user-1", {
      limit: 5,
      cursor,
      direction: "credit",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-31T00:00:00.000Z",
    });

    expect(listCalls).toHaveLength(1);
    const call = listCalls[0];
    expect(call.kind).toBe(LedgerAccountKind.UserWallet);
    expect(call.ownerRef).toBe("user-1");
    expect(call.args.limit).toBe(5);
    expect(call.args.direction).toBe(LedgerDirection.Credit);
    expect(call.args.cursor).toEqual({
      occurredAt: new Date("2026-07-01T10:00:00.000Z"),
      entryId: "entry-9",
    });
    expect(call.args.from).toEqual(new Date("2026-06-01T00:00:00.000Z"));
    expect(call.args.to).toEqual(new Date("2026-07-31T00:00:00.000Z"));
  });

  it("surfaces nextCursor from the ledger page and ships the current balance on the envelope", async () => {
    const entries = [
      entry({ entryId: "e1", occurredAt: new Date("2026-07-01T12:00:00.000Z") }),
      entry({ entryId: "e2", occurredAt: new Date("2026-07-01T11:00:00.000Z") }),
      entry({ entryId: "e3", occurredAt: new Date("2026-07-01T10:00:00.000Z") }),
    ];
    const ledger = makeLedger(
      { balances: { "user_wallet:user-1": 750000 }, entries },
      [],
    );
    const service = makeService(ledger, makePrisma({}));

    const page = await service.getStatement("user-1", { limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.items.map((i) => i.id)).toEqual(["e1", "e2"]);
    expect(page.nextCursor).not.toBeNull();
    expect(page.balanceKobo).toBe(750000);

    const decoded = decodeLedgerEntryCursor(page.nextCursor as string);
    expect(decoded.entryId).toBe("e2");
  });

  it("empty wallet -> empty items, null cursor, balance 0", async () => {
    const ledger = makeLedger({ balances: {}, entries: [] }, []);
    const service = makeService(ledger, makePrisma({}));

    const page = await service.getStatement("user-1", BASE_QUERY);

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.balanceKobo).toBe(0);
  });
});

describe("statement cursor keyset round-trip + tie-break", () => {
  it("encodes and decodes a (createdAt, entryId) cursor losslessly", () => {
    const original = {
      occurredAt: new Date("2026-07-01T10:00:00.000Z"),
      entryId: "entry-abc",
    };
    const decoded = decodeStatementCursor(encodeStatementCursor(original));
    expect(decoded).toEqual(original);
  });

  it("distinguishes two cursors that share a createdAt but differ on entryId (tie-break)", () => {
    const at = new Date("2026-07-01T10:00:00.000Z");
    const a = encodeStatementCursor({ occurredAt: at, entryId: "aaa" });
    const b = encodeStatementCursor({ occurredAt: at, entryId: "bbb" });
    expect(a).not.toBe(b);
    expect(decodeStatementCursor(a)!.entryId).toBe("aaa");
    expect(decodeStatementCursor(b)!.entryId).toBe("bbb");
  });

  it("returns undefined for an absent cursor and throws 400 on a tampered cursor", () => {
    expect(decodeStatementCursor(undefined)).toBeUndefined();
    expect(decodeStatementCursor("")).toBeUndefined();
    expect(() => decodeStatementCursor("!!!not-base64!!!")).toThrow(
      BadRequestException,
    );
  });
});
