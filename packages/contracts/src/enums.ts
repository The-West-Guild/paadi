export const Tier = {
  Tier0: "TIER_0",
  Tier1: "TIER_1",
  Tier2: "TIER_2",
} as const;
export type Tier = (typeof Tier)[keyof typeof Tier];

export const PoolState = {
  Draft: "draft",
  Open: "open",
  Funded: "funded",
  Settling: "settling",
  Settled: "settled",
  Expired: "expired",
  Cancelled: "cancelled",
  Refunding: "refunding",
  Refunded: "refunded",
} as const;
export type PoolState = (typeof PoolState)[keyof typeof PoolState];

export const ShareState = {
  Pending: "pending",
  PartiallyPaid: "partially_paid",
  Paid: "paid",
  Overpaid: "overpaid",
  Expired: "expired",
  Refunded: "refunded",
} as const;
export type ShareState = (typeof ShareState)[keyof typeof ShareState];

export const BillerCategory = {
  Electricity: "electricity",
  Cable: "cable",
} as const;
export type BillerCategory =
  (typeof BillerCategory)[keyof typeof BillerCategory];

export const MeterType = {
  Prepaid: "PREPAID",
  Postpaid: "POSTPAID",
} as const;
export type MeterType = (typeof MeterType)[keyof typeof MeterType];

export const SettlementType = {
  BillPayment: "bill_payment",
  BankPayout: "bank_payout",
  Wallet: "wallet",
} as const;
export type SettlementType =
  (typeof SettlementType)[keyof typeof SettlementType];

export const CompletionRule = {
  Progressive: "progressive",
  AllOrNothing: "all_or_nothing",
} as const;
export type CompletionRule =
  (typeof CompletionRule)[keyof typeof CompletionRule];

export const AttributionMode = {
  CheckoutLink: "checkout_link",
  VirtualAccount: "virtual_account",
} as const;
export type AttributionMode =
  (typeof AttributionMode)[keyof typeof AttributionMode];

export const PaymentMethod = {
  Card: "card",
  Transfer: "transfer",
  Ussd: "ussd",
  Wallet: "wallet",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentRecordStatus = {
  Succeeded: "succeeded",
  OverCollection: "over_collection",
  PostTerminal: "post_terminal",
  Unmatched: "unmatched",
  AmountMismatch: "amount_mismatch",
  Unconfirmed: "unconfirmed",
} as const;
export type PaymentRecordStatus =
  (typeof PaymentRecordStatus)[keyof typeof PaymentRecordStatus];

export const SettlementRecordStatus = {
  Pending: "pending",
  Processing: "processing",
  Completed: "completed",
  Failed: "failed",
} as const;
export type SettlementRecordStatus =
  (typeof SettlementRecordStatus)[keyof typeof SettlementRecordStatus];

export const WithdrawalStatus = {
  Pending: "pending",
  Processing: "processing",
  Completed: "completed",
  Failed: "failed",
} as const;
export type WithdrawalStatus =
  (typeof WithdrawalStatus)[keyof typeof WithdrawalStatus];

export const SettlementFailureReason = {
  KycTierRequired: "kyc_tier_required",
  NameMismatch: "name_mismatch",
  PayoutAccountInvalid: "payout_account_invalid",
  BillerFieldsMissing: "biller_fields_missing",
  Gateway: "gateway",
  ProviderDeclined: "provider_declined",
} as const;
export type SettlementFailureReason =
  (typeof SettlementFailureReason)[keyof typeof SettlementFailureReason];

export const RefundRecordStatus = {
  Pending: "pending",
  Processing: "processing",
  Completed: "completed",
  Failed: "failed",
} as const;
export type RefundRecordStatus =
  (typeof RefundRecordStatus)[keyof typeof RefundRecordStatus];

export const VirtualAccountStatus = {
  Active: "ACTIVE",
  Suspended: "SUSPENDED",
  Closed: "CLOSED",
} as const;
export type VirtualAccountStatus =
  (typeof VirtualAccountStatus)[keyof typeof VirtualAccountStatus];

export const VirtualAccountKind = {
  Static: "STATIC",
} as const;
export type VirtualAccountKind =
  (typeof VirtualAccountKind)[keyof typeof VirtualAccountKind];

export const ExceptionReason = {
  UnknownAccount: "UNKNOWN_ACCOUNT",
  ClosedAccount: "CLOSED_ACCOUNT",
  NameMismatch: "NAME_MISMATCH",
  AmountMismatch: "AMOUNT_MISMATCH",
  Duplicate: "DUPLICATE",
} as const;
export type ExceptionReason =
  (typeof ExceptionReason)[keyof typeof ExceptionReason];

export const ExceptionStatus = {
  Open: "OPEN",
  Resolved: "RESOLVED",
  Refunded: "REFUNDED",
} as const;
export type ExceptionStatus =
  (typeof ExceptionStatus)[keyof typeof ExceptionStatus];

export const ExceptionResolutionAction = {
  Assign: "assign",
  Refund: "refund",
  Hold: "hold",
} as const;
export type ExceptionResolutionAction =
  (typeof ExceptionResolutionAction)[keyof typeof ExceptionResolutionAction];

export const WebhookEndpointStatus = {
  Active: "ACTIVE",
  Disabled: "DISABLED",
} as const;
export type WebhookEndpointStatus =
  (typeof WebhookEndpointStatus)[keyof typeof WebhookEndpointStatus];

export const WebhookDeliveryStatus = {
  Pending: "PENDING",
  Delivered: "DELIVERED",
  Failed: "FAILED",
  Dead: "DEAD",
} as const;
export type WebhookDeliveryStatus =
  (typeof WebhookDeliveryStatus)[keyof typeof WebhookDeliveryStatus];

export const PaadiErrorCode = {
  VaLimitReached: "VA_LIMIT_REACHED",
  VaNotProvisioned: "VA_NOT_PROVISIONED",
  WalletInsufficientFunds: "WALLET_INSUFFICIENT_FUNDS",
  KycTierRequired: "KYC_TIER_REQUIRED",
  ExceptionAlreadyResolved: "EXCEPTION_ALREADY_RESOLVED",
  NameMismatch: "NAME_MISMATCH",
} as const;
export type PaadiErrorCode =
  (typeof PaadiErrorCode)[keyof typeof PaadiErrorCode];
