import { z } from "zod";

export const virtualAccountStatusSchema = z.enum([
  "ACTIVE",
  "SUSPENDED",
  "CLOSED"
]);

export const virtualAccountKindSchema = z.enum(["STATIC"]);

export const virtualAccountResponseSchema = z.object({
  accountNumber: z.string(),
  accountName: z.string(),
  providerBank: z.string(),
  status: virtualAccountStatusSchema,
  kind: virtualAccountKindSchema,
  createdAt: z.string()
});

export const provisionVirtualAccountSchema = z.object({}).strict();

export type VirtualAccountResponse = z.infer<typeof virtualAccountResponseSchema>;
export type ProvisionVirtualAccountInput = z.infer<
  typeof provisionVirtualAccountSchema
>;
