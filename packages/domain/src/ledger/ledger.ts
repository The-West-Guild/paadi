import { LedgerDirection } from "./account";

export interface LedgerEntry {
  accountId: string;
  direction: LedgerDirection;
  amountKobo: number;
}

export interface LedgerTransaction {
  kind: string;
  potId: string;
  entries: LedgerEntry[];
}

export interface LedgerAccountRef {
  kind: string;
  ownerRef: string;
}

export interface PostingEntry {
  account: LedgerAccountRef;
  direction: LedgerDirection;
  amountKobo: number;
}

export interface LedgerPosting {
  kind: string;
  potId?: string | null;
  entries: PostingEntry[];
}

export function assertBalanced(
  entries: Array<{ direction: LedgerDirection; amountKobo: number }>
): void {
  if (entries.length === 0) {
    throw new Error("ledger transaction has no entries");
  }
  for (const entry of entries) {
    if (!Number.isInteger(entry.amountKobo)) {
      throw new Error("ledger entry amount must be an integer");
    }
    if (entry.amountKobo <= 0) {
      throw new Error("ledger entry amount must be positive");
    }
  }
  const net = entries.reduce(
    (acc, entry) => acc + (entry.direction === LedgerDirection.Debit ? entry.amountKobo : -entry.amountKobo),
    0
  );
  if (net !== 0) {
    throw new Error("ledger transaction is not balanced");
  }
}
