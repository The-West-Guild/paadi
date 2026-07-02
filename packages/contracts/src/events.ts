export type PaadiEvent =
  | {
      type: "payment.succeeded";
      potId: string;
      splitId: string;
      amountKobo: number;
    }
  | { type: "pool.funded"; potId: string }
  | { type: "pool.expired"; potId: string }
  | { type: "nudge.organizer_sent"; potId: string; recipientCount: number }
  | { type: "nudge.payer_sent"; potId: string; splitId: string }
  | { type: "pool.cancelled"; potId: string }
  | { type: "pool.settled"; potId: string; vendToken: string | null }
  | { type: "pool.refunded"; potId: string }
  | {
      type: "virtual_account.provisioned";
      userId: string;
      accountNumber: string;
    }
  | { type: "virtual_account.renamed"; userId: string; accountNumber: string }
  | { type: "virtual_account.closed"; userId: string; accountNumber: string }
  | { type: "kyc.verified"; userId: string }
  | { type: "profile.name_changed"; userId: string }
  | {
      type: "wallet.credited";
      userId: string;
      amountKobo: number;
      nombaTransactionId: string;
    }
  | {
      type: "wallet.credit_unmatched";
      reason: string;
      accountNumber: string | null;
      nombaTransactionId: string;
      amountKobo: number;
    }
  | {
      type: "exception.raised";
      exceptionId: string;
      amountKobo: number;
      reason: string;
    }
  | {
      type: "exception.resolved";
      exceptionId: string;
      action: string;
      amountKobo: number;
      userId?: string;
    }
  | {
      type: "wallet.debited";
      userId: string;
      amountKobo: number;
      reason: "split_payment" | "withdrawal";
      potId?: string;
      withdrawalId?: string;
    }
  | {
      type: "withdrawal.completed";
      userId: string;
      withdrawalId: string;
      amountKobo: number;
      nombaRef: string | null;
    }
  | {
      type: "withdrawal.failed";
      userId: string;
      withdrawalId: string;
      amountKobo: number;
      reason: string;
    };

export type PaadiEventType = PaadiEvent["type"];

export const OutboundEventType = {
  WalletCredited: "wallet.credited",
  WalletDebited: "wallet.debited",
  WithdrawalCompleted: "withdrawal.completed",
  ExceptionResolved: "exception.resolved",
} as const;
export type OutboundEventType =
  (typeof OutboundEventType)[keyof typeof OutboundEventType];

export const OUTBOUND_EVENT_TYPES = [
  OutboundEventType.WalletCredited,
  OutboundEventType.WalletDebited,
  OutboundEventType.WithdrawalCompleted,
  OutboundEventType.ExceptionResolved,
] as const satisfies readonly PaadiEventType[];

export function isOutboundEventType(
  value: string
): value is OutboundEventType {
  return (OUTBOUND_EVENT_TYPES as readonly string[]).includes(value);
}
