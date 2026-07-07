import { z } from "zod";

/**
 * Environment schema for the Paadi MCP server. Parsed once at startup.
 * PAADI_PIN is optional — supplying it is what unlocks the money-moving tools.
 */
const envSchema = z.object({
  PAADI_BASE_URL: z.string().url().default("http://localhost:3001"),
  PAADI_API_KEY: z
    .string({ required_error: "PAADI_API_KEY is required" })
    .min(1, "PAADI_API_KEY must not be empty"),
  PAADI_MCP_SCOPES: z.string().optional(),
  PAADI_PIN: z
    .string()
    .regex(/^\d{4}$/, "PAADI_PIN must be a 4-digit code")
    .optional(),
});

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  /** Raw comma-separated scope fallback from PAADI_MCP_SCOPES, if provided. */
  scopesEnv?: string;
  /** 4-digit PIN. Present only when PAADI_PIN is set; gates the money tools. */
  pin?: string;
}

/**
 * Parses and validates the environment. Throws an Error whose message lists
 * every offending variable so the operator can fix them in one pass.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid Paadi MCP configuration:\n${issues}`);
  }
  return {
    baseUrl: parsed.data.PAADI_BASE_URL,
    apiKey: parsed.data.PAADI_API_KEY,
    scopesEnv: parsed.data.PAADI_MCP_SCOPES,
    pin: parsed.data.PAADI_PIN,
  };
}
