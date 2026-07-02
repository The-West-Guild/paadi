import { z } from "zod";

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

export const walletBalanceResponseSchema = z.object({
  balanceKobo: z.number().int(),
  currency: z.literal("NGN"),
  asOf: z.string().datetime(),
  virtualAccount: z
    .object({
      accountNumber: z.string(),
      bankName: z.string(),
      accountName: z.string(),
      status: z.enum(["ACTIVE", "CLOSED", "SUSPENDED"])
    })
    .nullable()
});

export const walletTransactionItemSchema = z.object({
  id: z.string(),
  direction: z.enum(["credit", "debit"]),
  amountKobo: z.number().int(),
  kind: z.enum([
    "va_credit",
    "exception_credit",
    "split_payment",
    "pot_settlement",
    "withdrawal",
    "refund",
    "other"
  ]),
  occurredAt: z.string().datetime(),
  description: z.string(),
  counterparty: z.string().nullable(),
  potId: z.string().nullable(),
  potTitle: z.string().nullable(),
  nombaRef: z.string().nullable(),
  status: z.string()
});

export const walletStatementResponseSchema = z.object({
  items: z.array(walletTransactionItemSchema),
  nextCursor: z.string().nullable(),
  balanceKobo: z.number().int()
});

export const statementQuerySchema = paginationQuerySchema.extend({
  direction: z.enum(["credit", "debit"]).optional()
});

export const activityItemSchema = z.object({
  id: z.string(),
  type: z.enum([
    "contribution_received",
    "pot_created",
    "pot_funded",
    "pot_settled_bank",
    "pot_settled_bill",
    "pot_settled_wallet",
    "pot_expired",
    "reminder_sent",
    "wallet_credit",
    "wallet_withdrawal",
    "wallet_settlement_in"
  ]),
  occurredAt: z.string().datetime(),
  headline: z.string(),
  potId: z.string().nullable(),
  potTitle: z.string().nullable(),
  actorName: z.string().nullable(),
  amountKobo: z.number().int().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable()
});

export const activityFeedResponseSchema = z.object({
  items: z.array(activityItemSchema),
  nextCursor: z.string().nullable()
});

export const potContributionsSummarySchema = z.object({
  contributorCount: z.number().int(),
  paidSplitCount: z.number().int(),
  totalSplitCount: z.number().int(),
  collectedKobo: z.number().int(),
  targetKobo: z.number().int()
});

export const potActivityResponseSchema = z.object({
  items: z.array(activityItemSchema),
  nextCursor: z.string().nullable(),
  contributions: potContributionsSummarySchema
});

export const receiptResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("contribution"),
    reference: z.string(),
    amountKobo: z.number().int(),
    status: z.string(),
    paidAt: z.string().datetime(),
    method: z.enum(["card", "transfer", "ussd", "wallet"]).nullable(),
    payer: z.object({
      name: z.string().nullable(),
      bank: z.string().nullable(),
      account: z.string().nullable()
    }),
    pot: z.object({ id: z.string(), title: z.string() }),
    split: z.object({ label: z.string() }).nullable()
  }),
  z.object({
    kind: z.literal("settlement"),
    reference: z.string(),
    nombaRef: z.string().nullable(),
    amountKobo: z.number().int(),
    status: z.string(),
    settledAt: z.string().datetime(),
    type: z.enum(["bill_payment", "bank_payout", "wallet"]),
    pot: z.object({ id: z.string(), title: z.string() }),
    vend: z
      .object({ token: z.string().nullable(), units: z.string().nullable() })
      .nullable(),
    destination: z
      .object({
        bank: z.string(),
        accountName: z.string(),
        accountNumber: z.string()
      })
      .nullable()
  })
]);

export const reconciliationReportResponseSchema = z.object({
  asOf: z.string().datetime(),
  currency: z.literal("NGN"),
  pooledCashKobo: z.number().int(),
  sumLiabilitiesKobo: z.number().int(),
  breakdown: z.object({
    potLiabilityKobo: z.number().int(),
    userWalletKobo: z.number().int(),
    exceptionsSuspenseKobo: z.number().int(),
    settlementPayoutKobo: z.number().int(),
    platformFeeKobo: z.number().int(),
    refundsPayableKobo: z.number().int()
  }),
  internalDriftKobo: z.number().int(),
  balanced: z.boolean(),
  external: z.union([
    z.object({
      nombaKobo: z.number().int(),
      externalDriftKobo: z.number().int()
    }),
    z.literal("unavailable")
  ]),
  counts: z.object({
    pots: z.number().int(),
    wallets: z.number().int(),
    openExceptions: z.number().int()
  })
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type WalletBalanceResponse = z.infer<typeof walletBalanceResponseSchema>;
export type WalletTransactionItem = z.infer<typeof walletTransactionItemSchema>;
export type WalletStatementResponse = z.infer<
  typeof walletStatementResponseSchema
>;
export type StatementQuery = z.infer<typeof statementQuerySchema>;
export type ActivityItem = z.infer<typeof activityItemSchema>;
export type ActivityFeedResponse = z.infer<typeof activityFeedResponseSchema>;
export type PotContributionsSummary = z.infer<
  typeof potContributionsSummarySchema
>;
export type PotActivityResponse = z.infer<typeof potActivityResponseSchema>;
export type ReceiptResponse = z.infer<typeof receiptResponseSchema>;
export type ReconciliationReportResponse = z.infer<
  typeof reconciliationReportResponseSchema
>;
