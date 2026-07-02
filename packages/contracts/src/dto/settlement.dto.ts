import { z } from "zod";
import { potDetailSchema, potSettlementSchema } from "./pot.dto";

export const settlePotSchema = z.object({
  potId: z.string().uuid()
});

export const refundPotSchema = z.object({
  potId: z.string().uuid()
});

export const settlementViewSchema = potSettlementSchema;

export const refundViewSchema = z.object({
  id: z.string().uuid(),
  potId: z.string().uuid(),
  paymentId: z.string().uuid(),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  amountKobo: z.number().int().nonnegative(),
  nombaRef: z.string().nullable(),
  failureReason: z.string().nullable(),
  refundedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime()
});

export const potSettlementResponseSchema = z.object({
  pot: potDetailSchema,
  settlement: settlementViewSchema.nullable(),
  refunds: z.array(refundViewSchema)
});

export type SettlePotInput = z.infer<typeof settlePotSchema>;
export type RefundPotInput = z.infer<typeof refundPotSchema>;
export type SettlementView = z.infer<typeof settlementViewSchema>;
export type RefundView = z.infer<typeof refundViewSchema>;
export type PotSettlementResponse = z.infer<typeof potSettlementResponseSchema>;
