import { BadRequestException } from "@nestjs/common";
import type { LedgerEntryCursor } from "@paadi/domain";
import {
  decodeLedgerEntryCursor,
  encodeLedgerEntryCursor,
} from "../../infra/persistence/mappers/ledger.mapper";

export function encodeStatementCursor(cursor: LedgerEntryCursor): string {
  return encodeLedgerEntryCursor({
    occurredAt: cursor.occurredAt,
    entryId: cursor.entryId,
  });
}

export function decodeStatementCursor(
  cursor: string | undefined,
): LedgerEntryCursor | undefined {
  if (cursor === undefined || cursor.length === 0) {
    return undefined;
  }
  try {
    const parts = decodeLedgerEntryCursor(cursor);
    return { occurredAt: parts.occurredAt, entryId: parts.entryId };
  } catch {
    throw new BadRequestException("invalid cursor");
  }
}
