import { PoolState } from "@paadi/contracts";

const transitions: Record<PoolState, PoolState[]> = {
  draft: ["open", "cancelled"],
  open: ["funded", "expired", "cancelled"],
  funded: ["settling", "refunding"],
  settling: ["settled", "funded"],
  settled: [],
  expired: ["refunding"],
  cancelled: ["refunding"],
  refunding: ["refunded"],
  refunded: []
};

export function canTransitionPool(from: PoolState, to: PoolState): boolean {
  return transitions[from].includes(to);
}

export function assertPoolTransition(from: PoolState, to: PoolState): void {
  if (!canTransitionPool(from, to)) {
    throw new Error(`invalid pool transition ${from} -> ${to}`);
  }
}
