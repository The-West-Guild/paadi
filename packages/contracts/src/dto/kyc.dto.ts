import { z } from "zod";

export const kycBvnSchema = z.object({
  bvn: z.string().regex(/^\d{11}$/)
});

export const kycSelfieSchema = z.object({
  image: z.string().min(1)
});

export const kycStatusResponseSchema = z.object({
  kycStatus: z.string(),
  tier: z.string(),
  bvnVerified: z.boolean(),
  bvnVerifiedAt: z.string().nullable()
});

export type KycBvnInput = z.infer<typeof kycBvnSchema>;
export type KycSelfieInput = z.infer<typeof kycSelfieSchema>;
export type KycStatusResponse = z.infer<typeof kycStatusResponseSchema>;
