import { z } from "zod";
import { potContributionsSummarySchema } from "./statement.dto";

export const splitInputSchema = z.object({
  label: z.string().min(1).max(80),
  phone: z.string().optional(),
  weight: z.number().positive().optional(),
  amountKobo: z.number().int().positive().optional(),
  percent: z.number().positive().max(100).optional(),
});

export const createPotSchema = z
  .object({
    title: z.string().min(3).max(120),
    description: z.string().max(500).optional(),
    totalKobo: z.number().int().positive(),
    settlementType: z.enum(["bill_payment", "bank_payout", "wallet"]),
    completionRule: z.enum(["progressive", "all_or_nothing"]),
    attributionMode: z
      .enum(["checkout_link", "virtual_account"])
      .default("checkout_link"),
    splitMode: z.enum(["weight", "amount", "percent"]).default("weight"),
    deadlineAt: z.string().datetime().optional(),
    billerCategory: z.enum(["electricity", "cable"]).optional(),
    billerProductCode: z.string().min(1).max(64).optional(),
    billerCustomerId: z.string().min(1).max(64).optional(),
    meterType: z.enum(["PREPAID", "POSTPAID"]).optional(),
    payoutAccountId: z.string().uuid().optional(),
    splits: z.array(splitInputSchema).min(2).max(50)
  })
  .superRefine((data, ctx) => {
    if (data.attributionMode === "virtual_account") {
      ctx.addIssue({
        code: "custom",
        path: ["attributionMode"],
        message: "virtual account attribution is not yet supported"
      });
    }
    if (data.settlementType === "bill_payment") {
      if (!data.billerCategory)
        ctx.addIssue({
          code: "custom",
          path: ["billerCategory"],
          message: "billerCategory is required for bill_payment pots"
        });
      if (!data.billerProductCode)
        ctx.addIssue({
          code: "custom",
          path: ["billerProductCode"],
          message: "billerProductCode is required for bill_payment pots"
        });
      if (!data.billerCustomerId)
        ctx.addIssue({
          code: "custom",
          path: ["billerCustomerId"],
          message: "billerCustomerId is required for bill_payment pots"
        });
      if (data.billerCategory === "electricity" && !data.meterType)
        ctx.addIssue({
          code: "custom",
          path: ["meterType"],
          message: "meterType is required for electricity bill_payment pots"
        });
    }
    if (
      data.splitMode === "weight" &&
      !data.splits.every(
        (s) =>
          s.weight !== undefined &&
          s.amountKobo === undefined &&
          s.percent === undefined
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["splits"],
        message: "each split must have a positive weight in weight mode"
      });
    }
    if (data.splitMode === "amount") {
      const ok = data.splits.every(
        (s) =>
          s.amountKobo !== undefined &&
          s.weight === undefined &&
          s.percent === undefined
      );
      if (!ok)
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message: "each split must have a positive amountKobo in amount mode"
        });
      else if (
        data.splits.reduce((t, s) => t + (s.amountKobo ?? 0), 0) !==
        data.totalKobo
      )
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message: "split amounts must sum to totalKobo"
        });
    }
    if (data.splitMode === "percent") {
      const ok = data.splits.every(
        (s) =>
          s.percent !== undefined &&
          s.weight === undefined &&
          s.amountKobo === undefined
      );
      if (!ok)
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message: "each split must have a positive percent in percent mode"
        });
      else if (data.splits.reduce((t, s) => t + (s.percent ?? 0), 0) !== 100)
        ctx.addIssue({
          code: "custom",
          path: ["splits"],
          message: "split percentages must sum to 100"
        });
    }
  });

export const potParamsSchema = z.object({ id: z.string().uuid() });

export const listPotsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z
    .enum([
      "draft",
      "open",
      "funded",
      "settling",
      "settled",
      "expired",
      "cancelled",
      "refunding",
      "refunded"
    ])
    .optional()
});

