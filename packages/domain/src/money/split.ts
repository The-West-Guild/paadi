export type SplitBasis =
  | { kind: "weight"; weights: number[] }
  | { kind: "percent"; percents: number[] }
  | { kind: "amount"; amountsKobo: number[] };

export function splitByWeight(totalKobo: number, weights: number[]): number[] {
  if (!Number.isInteger(totalKobo) || totalKobo < 0) {
    throw new Error("totalKobo must be a non-negative integer");
  }
  if (weights.length === 0) {
    throw new Error("weights must not be empty");
  }
  if (weights.some((w) => !(w > 0))) {
    throw new Error("each weight must be positive");
  }

  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  const base = weights.map((w) => Math.floor((totalKobo * w) / totalWeight));
  const remainder = totalKobo - base.reduce((acc, b) => acc + b, 0);

  const byLargestFraction = weights
    .map((w, index) => ({
      index,
      fraction: (totalKobo * w) / totalWeight - base[index],
    }))
    .sort((a, b) => b.fraction - a.fraction);

  const result = [...base];
  for (let i = 0; i < remainder; i++) {
    result[byLargestFraction[i % byLargestFraction.length].index] += 1;
  }
  return result;
}

export function splitEvenly(totalKobo: number, count: number): number[] {
  return splitByWeight(
    totalKobo,
    Array.from({ length: count }, () => 1),
  );
}

export function normalizeToWeights(basis: SplitBasis, totalKobo: number): number[] {
  switch (basis.kind) {
    case "weight":
      return assertPositiveWeights(basis.weights);
    case "percent":
      return assertPositiveWeights(basis.percents);
    case "amount":
      return assertExactAmounts(basis.amountsKobo, totalKobo);
  }
}

function assertPositiveWeights(weights: number[]): number[] {
  if (weights.length === 0) {
    throw new Error("weights must not be empty");
  }
  if (weights.some((w) => !(w > 0))) {
    throw new Error("each weight must be positive");
  }
  return [...weights];
}

function assertExactAmounts(amountsKobo: number[], totalKobo: number): number[] {
  if (amountsKobo.length === 0) {
    throw new Error("weights must not be empty");
  }
  if (amountsKobo.some((a) => !(a > 0) || !Number.isInteger(a))) {
    throw new Error("each amount must be a positive integer");
  }
  if (amountsKobo.reduce((acc, a) => acc + a, 0) !== totalKobo) {
    throw new Error("explicit amounts must sum to the pot total");
  }
  return [...amountsKobo];
}
