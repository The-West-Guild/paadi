import { ReconciliationException } from "@paadi/db";
import type { ExceptionDto, ExceptionReason, ExceptionStatus } from "@paadi/contracts";

export function toExceptionDto(row: ReconciliationException): ExceptionDto {
  return {
    id: row.id,
    nombaTransactionId: row.nombaTransactionId,
    amountKobo: Number(row.amountKobo),
    reason: row.reason as ExceptionReason,
    status: row.status as ExceptionStatus,
    senderName: row.senderName,
    senderAccount: row.senderAccount,
    senderBank: row.senderBank,
    vaAccountNumber: row.vaAccountNumber,
    matchedUserId: row.matchedUserId,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    note: row.note,
    refundStatus: row.refundStatus,
    createdAt: row.createdAt.toISOString()
  };
}
