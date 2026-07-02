import { parsePhoneNumberFromString } from "libphonenumber-js";
import { normalizeUsername } from "../username/username.util";

export type ResolvedIdentifier =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string }
  | { kind: "username"; value: string };

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function classifyIdentifier(raw: string): ResolvedIdentifier {
  const trimmed = raw.trim();
  const lowered = trimmed.toLowerCase();
  if (EMAIL_PATTERN.test(lowered)) {
    return { kind: "email", value: lowered };
  }
  const candidate = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const parsed = parsePhoneNumberFromString(candidate, "NG");
  if (parsed && parsed.isValid()) {
    return { kind: "phone", value: parsed.number };
  }
  return { kind: "username", value: normalizeUsername(candidate) };
}
