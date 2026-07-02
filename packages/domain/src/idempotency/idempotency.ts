import { createHash } from "node:crypto";

export interface IdempotencyRecord {
  key: string;
  scope: string;
  requestHash: string;
  response?: unknown;
}

export function idempotencyKey(scope: string, key: string): string {
  return `${scope}:${key}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`);
  return `{${entries.join(",")}}`;
}

export function requestHash(input: {
  method: string;
  path: string;
  body: unknown;
}): string {
  const canonical = `${input.method.toUpperCase()} ${input.path} ${stableStringify(input.body)}`;
  return createHash("sha256").update(canonical).digest("hex");
}
