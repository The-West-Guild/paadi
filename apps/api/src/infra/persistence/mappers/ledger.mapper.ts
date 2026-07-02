import { LedgerEntry, LedgerDirection, LedgerEntryView } from "@paadi/domain";

export interface LedgerEntryRow {
  accountId: string;
  direction: LedgerDirection;
  amountKobo: bigint;
}

export interface LedgerEntryQueryRow {
  entryId: string;
  transactionId: string;
  direction: LedgerDirection;
  amountKobo: bigint;
  kind: string;
  refType: string | null;
  refId: string | null;
  memo: string | null;
  potId: string | null;
  occurredAt: Date;
}

export interface LedgerEntryCursorParts {
  occurredAt: Date;
  entryId: string;
}

export const ledgerMapper = {
  toDomain(row: LedgerEntryRow): LedgerEntry {
    return {
      accountId: row.accountId,
      direction: row.direction,
      amountKobo: Number(row.amountKobo)
    };
  }
};

export function toLedgerEntryView(row: LedgerEntryQueryRow, ownerRef: string): LedgerEntryView {
  return {
    entryId: row.entryId,
    transactionId: row.transactionId,
    kind: row.kind,
    ownerRef,
    direction: row.direction,
    amountKobo: Number(row.amountKobo),
    refType: row.refType,
    refId: row.refId,
    memo: row.memo,
    potId: row.potId,
    occurredAt: row.occurredAt
  };
}

export function encodeLedgerEntryCursor(parts: LedgerEntryCursorParts): string {
  const payload = `${parts.occurredAt.toISOString()}|${parts.entryId}`;
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeLedgerEntryCursor(cursor: string): LedgerEntryCursorParts {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const separatorIndex = decoded.indexOf("|");
  if (separatorIndex === -1) {
    throw new Error("invalid cursor");
  }
  const occurredAtRaw = decoded.slice(0, separatorIndex);
  const entryId = decoded.slice(separatorIndex + 1);
  const occurredAtMs = Date.parse(occurredAtRaw);
  if (Number.isNaN(occurredAtMs) || entryId.length === 0) {
    throw new Error("invalid cursor");
  }
  return { occurredAt: new Date(occurredAtMs), entryId };
}
