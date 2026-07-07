import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PaadiApiError } from "@paadi/api-client";
import { z, ZodError } from "zod";
import { toToolError } from "./errors";

function textOf(result: CallToolResult): string {
  const block = result.content[0] as { type: string; text: string };
  return block.text;
}

describe("toToolError", () => {
  it("always sets isError", () => {
    const result = toToolError(new Error("x"), { tool: "get_wallet" });
    expect(result.isError).toBe(true);
  });

  it("401 tells the agent to mint a new key", () => {
    const result = toToolError(new PaadiApiError({ message: "no" }, 401), {
      tool: "get_me",
    });
    expect(textOf(result)).toMatch(/rejected/i);
    expect(textOf(result)).toMatch(/mint a new key/i);
  });

  it("403 with a required scope names the scope", () => {
    const result = toToolError(new PaadiApiError({ message: "no" }, 403), {
      tool: "create_pot",
      requiredScope: "pots:write",
    });
    expect(textOf(result)).toContain("pots:write");
    expect(textOf(result)).toMatch(/scope/i);
  });

  it("403 without a required scope still guides re-issuing a key", () => {
    const result = toToolError(new PaadiApiError({ message: "no" }, 403), {
      tool: "create_pot",
    });
    expect(textOf(result)).toMatch(/scope/i);
    expect(textOf(result)).toMatch(/re-issue/i);
  });

  it("409 explains the clientRef reuse semantics", () => {
    const result = toToolError(new PaadiApiError({ message: "conflict" }, 409), {
      tool: "withdraw",
    });
    expect(textOf(result)).toContain("clientRef");
    expect(textOf(result)).toMatch(/same arguments/i);
  });

  it("400 with issues lists the field problems", () => {
    const err = new PaadiApiError(
      {
        statusCode: 400,
        message: "bad request",
        issues: [{ path: "amountKobo", message: "must be positive" }],
      },
      400
    );
    const result = toToolError(err, { tool: "withdraw" });
    expect(textOf(result)).toContain("amountKobo");
    expect(textOf(result)).toContain("must be positive");
  });

  it("ZodError lists the offending fields", () => {
    let zodError: ZodError | undefined;
    try {
      z.object({ amountKobo: z.number() }).parse({ amountKobo: "nope" });
    } catch (err) {
      zodError = err as ZodError;
    }
    const result = toToolError(zodError, { tool: "create_pot" });
    expect(textOf(result)).toMatch(/invalid input/i);
    expect(textOf(result)).toContain("amountKobo");
  });

  it("a non-API error becomes connectivity guidance", () => {
    const result = toToolError(new Error("ECONNREFUSED"), { tool: "get_wallet" });
    expect(textOf(result)).toContain("PAADI_BASE_URL");
    expect(textOf(result)).toContain("ECONNREFUSED");
  });
});
