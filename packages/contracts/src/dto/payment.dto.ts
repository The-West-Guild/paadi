import { z } from "zod";

export const payTokenParamsSchema = z.object({
  token: z.string().min(1)
});

export type PayTokenParams = z.infer<typeof payTokenParamsSchema>;
