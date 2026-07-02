import { requestHash } from "./idempotency";
import { nextBackoffAt } from "../outbox/outbox";

describe("requestHash", () => {
  it("is stable when top-level object keys are reordered", () => {
    const a = requestHash({
      method: "POST",
      path: "/pots",
      body: { amountKobo: 5000, label: "rent" },
    });
    const b = requestHash({
      method: "POST",
      path: "/pots",
      body: { label: "rent", amountKobo: 5000 },
    });
    expect(a).toBe(b);
  });

  it("is stable when nested keys are reordered", () => {
    const a = requestHash({
      method: "POST",
      path: "/pots",
      body: { outer: { x: 1, y: 2 }, items: [{ a: 1, b: 2 }] },
    });
    const b = requestHash({
      method: "POST",
      path: "/pots",
      body: { items: [{ b: 2, a: 1 }], outer: { y: 2, x: 1 } },
    });
    expect(a).toBe(b);
  });

  it("normalizes the method to upper case", () => {
    expect(requestHash({ method: "post", path: "/pots", body: {} })).toBe(
      requestHash({ method: "POST", path: "/pots", body: {} }),
    );
  });

  it("differs when the body changes", () => {
    const a = requestHash({
      method: "POST",
      path: "/pots",
      body: { amountKobo: 5000 },
    });
    const b = requestHash({
      method: "POST",
      path: "/pots",
      body: { amountKobo: 5001 },
    });
    expect(a).not.toBe(b);
  });

  it("differs when the path changes", () => {
    const a = requestHash({ method: "POST", path: "/pots", body: {} });
    const b = requestHash({ method: "POST", path: "/pots/1/settle", body: {} });
    expect(a).not.toBe(b);
  });

  it("differs when the method changes", () => {
    const a = requestHash({ method: "POST", path: "/pots", body: {} });
    const b = requestHash({ method: "DELETE", path: "/pots", body: {} });
    expect(a).not.toBe(b);
  });

  it("returns a lower-case sha-256 hex digest", () => {
    expect(requestHash({ method: "GET", path: "/", body: null })).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});

describe("nextBackoffAt", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const delay = (attempts: number): number =>
    nextBackoffAt(attempts, now).getTime() - now.getTime();

  it("grows exponentially from the base delay", () => {
    expect(delay(0)).toBe(30_000);
    expect(delay(1)).toBe(60_000);
    expect(delay(2)).toBe(120_000);
    expect(delay(3)).toBe(240_000);
  });

  it("is monotonically non-decreasing in attempts", () => {
    let previous = -1;
    for (let attempts = 0; attempts <= 20; attempts += 1) {
      const current = delay(attempts);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it("is capped at one hour", () => {
    expect(delay(1000)).toBe(3_600_000);
    expect(delay(7)).toBe(3_600_000);
  });
});
