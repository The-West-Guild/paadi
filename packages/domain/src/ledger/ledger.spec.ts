import { LedgerDirection } from "./account";
import { LedgerPosting, PostingEntry, assertBalanced } from "./ledger";
import { buildCollectionPosting, buildContributionPosting, buildSuspensePosting } from "./posting";

function accountKey(kind: string, ownerRef: string): string {
  return `${kind}[${ownerRef}]`;
}

function findLeg(posting: LedgerPosting, kind: string, ownerRef: string): PostingEntry | undefined {
  return posting.entries.find((e) => e.account.kind === kind && e.account.ownerRef === ownerRef);
}

interface AccountTotals {
  debit: number;
  credit: number;
}

function applyPostings(postings: LedgerPosting[]): Map<string, AccountTotals> {
  const totals = new Map<string, AccountTotals>();
  for (const posting of postings) {
    for (const entry of posting.entries) {
      const key = accountKey(entry.account.kind, entry.account.ownerRef);
      const current = totals.get(key) ?? { debit: 0, credit: 0 };
      if (entry.direction === LedgerDirection.Debit) {
        current.debit += entry.amountKobo;
      } else {
        current.credit += entry.amountKobo;
      }
      totals.set(key, current);
    }
  }
  return totals;
}

describe("buildCollectionPosting", () => {
  it("emits DR pooled_cash[house] and CR pot_liability[potId] for the full amount", () => {
    const posting = buildCollectionPosting({ potId: "P", amountKobo: 5000 });

    expect(posting.kind).toBe("collection");
    expect(posting.potId).toBe("P");
    expect(posting.entries).toHaveLength(2);

    const dr = findLeg(posting, "pooled_cash", "house");
    const cr = findLeg(posting, "pot_liability", "P");
    expect(dr).toEqual({ account: { kind: "pooled_cash", ownerRef: "house" }, direction: LedgerDirection.Debit, amountKobo: 5000 });
    expect(cr).toEqual({ account: { kind: "pot_liability", ownerRef: "P" }, direction: LedgerDirection.Credit, amountKobo: 5000 });
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildSuspensePosting", () => {
  it("credits exceptions_suspense[potId] when a pot owns the excess", () => {
    const posting = buildSuspensePosting({ potId: "P", amountKobo: 500 });

    expect(posting.kind).toBe("suspense");
    expect(posting.potId).toBe("P");
    const dr = findLeg(posting, "pooled_cash", "house");
    const cr = findLeg(posting, "exceptions_suspense", "P");
    expect(dr?.amountKobo).toBe(500);
    expect(cr?.amountKobo).toBe(500);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("credits exceptions_suspense[house] for a truly-unmatched inflow", () => {
    const posting = buildSuspensePosting({ potId: null, amountKobo: 750 });

    expect(posting.potId).toBeNull();
    const cr = findLeg(posting, "exceptions_suspense", "house");
    expect(cr?.amountKobo).toBe(750);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildContributionPosting", () => {
  it("splits an overshoot into one DR and two CR legs", () => {
    const { posting, attributedKobo, excessKobo } = buildContributionPosting({
      potId: "P",
      shareKobo: 2000,
      priorPaidKobo: 0,
      amountKobo: 2500
    });

    expect(attributedKobo).toBe(2000);
    expect(excessKobo).toBe(500);
    expect(posting.entries).toHaveLength(3);
    expect(findLeg(posting, "pooled_cash", "house")?.amountKobo).toBe(2500);
    expect(findLeg(posting, "pot_liability", "P")?.amountKobo).toBe(2000);
    expect(findLeg(posting, "exceptions_suspense", "P")?.amountKobo).toBe(500);
    expect(attributedKobo + excessKobo).toBe(2500);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("emits a single CR pot_liability leg when the payment lands exactly", () => {
    const { posting, attributedKobo, excessKobo } = buildContributionPosting({
      potId: "P",
      shareKobo: 5000,
      priorPaidKobo: 0,
      amountKobo: 5000
    });

    expect(attributedKobo).toBe(5000);
    expect(excessKobo).toBe(0);
    expect(posting.entries).toHaveLength(2);
    expect(findLeg(posting, "pot_liability", "P")?.amountKobo).toBe(5000);
    expect(findLeg(posting, "exceptions_suspense", "P")).toBeUndefined();
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("attributes nothing and parks pure excess when the share is already met", () => {
    const { posting, attributedKobo, excessKobo } = buildContributionPosting({
      potId: "P",
      shareKobo: 2000,
      priorPaidKobo: 2000,
      amountKobo: 800
    });

    expect(attributedKobo).toBe(0);
    expect(excessKobo).toBe(800);
    expect(posting.entries).toHaveLength(2);
    expect(findLeg(posting, "pot_liability", "P")).toBeUndefined();
    expect(findLeg(posting, "exceptions_suspense", "P")?.amountKobo).toBe(800);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("assertBalanced", () => {
  it("accepts a net-zero set of positive integer legs", () => {
    expect(() =>
      assertBalanced([
        { direction: LedgerDirection.Debit, amountKobo: 100 },
        { direction: LedgerDirection.Credit, amountKobo: 100 }
      ])
    ).not.toThrow();
  });

  it("rejects an unbalanced transaction", () => {
    expect(() =>
      assertBalanced([
        { direction: LedgerDirection.Debit, amountKobo: 100 },
        { direction: LedgerDirection.Credit, amountKobo: 99 }
      ])
    ).toThrow();
  });

  it("rejects an empty transaction", () => {
    expect(() => assertBalanced([])).toThrow();
  });

  it("rejects a non-positive amount", () => {
    expect(() =>
      assertBalanced([
        { direction: LedgerDirection.Debit, amountKobo: 0 },
        { direction: LedgerDirection.Credit, amountKobo: 0 }
      ])
    ).toThrow();
  });

  it("rejects a negative amount", () => {
    expect(() =>
      assertBalanced([
        { direction: LedgerDirection.Debit, amountKobo: -100 },
        { direction: LedgerDirection.Credit, amountKobo: -100 }
      ])
    ).toThrow();
  });

  it("rejects a non-integer amount", () => {
    expect(() =>
      assertBalanced([
        { direction: LedgerDirection.Debit, amountKobo: 100.5 },
        { direction: LedgerDirection.Credit, amountKobo: 100.5 }
      ])
    ).toThrow();
  });
});

describe("worked ledger (spec 4.3.4) — one pot, 3 payments + 1 overpayment", () => {
  it("keeps pooled_cash == pot_liability + exceptions_suspense and funds the pot", () => {
    const c1 = buildContributionPosting({ potId: "P", shareKobo: 5000, priorPaidKobo: 0, amountKobo: 5000 });
    const c2 = buildContributionPosting({ potId: "P", shareKobo: 3000, priorPaidKobo: 0, amountKobo: 1500 });
    const c3 = buildContributionPosting({ potId: "P", shareKobo: 2000, priorPaidKobo: 0, amountKobo: 2500 });
    const c4 = buildContributionPosting({ potId: "P", shareKobo: 3000, priorPaidKobo: 1500, amountKobo: 1500 });

    expect(c3.attributedKobo).toBe(2000);
    expect(c3.excessKobo).toBe(500);

    const totals = applyPostings([c1.posting, c2.posting, c3.posting, c4.posting]);

    const pooledCash = totals.get("pooled_cash[house]")!;
    const potLiability = totals.get("pot_liability[P]")!;
    const suspense = totals.get("exceptions_suspense[P]")!;

    const pooledCashBalance = pooledCash.debit - pooledCash.credit;
    const potLiabilityBalance = potLiability.credit - potLiability.debit;
    const suspenseBalance = suspense.credit - suspense.debit;

    expect(pooledCashBalance).toBe(10500);
    expect(potLiabilityBalance).toBe(10000);
    expect(suspenseBalance).toBe(500);

    expect(pooledCashBalance).toBe(potLiabilityBalance + suspenseBalance);

    const collectedKobo = c1.attributedKobo + c2.attributedKobo + c3.attributedKobo + c4.attributedKobo;
    expect(collectedKobo).toBe(potLiabilityBalance);
    expect(collectedKobo).toBe(10000);
  });
});
