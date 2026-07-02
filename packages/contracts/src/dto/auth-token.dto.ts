import { z } from "zod";

export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  tokenType: z.literal("Bearer")
});

export type AuthSession = z.infer<typeof authSessionSchema>;
