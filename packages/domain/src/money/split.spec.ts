import { normalizeToWeights, splitByWeight, splitEvenly } from "./split";

describe("splitByWeight largest-remainder", () => {
  it("splits 10000 across three equal parts as [3334, 3333, 3333]", () => {
    expect(splitByWeight(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
  });

  it("splits proportional weights exactly when they divide cleanly", () => {
    expect(splitByWeight(10000, [50, 30, 20])).toEqual([5000, 3000, 2000]);
  });

  it("distributes the remainder across six equal parts and stays sum-exact", () => {
    const result = splitByWeight(10000, [1, 1, 1, 1, 1, 1]);
    expect(result).toEqual([1667, 1667, 1667, 1667, 1666, 1666]);
    expect(result.reduce((acc, p) => acc + p, 0)).toBe(10000);
  });

  it("returns the whole total for a single weight", () => {
    expect(splitByWeight(7777, [3])).toEqual([7777]);
  });

  it("is sum-exact across randomized totals and weights", () => {
    for (let trial = 0; trial < 200; trial++) {
      const total = Math.floor(Math.random() * 1_000_000_000) + 1;
      const count = Math.floor(Math.random() * 8) + 1;
      const weights = Array.from(
        { length: count },
        () => Math.floor(Math.random() * 100) + 1,
      );
      const parts = splitByWeight(total, weights);
      expect(parts).toHaveLength(count);
      expect(parts.every((p) => p >= 0 && Number.isInteger(p))).toBe(true);
      expect(parts.reduce((acc, p) => acc + p, 0)).toBe(total);
    }
  });
});

describe("splitEvenly", () => {
  it("delegates to splitByWeight with unit weights", () => {
    expect(splitEvenly(10000, 3)).toEqual([3334, 3333, 3333]);
  });
});

describe("splitByWeight guards", () => {
  it("throws on a fractional total", () => {
    expect(() => splitByWeight(100.5, [1, 1])).toThrow(
      "totalKobo must be a non-negative integer",
    );
  });

  it("throws on a negative total", () => {
    expect(() => splitByWeight(-1, [1, 1])).toThrow(
      "totalKobo must be a non-negative integer",
    );
  });

  it("throws on empty weights", () => {
    expect(() => splitByWeight(10000, [])).toThrow("weights must not be empty");
  });

  it("throws on a zero weight", () => {
    expect(() => splitByWeight(10000, [1, 0])).toThrow(
      "each weight must be positive",
    );
  });

  it("throws on a negative weight", () => {
    expect(() => splitByWeight(10000, [1, -1])).toThrow(
      "each weight must be positive",
    );
  });

  it("throws on a NaN weight", () => {
    expect(() => splitByWeight(10000, [1, NaN])).toThrow(
      "each weight must be positive",
    );
  });
});

describe("normalizeToWeights", () => {
  it("passes weight-basis through unchanged", () => {
    expect(normalizeToWeights({ kind: "weight", weights: [1, 2, 3] }, 10000)).toEqual([
      1, 2, 3,
    ]);
  });

  it("maps percent-basis to weights that split sum-exactly", () => {
    const weights = normalizeToWeights(
      { kind: "percent", percents: [50, 30, 20] },
      10000,
    );
    expect(weights).toEqual([50, 30, 20]);
    expect(splitByWeight(10000, weights)).toEqual([5000, 3000, 2000]);
  });

  it("keeps percent-basis sum-exact even when percents do not total 100", () => {
    const weights = normalizeToWeights(
      { kind: "percent", percents: [33.3, 33.3, 33.3] },
      10000,
    );
    expect(splitByWeight(10000, weights).reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it("maps amount-basis to weights when the amounts sum to the total", () => {
    const weights = normalizeToWeights(
      { kind: "amount", amountsKobo: [5000, 3000, 2000] },
      10000,
    );
    expect(weights).toEqual([5000, 3000, 2000]);
    expect(splitByWeight(10000, weights)).toEqual([5000, 3000, 2000]);
  });

  it("throws when explicit amounts do not sum to the total", () => {
    expect(() =>
      normalizeToWeights({ kind: "amount", amountsKobo: [5000, 3000, 1000] }, 10000),
    ).toThrow("explicit amounts must sum to the pot total");
  });

  it("throws on empty weight-basis", () => {
    expect(() => normalizeToWeights({ kind: "weight", weights: [] }, 10000)).toThrow(
      "weights must not be empty",
    );
  });

  it("throws on a non-positive percent", () => {
    expect(() =>
      normalizeToWeights({ kind: "percent", percents: [50, 0] }, 10000),
    ).toThrow("each weight must be positive");
  });

  it("throws on a non-integer amount", () => {
    expect(() =>
      normalizeToWeights({ kind: "amount", amountsKobo: [5000, 2999.5] }, 10000),
    ).toThrow("each amount must be a positive integer");
  });

  it("throws on a negative amount", () => {
    expect(() =>
      normalizeToWeights({ kind: "amount", amountsKobo: [5000, -1] }, 10000),
    ).toThrow("each amount must be a positive integer");
  });
});
