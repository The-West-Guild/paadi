import type { PaadiClient } from "@paadi/api-client";
import type { AppConfig } from "./config";
import { discoverScopes } from "./scopes";

const baseConfig: AppConfig = {
  baseUrl: "http://localhost:3001",
  apiKey: "pk_test_key",
};

function clientWith(getCurrentApiKey: jest.Mock): PaadiClient {
  return { getCurrentApiKey } as unknown as PaadiClient;
}

describe("discoverScopes", () => {
  it("uses scopes from a successful key probe", async () => {
    const client = clientWith(
      jest.fn().mockResolvedValue({
        id: "1",
        name: "cli",
        prefix: "pk_test_abcd",
        mode: "test",
        scopes: ["pots:read", "wallet:read"],
      })
    );

    const resolved = await discoverScopes(client, baseConfig);

    expect(resolved.known).toBe(true);
    expect(resolved.source).toBe("api");
    expect(resolved.has("pots:read")).toBe(true);
    expect(resolved.has("wallet:withdraw")).toBe(false);
    expect(resolved.describe()).toContain("pk_test_abcd");
  });

  it("falls back to PAADI_MCP_SCOPES when the probe fails, ignoring unknown scopes", async () => {
    const client = clientWith(jest.fn().mockRejectedValue(new Error("404")));

    const resolved = await discoverScopes(client, {
      ...baseConfig,
      scopesEnv: "pots:read, wallet:pay , not-a-scope",
    });

    expect(resolved.source).toBe("env");
    expect(resolved.known).toBe(true);
    expect(resolved.has("pots:read")).toBe(true);
    expect(resolved.has("wallet:pay")).toBe(true);
    expect(resolved.has("bills:read")).toBe(false);
    expect(resolved.scopes).not.toContain("not-a-scope");
    expect(resolved.describe()).toContain("PAADI_MCP_SCOPES");
  });

  it("runs permissively when the probe fails and no env scopes are set", async () => {
    const client = clientWith(jest.fn().mockRejectedValue(new Error("network")));

    const resolved = await discoverScopes(client, baseConfig);

    expect(resolved.known).toBe(false);
    expect(resolved.source).toBe("unknown");
    expect(resolved.has("wallet:withdraw")).toBe(true);
    expect(resolved.describe()).toMatch(/all tools/i);
  });
});
