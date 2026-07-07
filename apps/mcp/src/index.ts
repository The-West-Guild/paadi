import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@paadi/api-client";
import { type AppConfig, loadConfig } from "./config";
import { discoverScopes } from "./scopes";
import { buildServer } from "./server";

/**
 * Paadi MCP server entry point. stdout is reserved for the MCP protocol — every
 * diagnostic goes to stderr via console.error, never console.log.
 */
async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const client = createClient({ baseUrl: config.baseUrl, token: config.apiKey });
  const scopes = await discoverScopes(client, config);
  console.error(`[paadi-mcp] ${scopes.describe()}`);

  const server = buildServer({ client, scopes, config });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[paadi-mcp] ready — serving Paadi tools over stdio (base ${config.baseUrl})`);
}

main().catch((err) => {
  console.error("[paadi-mcp] fatal:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
