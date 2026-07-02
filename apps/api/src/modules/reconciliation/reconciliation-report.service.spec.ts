import {
  AccountBalance,
  KindBalance,
  LedgerAccountKind,
  LedgerRepository,
  PaymentProviderPort,
} from "@paadi/domain";
import { ReconciliationReportService } from "./reconciliation-report.service";

interface LedgerFixture {
  pooledCash?: number;
  potLiability?: KindBalance[];
  userWallet?: KindBalance[];
  exceptionsSuspense?: KindBalance[];
  settlementPayout?: KindBalance[];
  platformFee?: KindBalance[];
  refundsPayable?: KindBalance[];
}

function one(ownerRef: string, balanceKobo: number): KindBalance {
  return { ownerRef, balanceKobo };
}

function makeLedger(fixture: LedgerFixture) {
  const byKind: Record<string, KindBalance[]> = {
    [LedgerAccountKind.PotLiability]: fixture.potLiability ?? [],
    [LedgerAccountKind.UserWallet]: fixture.userWallet ?? [],
    [LedgerAccountKind.ExceptionsSuspense]: fixture.exceptionsSuspense ?? [],
    [LedgerAccountKind.SettlementPayout]: fixture.settlementPayout ?? [],
    [LedgerAccountKind.PlatformFee]: fixture.platformFee ?? [],
    [LedgerAccountKind.RefundsPayable]: fixture.refundsPayable ?? [],
  };
  return {
    accountBalanceKobo: jest.fn(async (kind: string, ownerRef: string) => {
      if (kind === LedgerAccountKind.PooledCash && ownerRef === "house") {
        return fixture.pooledCash ?? 0;
      }
      return 0;
    }),
    balancesByKind: jest.fn(async (kind: string) => byKind[kind] ?? []),
  };
}

function makeProvider(opts: {
  balance?: AccountBalance | null;
  throws?: boolean;
}) {
  return {
    fetchAccountBalance: jest.fn(async (): Promise<AccountBalance | null> => {
      if (opts.throws) {
        throw new Error("nomba 503");
      }
      return opts.balance ?? null;
    }),
  };
}

function makePrisma(counts: {
  pots?: number;
  wallets?: number;
  openExceptions?: number;
}) {
  return {
    ledgerAccount: {
      count: jest.fn(async ({ where }: { where: { kind: string } }) => {
        if (where.kind === LedgerAccountKind.PotLiability) {
          return counts.pots ?? 0;
        }
        if (where.kind === LedgerAccountKind.UserWallet) {
          return counts.wallets ?? 0;
        }
        return 0;
      }),
    },
    reconciliationException: {
      count: jest.fn(async () => counts.openExceptions ?? 0),
    },
  };
}

function makeService(
  ledger: unknown,
  provider: unknown,
  prisma: unknown,
): ReconciliationReportService {
  return new ReconciliationReportService(
    prisma as never,
    ledger as unknown as LedgerRepository,
    provider as unknown as PaymentProviderPort,
  );
}

