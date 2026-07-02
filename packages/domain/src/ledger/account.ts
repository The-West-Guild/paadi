export const LedgerAccountKind = {
  PooledCash: "pooled_cash",
  PotLiability: "pot_liability",
  ExceptionsSuspense: "exceptions_suspense",
  UserWallet: "user_wallet",
  SettlementPayout: "settlement_payout",
  PlatformFee: "platform_fee",
  RefundsPayable: "refunds_payable"
} as const;
export type LedgerAccountKind = (typeof LedgerAccountKind)[keyof typeof LedgerAccountKind];

export const LedgerDirection = {
  Debit: "DR",
  Credit: "CR"
} as const;
export type LedgerDirection = (typeof LedgerDirection)[keyof typeof LedgerDirection];
