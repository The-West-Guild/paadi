import { z } from "zod";
import { authSessionSchema } from "./auth-token.dto";

export const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
  deviceId: z.string().optional()
});

export const loginResponseSchema = authSessionSchema.extend({
  stepUpRequired: z.boolean().default(false)
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().min(3)
});

export const resetPasswordSchema = z.object({
  identifier: z.string().min(3),
  code: z.string().length(6),
  newPassword: z.string().min(8)
});

export const pinVerifySchema = z.object({
  pin: z.string().regex(/^\d{4}$/)
});

export const changePinSchema = z.object({
  currentPin: z.string().regex(/^\d{4}$/),
  newPin: z.string().regex(/^\d{4}$/)
});

export type LoginInput = z.infer<typeof loginSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type PinVerifyInput = z.infer<typeof pinVerifySchema>;
export type ChangePinInput = z.infer<typeof changePinSchema>;
