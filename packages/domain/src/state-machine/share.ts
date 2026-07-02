import { ShareState } from "@paadi/contracts";

const transitions: Record<ShareState, ShareState[]> = {
  pending: ["paid", "partially_paid", "overpaid", "expired"],
  partially_paid: ["paid", "overpaid", "expired"],
  paid: ["overpaid", "refunded"],
  overpaid: ["refunded"],
  expired: [],
  refunded: []
};

export function canTransitionShare(from: ShareState, to: ShareState): boolean {
  return transitions[from].includes(to);
}

export function assertShareTransition(from: ShareState, to: ShareState): void {
  if (!canTransitionShare(from, to)) {
    throw new Error(`invalid share transition ${from} -> ${to}`);
  }
}
