import type { PaadiClient } from "@paadi/api-client";
import type { AppConfig } from "../config";
import type { ResolvedScopes } from "../scopes";
import { allTools } from "./registry";
import type { ToolDef, ToolDeps } from "./types";

const scopes: ResolvedScopes = {
  known: true,
  source: "api",
  scopes: [],
  has: () => true,
  describe: () => "",
};

function findTool(name: string): ToolDef {
  const tool = allTools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

function textOf(result: Awaited<ReturnType<ToolDef["handler"]>>): string {
  const block = result.content[0] as { type: string; text: string };
  return block.text;
}

describe("pay_split_from_wallet", () => {
  const config: AppConfig = {
    baseUrl: "http://localhost:3001",
    apiKey: "pk_test_key",
    pin: "1234",
  };

  it("merges the config PIN into the body, passes the minted key as the 2nd arg, and never leaks the PIN", async () => {
    const potDetail = { id: "pot-1", title: "Rent" };
    const payFromWallet = jest.fn().mockResolvedValue(potDetail);
    const client = { payFromWallet } as unknown as PaadiClient;
    const deps: ToolDeps = { client, config, scopes };

    const args = {
      potId: "11111111-1111-1111-1111-111111111111",
      splitId: "22222222-2222-2222-2222-222222222222",
      amountKobo: 250000,
    };

    const result = await findTool("pay_split_from_wallet").handler(deps, args);

    expect(payFromWallet).toHaveBeenCalledTimes(1);
    const [body, key] = payFromWallet.mock.calls[0];
    expect(body).toEqual({
      potId: args.potId,
      splitId: args.splitId,
      amountKobo: 250000,
      pin: "1234",
    });
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);

    const text = textOf(result);
    expect(text).not.toContain("1234");
    expect(text).toContain("pot-1");
  });

  it("omits amountKobo from the body when not supplied", async () => {
    const payFromWallet = jest.fn().mockResolvedValue({ id: "pot-2" });
    const client = { payFromWallet } as unknown as PaadiClient;
    const deps: ToolDeps = { client, config, scopes };

    await findTool("pay_split_from_wallet").handler(deps, {
      potId: "11111111-1111-1111-1111-111111111111",
      splitId: "22222222-2222-2222-2222-222222222222",
    });

    const [body] = payFromWallet.mock.calls[0];
    expect(body).not.toHaveProperty("amountKobo");
    expect(body.pin).toBe("1234");
  });
});

describe("withdraw", () => {
  const config: AppConfig = {
    baseUrl: "http://localhost:3001",
    apiKey: "pk_test_key",
    pin: "4321",
  };

  it("merges the PIN, passes the minted key, and returns a PIN-free result", async () => {
    const withdrawal = { id: "wd-1", status: "pending" };
    const withdraw = jest.fn().mockResolvedValue(withdrawal);
    const client = { withdraw } as unknown as PaadiClient;
    const deps: ToolDeps = { client, config, scopes };

    const result = await findTool("withdraw").handler(deps, {
      amountKobo: 500000,
      payoutAccountId: "33333333-3333-3333-3333-333333333333",
    });

    const [body, key] = withdraw.mock.calls[0];
    expect(body).toEqual({
      amountKobo: 500000,
      payoutAccountId: "33333333-3333-3333-3333-333333333333",
      pin: "4321",
    });
    expect(typeof key).toBe("string");
    expect(textOf(result)).not.toContain("4321");
  });
});
