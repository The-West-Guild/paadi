import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { PaadiClient } from "@paadi/api-client";
import type { AppConfig } from "./config";
import type { ResolvedScopes } from "./scopes";
import { buildServer, type BuildServerDeps } from "./server";

function scopesWith(has: (scope: string) => boolean): ResolvedScopes {
  return {
    known: true,
    source: "api",
    scopes: [],
    has: (scope) => has(scope),
    describe: () => "",
  };
}

async function connect(deps: BuildServerDeps) {
  const server = buildServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

const baseConfig: AppConfig = {
  baseUrl: "http://localhost:3001",
  apiKey: "pk_test_key",
};

const emptyClient = {} as unknown as PaadiClient;

describe("buildServer", () => {
  it("exposes tools for held scopes and hides tools whose scope is absent", async () => {
    const { client, close } = await connect({
      client: emptyClient,
      config: baseConfig,
      scopes: scopesWith((scope) => scope === "pots:read"),
    });

    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("get_pot");
    expect(names).toContain("list_pots");
    expect(names).not.toContain("get_wallet");
    expect(names).not.toContain("create_pot");
    // public tool needs no scope
    expect(names).toContain("get_payer_view");

    await close();
  });

  it("hides money tools without a PIN and shows them once a PIN is configured", async () => {
    const permissive = scopesWith(() => true);

    const withoutPin = await connect({
      client: emptyClient,
      config: baseConfig,
      scopes: permissive,
    });
    const withoutPinNames = (await withoutPin.client.listTools()).tools.map(
      (tool) => tool.name
    );
    expect(withoutPinNames).not.toContain("pay_split_from_wallet");
    expect(withoutPinNames).not.toContain("withdraw");
    await withoutPin.close();

    const withPin = await connect({
      client: emptyClient,
      config: { ...baseConfig, pin: "1234" },
      scopes: permissive,
    });
    const withPinNames = (await withPin.client.listTools()).tools.map(
      (tool) => tool.name
    );
    expect(withPinNames).toContain("pay_split_from_wallet");
    expect(withPinNames).toContain("withdraw");
    await withPin.close();
  });

  it("round-trips a list_pots call to the mocked API client", async () => {
    const listPots = jest
      .fn()
      .mockResolvedValue({ items: [{ id: "p1" }], nextCursor: null });
    const { client, close } = await connect({
      client: { listPots } as unknown as PaadiClient,
      config: baseConfig,
      scopes: scopesWith((scope) => scope === "pots:read"),
    });

    const result = await client.callTool({
      name: "list_pots",
      arguments: { limit: 5 },
    });

    expect(listPots).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 5,
      status: undefined,
    });
    const content = result.content as { type: string; text: string }[];
    expect(content[0].text).toContain("p1");

    await close();
  });
});
