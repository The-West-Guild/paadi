import { z } from "zod";

export const emailStartSchema = z.object({
  email: z.string().email()
});

export const emailVerifySchema = z.object({
  code: z.string().length(6)
});

export type EmailStartInput = z.infer<typeof emailStartSchema>;
export type EmailVerifyInput = z.infer<typeof emailVerifySchema>;
