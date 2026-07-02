import { VirtualAccount } from "@paadi/db";
import type { VirtualAccountResponse } from "@paadi/contracts";

export function toVirtualAccountResponse(row: VirtualAccount): VirtualAccountResponse {
  return {
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    providerBank: row.providerBank,
    status: row.status,
    kind: row.kind,
    createdAt: row.createdAt.toISOString()
  };
}
