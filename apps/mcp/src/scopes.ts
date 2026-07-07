import type { PaadiClient } from "@paadi/api-client";
import { API_KEY_SCOPES, type ApiKeyScope } from "@paadi/contracts";
import type { AppConfig } from "./config";

/**
 * The set of scopes the running key is understood to hold. `has()` is what the
 * server uses to gate the tool catalog; the API is always the real authority.
 */
export interface ResolvedScopes {
  /** True when scopes were determined (from the API probe or PAADI_MCP_SCOPES). */
  known: boolean;
  /** Where the scope set came from. */
  source: "api" | "env" | "unknown";
  /** The resolved scopes. Empty when running permissively (source "unknown"). */
  scopes: ApiKeyScope[];
  has: (scope: ApiKeyScope) => boolean;
  /** One-line human summary for the startup stderr log. */
  describe: () => string;
}

function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

/**
 * Determines which scopes the configured key holds so the catalog can be gated
 * before any tool is called.
 *
 *  1. Ask the API (`GET /me/api-keys/current`). This is authoritative.
 *  2. If that fails for any reason, fall back to PAADI_MCP_SCOPES when set.
 *  3. Otherwise run permissively — expose every tool and let the API reject
 *     anything the key is not allowed to do.
 */
export async function discoverScopes(
  client: PaadiClient,
  config: AppConfig
): Promise<ResolvedScopes> {
  try {
    const current = await client.getCurrentApiKey();
    const scopes = current.scopes.filter(isApiKeyScope);
    return {
      known: true,
      source: "api",
      scopes,
      has: (scope) => scopes.includes(scope),
      describe: () =>
        `scopes resolved from key ${current.prefix} (${current.mode}): ${
          scopes.join(", ") || "none"
        }`,
    };
  } catch {
    const declared = config.scopesEnv?.trim();
    if (declared) {
      const scopes = declared
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter(isApiKeyScope);
      return {
        known: true,
        source: "env",
        scopes,
        has: (scope) => scopes.includes(scope),
        describe: () =>
          `scopes from PAADI_MCP_SCOPES (key probe unavailable): ${
            scopes.join(", ") || "none"
          }`,
      };
    }
    return {
      known: false,
      source: "unknown",
      scopes: [],
      has: () => true,
      describe: () =>
        "scopes unknown (key probe unavailable, no PAADI_MCP_SCOPES) — exposing all tools; the API still enforces the key's real scopes",
    };
  }
}