describe("ReconciliationReportService internal invariant", () => {
  it("balances (internalDrift 0) when pooled_cash equals the sum of liabilities", async () => {
    const ledger = makeLedger({
      pooledCash: 5000,
      potLiability: [one("pot-1", 3000)],
      userWallet: [one("user-1", 2000)],
    });
    const service = makeService(
      ledger,
      makeProvider({ balance: { availableKobo: 5000 } }),
      makePrisma({ pots: 1, wallets: 1, openExceptions: 0 }),
    );

    const report = await service.build();

    expect(report.pooledCashKobo).toBe(5000);
    expect(report.sumLiabilitiesKobo).toBe(5000);
    expect(report.internalDriftKobo).toBe(0);
    expect(report.balanced).toBe(true);
    expect(report.currency).toBe("NGN");
  });

  it("sums liabilities across many owners per kind and reports per-kind subtotals in the breakdown", async () => {
    const ledger = makeLedger({
      pooledCash: 9000,
      potLiability: [one("pot-1", 3000), one("pot-2", 1000)],
      userWallet: [one("user-1", 2000), one("user-2", 500)],
      exceptionsSuspense: [one("house", 2500)],
    });
    const service = makeService(
      ledger,
      makeProvider({ balance: null }),
      makePrisma({ pots: 2, wallets: 2, openExceptions: 1 }),
    );

    const report = await service.build();

    expect(report.breakdown.potLiabilityKobo).toBe(4000);
    expect(report.breakdown.userWalletKobo).toBe(2500);
    expect(report.breakdown.exceptionsSuspenseKobo).toBe(2500);
    expect(report.sumLiabilitiesKobo).toBe(9000);
    expect(report.internalDriftKobo).toBe(0);
    expect(report.balanced).toBe(true);
    expect(report.counts).toEqual({ pots: 2, wallets: 2, openExceptions: 1 });
  });

  it("nets DR-normal payout/fee buckets against the liabilities so a mid-settlement transit balances", async () => {
    const ledger = makeLedger({
      pooledCash: 3000,
      userWallet: [one("user-1", 5000)],
      settlementPayout: [one("house", 2000)],
    });
    const service = makeService(
      ledger,
      makeProvider({ balance: null }),
      makePrisma({}),
    );

    const report = await service.build();

    expect(report.breakdown.userWalletKobo).toBe(5000);
    expect(report.breakdown.settlementPayoutKobo).toBe(2000);
    expect(report.sumLiabilitiesKobo).toBe(3000);
    expect(report.internalDriftKobo).toBe(0);
    expect(report.balanced).toBe(true);
  });

  it("flips balanced=false and surfaces the drift when a seeded fixture is unbalanced", async () => {
    const ledger = makeLedger({
      pooledCash: 5000,
      potLiability: [one("pot-1", 3000)],
      userWallet: [one("user-1", 1500)],
    });
    const service = makeService(
      ledger,
      makeProvider({ balance: null }),
      makePrisma({ pots: 1, wallets: 1 }),
    );

    const report = await service.build();

    expect(report.sumLiabilitiesKobo).toBe(4500);
    expect(report.internalDriftKobo).toBe(500);
    expect(report.balanced).toBe(false);
    expect(report.breakdown.potLiabilityKobo).toBe(3000);
    expect(report.breakdown.userWalletKobo).toBe(1500);
  });
});

describe("ReconciliationReportService external cross-check", () => {
  it("reports nombaKobo and externalDrift when the provider exposes a balance", async () => {
    const ledger = makeLedger({ pooledCash: 5000, userWallet: [one("u", 5000)] });
    const service = makeService(
      ledger,
      makeProvider({ balance: { availableKobo: 4800 } }),
      makePrisma({}),
    );

    const report = await service.build();

    expect(report.external).toEqual({ nombaKobo: 4800, externalDriftKobo: 200 });
    expect(report.balanced).toBe(true);
  });

  it("marks external 'unavailable' when the provider returns null, internal still computed", async () => {
    const ledger = makeLedger({ pooledCash: 5000, userWallet: [one("u", 5000)] });
    const service = makeService(
      ledger,
      makeProvider({ balance: null }),
      makePrisma({}),
    );

    const report = await service.build();

    expect(report.external).toBe("unavailable");
    expect(report.internalDriftKobo).toBe(0);
    expect(report.balanced).toBe(true);
  });

  it("degrades to 'unavailable' (never throws) when the balance read errors", async () => {
    const ledger = makeLedger({ pooledCash: 1000, userWallet: [one("u", 1000)] });
    const service = makeService(
      ledger,
      makeProvider({ throws: true }),
      makePrisma({}),
    );

    const report = await service.build();

    expect(report.external).toBe("unavailable");
    expect(report.balanced).toBe(true);
  });

  it("a non-zero externalDrift stays informational and does not flip balanced", async () => {
    const ledger = makeLedger({ pooledCash: 5000, userWallet: [one("u", 5000)] });
    const service = makeService(
      ledger,
      makeProvider({ balance: { availableKobo: 6000 } }),
      makePrisma({}),
    );

    const report = await service.build();

    expect(report.external).toEqual({ nombaKobo: 6000, externalDriftKobo: -1000 });
    expect(report.internalDriftKobo).toBe(0);
    expect(report.balanced).toBe(true);
  });
});
