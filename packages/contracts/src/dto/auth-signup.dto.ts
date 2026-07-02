import { z } from "zod";

export const signupStartSchema = z.object({
  phone: z.string().min(7)
});

export const signupStartResponseSchema = z.object({
  onboardingToken: z.string(),
  expiresIn: z.number(),
  otpChannel: z.string()
});

export const signupVerifyPhoneSchema = z.object({
  onboardingToken: z.string(),
  code: z.string().length(6)
});

export const signupProfileSchema = z.object({
  onboardingToken: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().min(1)
});

export const usernameAvailableQuerySchema = z.object({
  u: z.string()
});

export const usernameAvailableResponseSchema = z.object({
  available: z.boolean(),
  normalized: z.string(),
  reason: z.string().optional()
});

export const signupUsernameSchema = z.object({
  onboardingToken: z.string(),
  username: z.string()
});

export const signupPasswordSchema = z.object({
  onboardingToken: z.string(),
  password: z.string().min(8)
});

export const signupPinSchema = z.object({
  onboardingToken: z.string(),
  pin: z.string().regex(/^\d{4}$/)
});

export type SignupStartInput = z.infer<typeof signupStartSchema>;
export type SignupStartResponse = z.infer<typeof signupStartResponseSchema>;
export type SignupVerifyPhoneInput = z.infer<typeof signupVerifyPhoneSchema>;
export type SignupProfileInput = z.infer<typeof signupProfileSchema>;
export type UsernameAvailableQuery = z.infer<typeof usernameAvailableQuerySchema>;
export type UsernameAvailableResponse = z.infer<typeof usernameAvailableResponseSchema>;
export type SignupUsernameInput = z.infer<typeof signupUsernameSchema>;
export type SignupPasswordInput = z.infer<typeof signupPasswordSchema>;
export type SignupPinInput = z.infer<typeof signupPinSchema>;
