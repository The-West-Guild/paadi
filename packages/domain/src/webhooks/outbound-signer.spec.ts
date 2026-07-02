import { createHmac } from "node:crypto";
import {
  OutboundDeliveryPayload,
  buildOutboundSigningString,
  signPayload
} from "./outbound-signer";

const SECRET = "whsec_test_0123456789abcdef";

function samplePayload(overrides: Partial<OutboundDeliveryPayload> = {}): OutboundDeliveryPayload {
  return {
    id: overrides.id ?? "evt-1",
    type: overrides.type ?? "wallet.credited",
    createdAt: overrides.createdAt ?? "2026-07-01T10:00:00.000Z",
    data: overrides.data ?? {
      userId: "user-1",
      amountKobo: 500000,
      nombaTransactionId: "ntx-1"
    }
  };
}

function receiverVerify(
  secret: string,
  payload: OutboundDeliveryPayload,
  timestamp: string,
  provided: string
): boolean {
  const signingString = buildOutboundSigningString(payload, timestamp);
  const expected = createHmac("sha256", secret).update(signingString).digest("base64");
  return expected === provided;
}

describe("outbound-signer", () => {
  const timestamp = "2026-07-01T10:00:01.000Z";

  it("is deterministic: same secret, payload, and timestamp yield the same signature", () => {
    const payload = samplePayload();
    expect(signPayload(SECRET, payload, timestamp)).toBe(signPayload(SECRET, payload, timestamp));
  });

  it("produces a base64 HMAC-SHA256 a receiver can recompute with the shared secret", () => {
    const payload = samplePayload();
    const signature = signPayload(SECRET, payload, timestamp);

    expect(receiverVerify(SECRET, payload, timestamp, signature)).toBe(true);
  });

  it("mirrors the inbound scheme: the signing string joins id:type:createdAt:canonical(data):timestamp", () => {
    const payload = samplePayload();
    const signingString = buildOutboundSigningString(payload, timestamp);

    expect(signingString.startsWith(`${payload.id}:${payload.type}:${payload.createdAt}:`)).toBe(true);
    expect(signingString.endsWith(`:${timestamp}`)).toBe(true);
    expect(signPayload(SECRET, payload, timestamp)).toBe(
      createHmac("sha256", SECRET).update(signingString).digest("base64")
    );
  });

  it("canonicalizes data by sorted keys so field ordering does not change the signature", () => {
    const ordered = samplePayload({
      data: { userId: "user-1", amountKobo: 500000, nombaTransactionId: "ntx-1" }
    });
    const shuffled = samplePayload({
      data: { nombaTransactionId: "ntx-1", amountKobo: 500000, userId: "user-1" }
    });

    expect(signPayload(SECRET, shuffled, timestamp)).toBe(signPayload(SECRET, ordered, timestamp));
  });

  it("fails verification when the body is tampered after signing", () => {
    const payload = samplePayload();
    const signature = signPayload(SECRET, payload, timestamp);
    const tampered = samplePayload({
      data: { userId: "user-1", amountKobo: 999999, nombaTransactionId: "ntx-1" }
    });

    expect(receiverVerify(SECRET, tampered, timestamp, signature)).toBe(false);
  });

  it("fails verification when a single byte of the signature is flipped", () => {
    const payload = samplePayload();
    const signature = signPayload(SECRET, payload, timestamp);
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    expect(flipped).not.toBe(signature);
    expect(receiverVerify(SECRET, payload, timestamp, flipped)).toBe(false);
  });

  it("fails verification when the timestamp differs from the one that was signed", () => {
    const payload = samplePayload();
    const signature = signPayload(SECRET, payload, timestamp);

    expect(receiverVerify(SECRET, payload, "2026-07-01T10:00:02.000Z", signature)).toBe(false);
  });

  it("fails verification when the receiver uses the wrong secret", () => {
    const payload = samplePayload();
    const signature = signPayload(SECRET, payload, timestamp);

    expect(receiverVerify("whsec_wrong_secret", payload, timestamp, signature)).toBe(false);
  });

  it("changes the signature when the delivery id changes so replays are distinguishable", () => {
    const first = signPayload(SECRET, samplePayload({ id: "evt-1" }), timestamp);
    const second = signPayload(SECRET, samplePayload({ id: "evt-2" }), timestamp);

    expect(first).not.toBe(second);
  });
});
