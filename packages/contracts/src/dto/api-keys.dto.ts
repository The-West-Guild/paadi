import { z } from "zod";

export const API_KEY_SCOPES = [
  "pots:read",
  "pots:write",
  "wallet:read",
  "wallet:pay",
  "wallet:withdraw",
  "bills:read",
  "profile:read",
  "activity:read",
  "webhooks:manage"
] as const;

export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);

export const mintApiKeySchema = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(apiKeyScopeSchema).min(1),
  expiresAt: z.string().datetime().optional()
});

export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const apiKeyCreatedSchema = apiKeySchema.extend({
  key: z.string()
});

export const apiKeysResponseSchema = z.object({
  keys: z.array(apiKeySchema)
});

export const apiKeyParamsSchema = z.object({
  id: z.string().uuid()
});

export const apiKeyCurrentSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  mode: z.enum(["live", "test"]),
  scopes: z.array(z.string())
});

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export type MintApiKeyInput = z.infer<typeof mintApiKeySchema>;
export type ApiKeyDto = z.infer<typeof apiKeySchema>;
export type ApiKeyCreatedDto = z.infer<typeof apiKeyCreatedSchema>;
export type ApiKeysResponse = z.infer<typeof apiKeysResponseSchema>;
export type ApiKeyParams = z.infer<typeof apiKeyParamsSchema>;
export type ApiKeyCurrentDto = z.infer<typeof apiKeyCurrentSchema>;
