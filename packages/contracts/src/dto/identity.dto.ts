import { z } from "zod";

export const googleSignInSchema = z.object({
  idToken: z.string().min(1)
});

export const linkGoogleSchema = z.object({
  idToken: z.string().min(1)
});

export type GoogleSignInInput = z.infer<typeof googleSignInSchema>;
export type LinkGoogleInput = z.infer<typeof linkGoogleSchema>;
