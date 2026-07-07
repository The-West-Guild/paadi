import { z } from "zod";

export const paySplitFromWalletParamsSchema = z.object({
  potId: z.string().uuid(),
  splitId: z.string().uuid()
});

export const paySplitFromWalletSchema = z.object({
  amountKobo: z.number().int().positive().optional(),
  pin: z.string().regex(/^\d{4}$/)
});

export const payFromWalletBodySchema = paySplitFromWalletSchema.merge(
  paySplitFromWalletParamsSchema
);

export const withdrawSchema = z.object({
  amountKobo: z.number().int().positive(),
  payoutAccountId: z.string().uuid().optional(),
  pin: z.string().regex(/^\d{4}$/)
});

export const withdrawalParamsSchema = z.object({
  id: z.string().uuid()
});

export const withdrawalDestinationSchema = z.object({
  bankName: z.string(),
  accountNumberLast4: z.string(),
  accountName: z.string()
});

export const withdrawalViewSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  amountKobo: z.number().int().nonnegative(),
  feeKobo: z.number().int().nonnegative(),
  nombaRef: z.string().nullable(),
  providerStatus: z.string().nullable(),
  failureReason: z
    .enum([
      "kyc_tier_required",
      "name_mismatch",
      "payout_account_invalid",
      "biller_fields_missing",
      "gateway",
      "provider_declined"
    ])
    .nullable(),
  destination: withdrawalDestinationSchema,
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable()
});

export const withdrawalsResponseSchema = z.object({
  withdrawals: z.array(withdrawalViewSchema)
});

export type PaySplitFromWalletParams = z.infer<
  typeof paySplitFromWalletParamsSchema
>;
export type PaySplitFromWalletInput = z.infer<typeof paySplitFromWalletSchema>;
export type PayFromWalletInput = z.infer<typeof payFromWalletBodySchema>;
export type WithdrawInput = z.infer<typeof withdrawSchema>;
export type WithdrawalParams = z.infer<typeof withdrawalParamsSchema>;
export type WithdrawalDestination = z.infer<typeof withdrawalDestinationSchema>;
export type WithdrawalView = z.infer<typeof withdrawalViewSchema>;
export type WithdrawalsResponse = z.infer<typeof withdrawalsResponseSchema>;
