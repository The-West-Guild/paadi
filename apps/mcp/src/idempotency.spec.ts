import { dedupeInFlight, mintIdempotencyKey } from "./idempotency";

describe("mintIdempotencyKey", () => {
  it("is invariant to argument order", () => {
    expect(mintIdempotencyKey("tool", { a: 1, b: 2 })).toBe(
      mintIdempotencyKey("tool", { b: 2, a: 1 })
    );
  });

  it("changes when the arguments change", () => {
    expect(mintIdempotencyKey("tool", { a: 1 })).not.toBe(
      mintIdempotencyKey("tool", { a: 2 })
    );
  });

  it("changes when the tool name changes", () => {
    expect(mintIdempotencyKey("tool_a", { a: 1 })).not.toBe(
      mintIdempotencyKey("tool_b", { a: 1 })
    );
  });

  it("changes when clientRef changes", () => {
    expect(mintIdempotencyKey("tool", { a: 1 }, "ref-1")).not.toBe(
      mintIdempotencyKey("tool", { a: 1 }, "ref-2")
    );
  });

  it("excludes the pin from the hash", () => {
    expect(mintIdempotencyKey("tool", { a: 1, pin: "1234" })).toBe(
      mintIdempotencyKey("tool", { a: 1 })
    );
  });

  it("ignores clientRef found inside args (only the parameter counts)", () => {
    expect(mintIdempotencyKey("tool", { a: 1, clientRef: "ref-1" }, "ref-1")).toBe(
      mintIdempotencyKey("tool", { a: 1 }, "ref-1")
    );
  });
});

describe("dedupeInFlight", () => {
  it("collapses concurrent calls with the same key into a single run", async () => {
    let calls = 0;
    let resolveRun!: (value: string) => void;
    const run = () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        resolveRun = resolve;
      });
    };

    const first = dedupeInFlight("key", run);
    const second = dedupeInFlight("key", run);

    expect(calls).toBe(1);
    expect(first).toBe(second);

    resolveRun("done");
    await expect(first).resolves.toBe("done");
    await expect(second).resolves.toBe("done");
  });

  it("clears the entry after resolve so a later call runs again", async () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      return Promise.resolve("value");
    };

    await dedupeInFlight("resolve-key", run);
    await dedupeInFlight("resolve-key", run);

    expect(calls).toBe(2);
  });

  it("clears the entry after reject so a later call runs again", async () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      return Promise.reject(new Error("boom"));
    };

    await expect(dedupeInFlight("reject-key", run)).rejects.toThrow("boom");
    await expect(dedupeInFlight("reject-key", run)).rejects.toThrow("boom");

    expect(calls).toBe(2);
  });
});
