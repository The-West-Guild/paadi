import { z } from "zod";

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional()
});

export const changeUsernameSchema = z.object({
  username: z.string()
});

export const publicProfileResponseSchema = z.object({
  username: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable()
});

export const meResponseSchema = z.object({
  id: z.string(),
  phoneMasked: z.string(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  tier: z.string(),
  kycStatus: z.string(),
  status: z.string(),
  profile: z.object({
    username: z.string(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable()
  })
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangeUsernameInput = z.infer<typeof changeUsernameSchema>;
export type PublicProfileResponse = z.infer<typeof publicProfileResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
