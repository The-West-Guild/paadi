import { BadRequestException } from "@nestjs/common";
import type { ActivityItem } from "@paadi/contracts";
import { LedgerDirection, LedgerEntryView } from "@paadi/domain";
import { SettlementType as DbSettlementType } from "@paadi/db";

export type ActivityType = ActivityItem["type"];

export type LedgerEntryWithPot = LedgerEntryView & { potId: string | null };

export interface ActivityRow {
  id: string;
  type: ActivityType;
  occurredAt: Date;
  sourceTag: string;
  sourceId: string;
  potId: string | null;
  potTitle: string | null;
  actorName: string | null;
  amountKobo: number | null;
  meta: Record<string, unknown> | null;
}

export interface ActivityCursor {
  occurredAt: Date;
  sourceTag: string;
  sourceId: string;
}

export interface PaymentSource {
  id: string;
  potId: string;
  amountKobo: bigint;
  senderName: string | null;
  status: string;
  splitId: string | null;
  createdAt: Date;
}

export interface PotSource {
  id: string;
  title: string;
  status: string;
  collectedKobo: bigint;
  targetKobo: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettlementSource {
  id: string;
  potId: string;
  type: DbSettlementType;
  amountKobo: bigint;
  vendToken: string | null;
  nombaRef: string | null;
  settledAt: Date | null;
  createdAt: Date;
}

const SETTLEMENT_TYPE_TO_ACTIVITY: Record<DbSettlementType, ActivityType> = {
  BILL_PAYMENT: "pot_settled_bill",
  BANK_PAYOUT: "pot_settled_bank",
  WALLET: "pot_settled_wallet",
};

const WALLET_CREDIT_KINDS: ReadonlySet<string> = new Set([
  "wallet_credit",
  "exception_assignment",
  "refund",
]);

export function paymentToRow(
  payment: PaymentSource,
  potTitle: string,
): ActivityRow {
  const actorName = payment.senderName ?? "Someone";
  const amountKobo = Number(payment.amountKobo);
  return {
    id: `payment:${payment.id}`,
    type: "contribution_received",
    occurredAt: payment.createdAt,
    sourceTag: "payment",
    sourceId: payment.id,
    potId: payment.potId,
    potTitle,
    actorName,
    amountKobo,
    meta: { splitId: payment.splitId, status: payment.status },
  };
}

export function potCreatedRow(pot: PotSource): ActivityRow {
  return {
    id: `pot_created:${pot.id}`,
    type: "pot_created",
    occurredAt: pot.createdAt,
    sourceTag: "pot_created",
    sourceId: pot.id,
    potId: pot.id,
    potTitle: pot.title,
    actorName: null,
    amountKobo: null,
    meta: null,
  };
}

export function potFundedRow(pot: PotSource): ActivityRow {
  return {
    id: `pot_funded:${pot.id}`,
    type: "pot_funded",
    occurredAt: pot.updatedAt,
    sourceTag: "pot_funded",
    sourceId: pot.id,
    potId: pot.id,
    potTitle: pot.title,
    actorName: null,
    amountKobo: Number(pot.collectedKobo),
    meta: null,
  };
}

export function potExpiredRow(pot: PotSource): ActivityRow {
  const target = Number(pot.targetKobo);
  const collected = Number(pot.collectedKobo);
  const collectedPct = target > 0 ? Math.round((collected / target) * 100) : 0;
  return {
    id: `pot_expired:${pot.id}`,
    type: "pot_expired",
    occurredAt: pot.updatedAt,
    sourceTag: "pot_expired",
    sourceId: pot.id,
    potId: pot.id,
    potTitle: pot.title,
    actorName: null,
    amountKobo: collected,
    meta: { collectedPct },
  };
}

export function potNudgedRow(
  nudge: { potId: string; sentAt: Date },
  potTitle: string,
  recipientCount: number,
): ActivityRow {
  return {
    id: `pot_nudge:${nudge.potId}:${nudge.sentAt.toISOString()}`,
    type: "reminder_sent",
    occurredAt: nudge.sentAt,
    sourceTag: "pot_nudge",
    sourceId: `${nudge.potId}:${nudge.sentAt.toISOString()}`,
    potId: nudge.potId,
    potTitle,
    actorName: null,
    amountKobo: null,
    meta: { recipientCount },
  };
}

export function settlementToRow(
  settlement: SettlementSource,
  potTitle: string,
): ActivityRow {
  const type = SETTLEMENT_TYPE_TO_ACTIVITY[settlement.type];
  const meta: Record<string, unknown> = { nombaRef: settlement.nombaRef };
  if (settlement.type === DbSettlementType.BILL_PAYMENT) {
    meta.vendToken = settlement.vendToken;
  }
  return {
    id: `settlement:${settlement.id}`,
    type,
    occurredAt: settlement.settledAt ?? settlement.createdAt,
    sourceTag: "settlement",
    sourceId: settlement.id,
    potId: settlement.potId,
    potTitle,
    actorName: null,
    amountKobo: Number(settlement.amountKobo),
    meta,
  };
}

export function walletEntryToRow(
  entry: LedgerEntryWithPot,
  potTitle: string | null,
): ActivityRow {
  const type = walletActivityType(entry);
  const signed =
    entry.direction === LedgerDirection.Credit
      ? entry.amountKobo
      : -entry.amountKobo;
  return {
    id: `wallet:${entry.entryId}`,
    type,
    occurredAt: entry.occurredAt,
    sourceTag: "wallet",
    sourceId: entry.entryId,
    potId: entry.potId,
    potTitle,
    actorName: null,
    amountKobo: signed,
    meta: { txnKind: entry.kind },
  };
}

function walletActivityType(entry: LedgerEntryView): ActivityType {
  if (entry.kind === "wallet_settlement") {
    return "wallet_settlement_in";
  }
  if (
    entry.direction === LedgerDirection.Debit ||
    entry.kind === "withdrawal"
  ) {
    return "wallet_withdrawal";
  }
  if (WALLET_CREDIT_KINDS.has(entry.kind)) {
    return "wallet_credit";
  }
  return "wallet_credit";
}

export function composeHeadline(row: ActivityRow): string {
  const amount = row.amountKobo !== null ? formatNaira(row.amountKobo) : null;
  const pot = row.potTitle ?? "your pot";
  switch (row.type) {
    case "contribution_received":
      return `${row.actorName ?? "Someone"} paid ${amount ?? "money"} to ${pot}`;
    case "pot_created":
      return `You created a new pot: ${pot}`;
    case "pot_funded":
      return `${pot} is fully funded`;
    case "pot_settled_bank":
      return `${pot} has been settled to your bank account`;
    case "pot_settled_bill":
      return `${pot} bill has been paid`;
    case "pot_settled_wallet":
      return `${pot} settled to your wallet`;
    case "pot_expired": {
      const pct =
        typeof row.meta?.collectedPct === "number" ? row.meta.collectedPct : 0;
      return `${pot} expired with ${pct}% collected`;
    }
    case "reminder_sent": {
      const count =
        typeof row.meta?.recipientCount === "number"
          ? row.meta.recipientCount
          : 0;
      return `You sent a reminder to ${count} people`;
    }
    case "wallet_credit":
      return amount ? `Received ${amount} to your wallet` : `Wallet credited`;
    case "wallet_withdrawal":
      return amount
        ? `Withdrew ${formatNaira(Math.abs(row.amountKobo ?? 0))} from your wallet`
        : `Wallet withdrawal`;
    case "wallet_settlement_in":
      return `${pot} settled to your wallet`;
    default:
      return pot;
  }
}

export function rowToItem(row: ActivityRow): ActivityItem {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    headline: composeHeadline(row),
    potId: row.potId,
    potTitle: row.potTitle,
    actorName: row.actorName,
    amountKobo: row.amountKobo,
    meta: row.meta,
  };
}

