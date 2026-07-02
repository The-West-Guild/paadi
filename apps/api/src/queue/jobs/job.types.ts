export interface SettlementJob {
  potId: string;
}

export interface SettlementConfirmJob {
  kind: "settlement";
  id: string;
  attempt?: number;
}

export interface WithdrawalConfirmJob {
  kind: "withdrawal";
  id: string;
  attempt?: number;
}

export interface LegacyPayoutConfirmJob {
  settlementId: string;
  attempt?: number;
}

export type PayoutConfirmJob =
  | SettlementConfirmJob
  | WithdrawalConfirmJob
  | LegacyPayoutConfirmJob;

export interface ReconciliationJob {
  from: string;
  to: string;
}

export interface OutboxJob {
  messageId: string;
}

export interface DeadlineSweepJob {
  potId: string;
}

export interface NudgeJob {
  potId: string;
  splitId: string;
}

export interface VaProvisioningJob {
  kind: "provision" | "rename";
  userId: string;
}
