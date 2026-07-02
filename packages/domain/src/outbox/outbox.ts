import { PaadiEvent } from "@paadi/contracts";

export interface OutboxMessage {
  id: string;
  target: string;
  event: PaadiEvent;
  attempts: number;
  nextAttemptAt?: string;
  status?: "pending" | "dispatched" | "failed";
}

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 3_600_000;

export function nextBackoffAt(attempts: number, now: Date): Date {
  const exponent = Math.max(0, Math.trunc(attempts));
  const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** exponent);
  return new Date(now.getTime() + delay);
}
