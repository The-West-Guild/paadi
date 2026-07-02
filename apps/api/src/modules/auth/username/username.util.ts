export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const RESERVED: Set<string> = new Set([
  "admin",
  "root",
  "support",
  "staff",
  "official",
  "help",
  "billing",
  "refunds",
  "security",
  "nomba",
  "paadi",
  "api",
  "www",
  "app",
  "login",
  "logout",
  "settings",
  "me",
  "pot",
  "pots",
  "pay",
  "checkout",
  "webhooks",
  "transfers",
  "postmaster",
  "abuse"
]);

const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;

interface UsernameValidation {
  ok: boolean;
  normalized: string;
  reason?: string;
}

export function validateUsername(raw: string): UsernameValidation {
  const normalized = normalizeUsername(raw);
  if (!USERNAME_PATTERN.test(normalized)) {
    return { ok: false, normalized, reason: "invalid format" };
  }
  if (/^[._]|[._]$/.test(normalized)) {
    return { ok: false, normalized, reason: "cannot start or end with . or _" };
  }
  if (/[._]{2}/.test(normalized)) {
    return { ok: false, normalized, reason: "no consecutive . or _" };
  }
  if (RESERVED.has(normalized)) {
    return { ok: false, normalized, reason: "reserved" };
  }
  return { ok: true, normalized };
}