export function compareRowsDesc(a: ActivityRow, b: ActivityRow): number {
  if (a.occurredAt.getTime() !== b.occurredAt.getTime()) {
    return b.occurredAt.getTime() - a.occurredAt.getTime();
  }
  if (a.sourceTag !== b.sourceTag) {
    return a.sourceTag < b.sourceTag ? 1 : -1;
  }
  if (a.sourceId !== b.sourceId) {
    return a.sourceId < b.sourceId ? 1 : -1;
  }
  return 0;
}

export function isBeforeCursor(
  row: ActivityRow,
  cursor: ActivityCursor,
): boolean {
  if (row.occurredAt.getTime() !== cursor.occurredAt.getTime()) {
    return row.occurredAt.getTime() < cursor.occurredAt.getTime();
  }
  if (row.sourceTag !== cursor.sourceTag) {
    return row.sourceTag > cursor.sourceTag;
  }
  return row.sourceId > cursor.sourceId;
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  const payload = `${cursor.occurredAt.toISOString()}|${cursor.sourceTag}|${cursor.sourceId}`;
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeActivityCursor(
  cursor: string | undefined,
): ActivityCursor | undefined {
  if (cursor === undefined || cursor.length === 0) {
    return undefined;
  }
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const parts = decoded.split("|");
  if (parts.length !== 3) {
    throw new BadRequestException("invalid cursor");
  }
  const occurredAtMs = Date.parse(parts[0]);
  if (
    Number.isNaN(occurredAtMs) ||
    parts[1].length === 0 ||
    parts[2].length === 0
  ) {
    throw new BadRequestException("invalid cursor");
  }
  return {
    occurredAt: new Date(occurredAtMs),
    sourceTag: parts[1],
    sourceId: parts[2],
  };
}

function formatNaira(kobo: number): string {
  const naira = Math.abs(kobo) / 100;
  const formatted = naira.toLocaleString("en-NG", {
    minimumFractionDigits: naira % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `₦${formatted}`;
}
