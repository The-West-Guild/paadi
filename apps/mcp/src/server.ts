import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaadiClient } from "@paadi/api-client";
import type { AppConfig } from "./config";
import { toToolError } from "./errors";
import type { ResolvedScopes } from "./scopes";
import { allTools } from "./tools/registry";
import type { ToolDeps } from "./tools/types";

/** High-level orientation handed to the model when it connects. */
const PAADI_INSTRUCTIONS = [
  "Paadi turns a shared bill into a pot: one target amount split across contributors.",
  "A pot has splits, each assigned to a contributor with a share of the total.",
  "Contributors pay their share two ways: a checkout link (use get_payer_view with a split's pay token) or, for the account holder, straight from the wallet (pay_split_from_wallet).",
  "When a pot is funded, it settles automatically to its target: a bank payout, an electricity/cable bill (vended with a token), or a wallet credit.",
  "Settlement and withdrawals are asynchronous — after triggering them, poll get_pot_settlement or get_withdrawal until status is completed or failed.",
  "To build a bill_payment pot, first look up the biller: list_electricity_providers / list_cable_providers, then the matching lookup tool to confirm the customer name.",
  "ALL money is integer kobo. ₦1 = 100 kobo, so ₦2,500 = 250000. Never pass naira.",
  "Read tools need only a read scope; creating pots, paying, and withdrawing need write/pay/withdraw scopes and (for money) a configured PIN.",
  "Money tools are idempotent: reuse the same clientRef with identical arguments to retry safely; change it to intentionally repeat an action.",
].join("\n");

export interface BuildServerDeps {
  client: PaadiClient;
  scopes: ResolvedScopes;
  config: AppConfig;
}

/**
 * Builds the MCP server, registering only the tools the current key and config
 * permit: a tool is skipped when its required scope is known-absent, or when it
 * moves money but no PIN is configured. Skipped money tools are logged once so
 * the operator understands why they are missing.
 */
export function buildServer({ client, scopes, config }: BuildServerDeps): McpServer {
  const server = new McpServer(
    { name: "paadi", version: "0.1.0" },
    { instructions: PAADI_INSTRUCTIONS }
  );

  const deps: ToolDeps = { client, config, scopes };
  const skippedForPin: string[] = [];

  for (const tool of allTools) {
    if (tool.requiredScope && !scopes.has(tool.requiredScope)) continue;
    if (tool.needsPin && !config.pin) {
      skippedForPin.push(tool.name);
      continue;
    }

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
        try {
          return await tool.handler(deps, args ?? {});
        } catch (err) {
          return toToolError(err, { tool: tool.name, requiredScope: tool.requiredScope });
        }
      }
    );
  }

  if (skippedForPin.length > 0) {
    console.error(
      `[paadi-mcp] money tools disabled (set PAADI_PIN to enable): ${skippedForPin.join(", ")}`
    );
  }

  return server;
}
