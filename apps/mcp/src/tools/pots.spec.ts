import type { PaadiClient } from "@paadi/api-client";
import { ZodError } from "zod";
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

const config: AppConfig = {
  baseUrl: "http://localhost:3001",
  apiKey: "pk_test_key",
};

function findTool(name: string): ToolDef {
  const tool = allTools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

const validPot = {
  title: "Rent for the flat",
  totalKobo: 500000,
  settlementType: "wallet",
  completionRule: "progressive",
  splitMode: "weight",
  splits: [
    { label: "Ada", weight: 1 },
    { label: "Bola", weight: 1 },
  ],
};

describe("create_pot", () => {
  it("rejects invalid input via the full schema before calling the client", async () => {
    const createPot = jest.fn();
    const deps: ToolDeps = {
      client: { createPot } as unknown as PaadiClient,
      config,
      scopes,
    };

    await expect(
      findTool("create_pot").handler(deps, { title: "ab" })
    ).rejects.toBeInstanceOf(ZodError);
    expect(createPot).not.toHaveBeenCalled();
  });

  it("passes validated input (with defaults applied, clientRef stripped) and a minted key", async () => {
    const createPot = jest.fn().mockResolvedValue({ id: "pot-9" });
    const deps: ToolDeps = {
      client: { createPot } as unknown as PaadiClient,
      config,
      scopes,
    };

    await findTool("create_pot").handler(deps, { ...validPot, clientRef: "ref-1" });

    expect(createPot).toHaveBeenCalledTimes(1);
    const [input, key] = createPot.mock.calls[0];
    expect(input.title).toBe(validPot.title);
    expect(input.attributionMode).toBe("checkout_link");
    expect(input).not.toHaveProperty("clientRef");
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });
});

describe("list_pots", () => {
  it("passes pagination and status straight through to the client", async () => {
    const listPots = jest
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null });
    const deps: ToolDeps = {
      client: { listPots } as unknown as PaadiClient,
      config,
      scopes,
    };

    await findTool("list_pots").handler(deps, {
      cursor: "cursor-1",
      limit: 25,
      status: "open",
    });

    expect(listPots).toHaveBeenCalledWith({
      cursor: "cursor-1",
      limit: 25,
      status: "open",
    });
  });
});
