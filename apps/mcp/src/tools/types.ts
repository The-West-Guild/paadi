import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { PaadiClient } from "@paadi/api-client";
import type { ApiKeyScope } from "@paadi/contracts";
import type { z } from "zod";
import type { AppConfig } from "../config";
import type { ResolvedScopes } from "../scopes";

/** Reused wording so every kobo field carries the same unambiguous guidance. */
export const KOBO_HELP =
  "Amount in kobo (integer). ₦1 = 100 kobo — ₦2,500 = 250000. Never pass naira.";

/** Everything a tool handler needs to talk to the API and read config. */
export interface ToolDeps {
  client: PaadiClient;
  config: AppConfig;
  scopes: ResolvedScopes;
}

/**
 * Behavioural hints surfaced to the model. `openWorldHint` is always false —
 * every Paadi tool acts on the closed Paadi API, never the open web.
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint: false;
}

/**
 * A single MCP tool. `requiredScope` gates whether it appears in the catalog;
 * `needsPin` marks money-moving tools that only register when PAADI_PIN is set.
 * The handler runs the happy path — errors thrown from it are converted to
 * tool errors centrally by the server.
 */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  outputSchema?: z.ZodRawShape;
  annotations: ToolAnnotations;
  requiredScope?: ApiKeyScope;
  needsPin?: boolean;
  handler: (deps: ToolDeps, args: Record<string, unknown>) => Promise<CallToolResult>;
}
