import { LedgerDirection } from "../ledger/account";
import { LedgerPosting } from "../ledger/ledger";

export interface LedgerEntryView {
  entryId: string;
  transactionId: string;
  kind: string;
  ownerRef: string;
  direction: LedgerDirection;
  amountKobo: number;
  refType?: string | null;
  refId?: string | null;
  memo?: string | null;
  potId?: string | null;
  occurredAt: Date;
}

export interface LedgerEntryCursor {
  occurredAt: Date;
  entryId: string;
}

export interface ListAccountEntriesArgs {
  cursor?: LedgerEntryCursor;
  limit: number;
  direction?: LedgerDirection;
  from?: Date;
  to?: Date;
}

export interface ListAccountEntriesResult {
  items: LedgerEntryView[];
  nextCursor: string | null;
}

export interface KindBalance {
  ownerRef: string;
  balanceKobo: number;
}

export abstract class LedgerRepository {
  abstract record(posting: LedgerPosting): Promise<void>;
  abstract balance(accountId: string): Promise<number>;
  abstract accountBalanceKobo(kind: string, ownerRef: string): Promise<number>;
  abstract listAccountEntries(
    kind: string,
    ownerRef: string,
    args: ListAccountEntriesArgs
  ): Promise<ListAccountEntriesResult>;
  abstract balancesByKind(kind: string): Promise<KindBalance[]>;
}
