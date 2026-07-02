import { createHmac, timingSafeEqual } from "node:crypto";

export function computeNombaSignature(signingString: string, secret: string): string {
  return createHmac("sha256", secret).update(signingString).digest("base64");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
