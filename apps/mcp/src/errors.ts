import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PaadiApiError } from "@paadi/api-client";
import type { ApiKeyScope } from "@paadi/contracts";
import { ZodError } from "zod";

export interface ToolErrorContext {
  tool: string;
  requiredScope?: ApiKeyScope;
}

/**
 * Turns any thrown error into an MCP tool error result carrying an actionable,
 * agent-readable message. The guidance is phrased so the model can recover on
 * its own — mint a new key, add a scope, retry with the same arguments, etc.
 */
export function toToolError(
  err: unknown,
  { tool, requiredScope }: ToolErrorContext
): CallToolResult {
  return { isError: true, content: [{ type: "text", text: buildMessage(err, tool, requiredScope) }] };
}

function buildMessage(
  err: unknown,
  tool: string,
  requiredScope?: ApiKeyScope
): string {
  if (err instanceof ZodError) {
    return `${tool}: invalid input — ${formatIssues(
      err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    )}`;
  }

  if (err instanceof PaadiApiError) {
    switch (err.statusCode) {
      case 401:
        return `${tool}: the API key was rejected (invalid, expired, or revoked). Mint a new key with POST /me/api-keys and set it as PAADI_API_KEY.`;
      case 403:
        return requiredScope
          ? `${tool}: the API key lacks the '${requiredScope}' scope. Re-issue a key that includes '${requiredScope}'.`
          : `${tool}: the API key lacks a required scope for this action. Re-issue a key with the missing scope.`;
      case 409:
        return `${tool}: idempotency conflict — this clientRef was already used with different arguments. Retry with the exact same arguments to fetch the earlier result, or pass a new clientRef to repeat the action on purpose.`;
      default:
        if (err.issues?.length) {
          return `${tool}: the request was rejected — ${formatIssues(err.issues)}`;
        }
        return `${tool}: the request failed (HTTP ${
          err.statusCode ?? "unknown"
        }) — ${err.message}`;
    }
  }

  const detail = err instanceof Error ? err.message : String(err);
  return `${tool}: could not reach the Paadi API. Check that the server is running and that PAADI_BASE_URL points at it. (${detail})`;
}

function formatIssues(issues: { path: string; message: string }[]): string {
  return issues
    .map(({ path, message }) => `${path || "(root)"}: ${message}`)
    .join("; ");
}
