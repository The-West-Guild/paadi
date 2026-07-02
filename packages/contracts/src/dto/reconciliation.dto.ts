import { z } from "zod";

export const listExceptionsQuerySchema = z.object({
  status: z.enum(["OPEN", "RESOLVED", "REFUNDED"]).optional(),
  reason: z
    .enum([
      "UNKNOWN_ACCOUNT",
      "CLOSED_ACCOUNT",
      "NAME_MISMATCH",
      "AMOUNT_MISMATCH",
      "DUPLICATE",
    ])
    .optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListExceptionsQuery = z.infer<typeof listExceptionsQuerySchema>;

export const exceptionParamsSchema = z.object({ id: z.string().uuid() });
export type ExceptionParams = z.infer<typeof exceptionParamsSchema>;

export const exceptionSchema = z.object({
  id: z.string().uuid(),
  nombaTransactionId: z.string(),
  amountKobo: z.number().int().nonnegative(),
  reason: z.enum([
    "UNKNOWN_ACCOUNT",
    "CLOSED_ACCOUNT",
    "NAME_MISMATCH",
    "AMOUNT_MISMATCH",
    "DUPLICATE",
  ]),
  status: z.enum(["OPEN", "RESOLVED", "REFUNDED"]),
  senderName: z.string().nullable(),
  senderAccount: z.string().nullable(),
  senderBank: z.string().nullable(),
  vaAccountNumber: z.string().nullable(),
  matchedUserId: z.string().uuid().nullable(),
  resolvedBy: z.string().uuid().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  note: z.string().nullable(),
  refundStatus: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ExceptionDto = z.infer<typeof exceptionSchema>;

export const listExceptionsResponseSchema = z.object({
  items: z.array(exceptionSchema),
  nextCursor: z.string().uuid().nullable(),
  totals: z.object({
    openCount: z.number().int(),
    openAmountKobo: z.number().int(),
  }),
});
export type ListExceptionsResponse = z.infer<
  typeof listExceptionsResponseSchema
>;

export const resolveExceptionSchema = z
  .object({
    action: z.enum(["assign", "refund", "hold"]),
    userId: z.string().uuid().optional(),
    bankCode: z.string().optional(),
    note: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "assign" && !v.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userId"],
        message: "userId required to assign",
      });
    }
  });
export type ResolveExceptionInput = z.infer<typeof resolveExceptionSchema>;
