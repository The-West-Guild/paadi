import { z } from "zod";

export const bankSchema = z.object({
  code: z.string(),
  name: z.string()
});

export const banksResponseSchema = z.object({
  banks: z.array(bankSchema)
});

export const payoutLookupSchema = z.object({
  bankCode: z.string().min(1),
  accountNumber: z.string().regex(/^\d{10}$/)
});

export const payoutLookupResponseSchema = z.object({
  accountName: z.string()
});

export const createPayoutAccountSchema = z.object({
  bankCode: z.string().min(1),
  accountNumber: z.string().regex(/^\d{10}$/),
  pin: z.string().regex(/^\d{4}$/)
});

export const payoutAccountSchema = z.object({
  id: z.string(),
  bankCode: z.string(),
  bankName: z.string(),
  accountNumberLast4: z.string(),
  accountName: z.string(),
  nameMatchVerified: z.boolean(),
  isPrimary: z.boolean()
});

export const payoutAccountsResponseSchema = z.object({
  accounts: z.array(payoutAccountSchema)
});

export const payoutAccountParamsSchema = z.object({
  id: z.string().uuid()
});

export const deletePayoutAccountSchema = z.object({
  pin: z.string().regex(/^\d{4}$/)
});

export type Bank = z.infer<typeof bankSchema>;
export type BanksResponse = z.infer<typeof banksResponseSchema>;
export type PayoutLookupInput = z.infer<typeof payoutLookupSchema>;
export type PayoutLookupResponse = z.infer<typeof payoutLookupResponseSchema>;
export type CreatePayoutAccountInput = z.infer<typeof createPayoutAccountSchema>;
export type PayoutAccountDto = z.infer<typeof payoutAccountSchema>;
export type PayoutAccountsResponse = z.infer<typeof payoutAccountsResponseSchema>;
export type PayoutAccountParams = z.infer<typeof payoutAccountParamsSchema>;
export type DeletePayoutAccountInput = z.infer<typeof deletePayoutAccountSchema>;
