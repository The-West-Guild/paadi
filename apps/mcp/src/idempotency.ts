import { requestHash } from "@paadi/domain";

/**
 * Derives a deterministic idempotency key for a money-moving tool call.
 *
 * The key is a hash of the tool name, the arguments (with `clientRef` and `pin`
 * stripped), and the caller's `clientRef`. Because it is deterministic, an agent
 * that retries the *same* call with the *same* arguments produces the *same*
 * key, so the API safely returns the prior result instead of moving money
 * twice. Changing the `clientRef` is the explicit way to repeat an action on
 * purpose. `pin` never contributes to the hash and never leaves this process.
 */
export function mintIdempotencyKey(
  toolName: string,
  args: Record<string, unknown>,
  clientRef?: string
): string {
  const rest = { ...args };
  delete rest.clientRef;
  delete rest.pin;
  return requestHash({
    method: "MCP",
    path: toolName,
    body: { args: rest, clientRef: clientRef ?? "" },
  });
}

/**
 * Collapses concurrent, identical in-flight calls. While a run for `key` is
 * pending, later callers with the same key attach to the same promise instead
 * of firing a second request. The entry is cleared once the run settles —
 * whether it resolves or rejects — so a later retry starts fresh.
 *
 * This guards against a burst of duplicate tool calls; it is not a retry loop
 * and adds no attempts of its own.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function dedupeInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = run().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}
