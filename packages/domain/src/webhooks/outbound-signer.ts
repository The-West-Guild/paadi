import { createHmac } from "node:crypto";

export interface OutboundDeliveryPayload {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

export function buildOutboundSigningString(payload: OutboundDeliveryPayload, timestamp: string): string {
  return [payload.id, payload.type, payload.createdAt, canonicalize(payload.data), timestamp].join(":");
}

export function signPayload(secret: string, payload: OutboundDeliveryPayload, timestamp: string): string {
  const signingString = buildOutboundSigningString(payload, timestamp);
  return createHmac("sha256", secret).update(signingString).digest("base64");
}
