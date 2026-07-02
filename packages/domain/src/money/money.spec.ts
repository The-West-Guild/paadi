import { Money } from "./money";

describe("Money.fromNaira", () => {
  it("converts whole naira to kobo", () => {
    expect(Money.fromNaira(10000).kobo).toBe(1_000_000);
  });

  it("rounds IEEE-754 dust to the nearest kobo", () => {
    expect(Money.fromNaira(19.99).kobo).toBe(1999);
  });

  it("rounds half up", () => {
    expect(Money.fromNaira(0.005).kobo).toBe(1);
  });
});

describe("Money.fromKobo", () => {
  it("truncates fractional kobo toward zero", () => {
    expect(Money.fromKobo(2.9).kobo).toBe(2);
  });

  it("truncates negative fractional kobo toward zero", () => {
    expect(Money.fromKobo(-2.9).kobo).toBe(-2);
  });
});

describe("Money.zero", () => {
  it("is the kobo-zero identity", () => {
    expect(Money.zero().kobo).toBe(0);
    expect(Money.zero().isZero()).toBe(true);
  });
});

describe("Money arithmetic", () => {
  it("adds exactly", () => {
    expect(Money.fromKobo(2500).add(Money.fromKobo(2000)).kobo).toBe(4500);
  });

  it("subtracts exactly", () => {
    expect(Money.fromKobo(2500).subtract(Money.fromKobo(2000)).kobo).toBe(500);
  });

  it("is exact near MAX_SAFE_INTEGER", () => {
    const a = Money.fromKobo(Number.MAX_SAFE_INTEGER - 2);
    expect(a.add(Money.fromKobo(2)).kobo).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("Money.multiply", () => {
  it("rounds a fee to integer kobo", () => {
    expect(Money.fromKobo(1_000_000).multiply(0.075).kobo).toBe(75_000);
  });

  it("never produces fractional kobo", () => {
    expect(Number.isInteger(Money.fromKobo(3333).multiply(0.333).kobo)).toBe(
      true,
    );
  });
});

describe("Money comparisons", () => {
  it("gte is true at equality (boundary met)", () => {
    expect(Money.fromKobo(5000).gte(Money.fromKobo(5000))).toBe(true);
  });

  it("eq matches equal amounts only", () => {
    expect(Money.fromKobo(5000).eq(Money.fromKobo(5000))).toBe(true);
    expect(Money.fromKobo(5000).eq(Money.fromKobo(4999))).toBe(false);
  });

  it("gt and lt are strict", () => {
    expect(Money.fromKobo(5001).gt(Money.fromKobo(5000))).toBe(true);
    expect(Money.fromKobo(5000).gt(Money.fromKobo(5000))).toBe(false);
    expect(Money.fromKobo(4999).lt(Money.fromKobo(5000))).toBe(true);
    expect(Money.fromKobo(5000).lt(Money.fromKobo(5000))).toBe(false);
  });

  it("lte is true at equality", () => {
    expect(Money.fromKobo(5000).lte(Money.fromKobo(5000))).toBe(true);
  });
});

describe("Money.isNegative", () => {
  it("detects an overdraw before it touches the ledger", () => {
    expect(
      Money.fromKobo(2000).subtract(Money.fromKobo(2500)).isNegative(),
    ).toBe(true);
  });

  it("is false for zero and positive amounts", () => {
    expect(Money.zero().isNegative()).toBe(false);
    expect(Money.fromKobo(1).isNegative()).toBe(false);
  });
});

describe("Money.assertNonNegative", () => {
  it("throws on a negative amount", () => {
    expect(() => Money.fromKobo(-1).assertNonNegative()).toThrow();
  });

  it("returns self when non-negative", () => {
    const m = Money.fromKobo(500);
    expect(m.assertNonNegative()).toBe(m);
    expect(
      Money.fromKobo(2500).subtract(Money.fromKobo(2000)).assertNonNegative()
        .kobo,
    ).toBe(500);
  });
});

describe("Money.toNaira / toString", () => {
  it("toNaira is an exact division by 100", () => {
    expect(Money.fromKobo(1999).toNaira()).toBe(19.99);
  });

  it("toString renders two decimals", () => {
    expect(Money.fromNaira(10000).toString()).toBe("10000.00");
    expect(Money.fromKobo(1999).toString()).toBe("19.99");
  });
});