export const updatePotSchema = z
  .object({
    title: z.string().min(3).max(120).optional(),
    description: z.string().max(500).optional(),
    deadlineAt: z.string().datetime().optional()
  })
  .refine(
    (d) =>
      d.title !== undefined ||
      d.description !== undefined ||
      d.deadlineAt !== undefined,
    { message: "at least one field must be provided" }
  );

export const splitDetailSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  shareKobo: z.number().int(),
  paidKobo: z.number().int(),
  status: z.enum([
    "pending",
    "partially_paid",
    "paid",
    "overpaid",
    "expired",
    "refunded"
  ]),
  payToken: z.string(),
  checkoutUrl: z.string().nullable(),
  paidAt: z.string().datetime().nullable()
});

export const potProgressSchema = z.object({
  collectedKobo: z.number().int(),
  targetKobo: z.number().int(),
  paidCount: z.number().int(),
  splitCount: z.number().int()
});

export const potSettlementSchema = z.object({
  id: z.string().uuid(),
  potId: z.string().uuid(),
  type: z.enum(["bill_payment", "bank_payout", "wallet"]),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  amountKobo: z.number().int().nonnegative(),
  feeKobo: z.number().int().nonnegative(),
  vendToken: z.string().nullable(),
  vendUnits: z.string().nullable(),
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
  settledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime()
});

export const potDetailSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  totalKobo: z.number().int(),
  settlementType: z.enum(["bill_payment", "bank_payout", "wallet"]),
  completionRule: z.enum(["progressive", "all_or_nothing"]),
  status: z.enum([
    "draft",
    "open",
    "funded",
    "settling",
    "settled",
    "expired",
    "cancelled",
    "refunding",
    "refunded"
  ]),
  billerCategory: z.enum(["electricity", "cable"]).nullable(),
  billerProductCode: z.string().nullable(),
  billerCustomerId: z.string().nullable(),
  meterType: z.enum(["PREPAID", "POSTPAID"]).nullable(),
  deadlineAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  progress: potProgressSchema,
  settlement: potSettlementSchema.nullable(),
  splits: z.array(splitDetailSchema),
  contributions: potContributionsSummarySchema.optional()
});

export const potSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum([
    "draft",
    "open",
    "funded",
    "settling",
    "settled",
    "expired",
    "cancelled",
    "refunding",
    "refunded"
  ]),
  totalKobo: z.number().int(),
  collectedKobo: z.number().int(),
  splitCount: z.number().int(),
  paidCount: z.number().int(),
  deadlineAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime()
});

export const listPotsResponseSchema = z.object({
  items: z.array(potSummarySchema),
  nextCursor: z.string().uuid().nullable()
});

export const payViewSchema = z.object({
  potTitle: z.string(),
  organizerName: z.string(),
  organizerHandle: z.string(),
  splitLabel: z.string(),
  shareKobo: z.number().int(),
  paidKobo: z.number().int(),
  shareStatus: z.enum([
    "pending",
    "partially_paid",
    "paid",
    "overpaid",
    "expired",
    "refunded"
  ]),
  potStatus: z.enum([
    "draft",
    "open",
    "funded",
    "settling",
    "settled",
    "expired",
    "cancelled",
    "refunding",
    "refunded"
  ]),
  progress: potProgressSchema,
  checkoutUrl: z.string().nullable()
});

export type SplitInput = z.infer<typeof splitInputSchema>;
export type CreatePotInput = z.infer<typeof createPotSchema>;
export type PotParams = z.infer<typeof potParamsSchema>;
export type ListPotsQuery = z.infer<typeof listPotsQuerySchema>;
export type UpdatePotInput = z.infer<typeof updatePotSchema>;
export type SplitDetail = z.infer<typeof splitDetailSchema>;
export type PotProgress = z.infer<typeof potProgressSchema>;
export type PotSettlement = z.infer<typeof potSettlementSchema>;
export type PotDetail = z.infer<typeof potDetailSchema>;
export type PotSummary = z.infer<typeof potSummarySchema>;
export type ListPotsResponse = z.infer<typeof listPotsResponseSchema>;
export type PayView = z.infer<typeof payViewSchema>;
