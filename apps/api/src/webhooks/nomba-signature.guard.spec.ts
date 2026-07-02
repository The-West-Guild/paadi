import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { buildSignedNombaWebhook } from "../integrations/nomba/dev/sign-nomba-webhook";
import { NombaSignatureGuard } from "./nomba-signature.guard";

const SIGNING_KEY = "local-test-signing-key";
const TIMESTAMP = "2026-06-28T10:00:00Z";

function samplePayload(responseCode?: string) {
  return {
    event_type: "payment_success",
    requestId: "req-123",
    data: {
      merchant: { userId: "user-1", walletId: "wallet-1" },
      transaction: {
        transactionId: "txn-1",
        type: "card",
        time: "2026-06-28T09:59:00Z",
        ...(responseCode === undefined ? {} : { responseCode })
      }
    }
  };
}

function contextFor(headers: Record<string, string | undefined>, rawBody?: Buffer): ExecutionContext {
  const request = { headers, rawBody };
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
}

function buildGuard(signingKey = SIGNING_KEY) {
  const config = new ConfigService({ nomba: { webhookSigningKey: signingKey } });
  return new NombaSignatureGuard(config);
}

describe("NombaSignatureGuard", () => {
  it("accepts a payload signed by buildSignedNombaWebhook (round-trip)", () => {
    const signed = buildSignedNombaWebhook(samplePayload("00"), TIMESTAMP, SIGNING_KEY);
    const context = contextFor(
      { "nomba-signature": signed.signature, "nomba-timestamp": TIMESTAMP },
      Buffer.from(signed.body, "utf8")
    );

    expect(buildGuard().canActivate(context)).toBe(true);
  });

  it("rejects a tampered body with 401", () => {
    const signed = buildSignedNombaWebhook(samplePayload("00"), TIMESTAMP, SIGNING_KEY);
    const tampered = Buffer.from(signed.body.replace("user-1", "user-2"), "utf8");
    const context = contextFor({ "nomba-signature": signed.signature, "nomba-timestamp": TIMESTAMP }, tampered);

    expect(() => buildGuard().canActivate(context)).toThrow(UnauthorizedException);
  });

  it("compares the signature case-insensitively", () => {
    const signed = buildSignedNombaWebhook(samplePayload("00"), TIMESTAMP, SIGNING_KEY);
    const context = contextFor(
      { "nomba-signature": signed.signature.toUpperCase(), "nomba-timestamp": TIMESTAMP },
      Buffer.from(signed.body, "utf8")
    );

    expect(buildGuard().canActivate(context)).toBe(true);
  });

  it("rejects an empty signature with 401", () => {
    const signed = buildSignedNombaWebhook(samplePayload("00"), TIMESTAMP, SIGNING_KEY);
    const context = contextFor(
      { "nomba-signature": "", "nomba-timestamp": TIMESTAMP },
      Buffer.from(signed.body, "utf8")
    );

    expect(() => buildGuard().canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects a missing signature header with 401", () => {
    const signed = buildSignedNombaWebhook(samplePayload("00"), TIMESTAMP, SIGNING_KEY);
    const context = contextFor({ "nomba-timestamp": TIMESTAMP }, Buffer.from(signed.body, "utf8"));

    expect(() => buildGuard().canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects a missing timestamp header with 401", () => {
    const signed = buildSignedNombaWebhook(samplePayload("00"), TIMESTAMP, SIGNING_KEY);
    const context = contextFor({ "nomba-signature": signed.signature }, Buffer.from(signed.body, "utf8"));

    expect(() => buildGuard().canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects every webhook when the signing key is unconfigured", () => {
    const signed = buildSignedNombaWebhook(samplePayload("00"), TIMESTAMP, SIGNING_KEY);
    const context = contextFor(
      { "nomba-signature": signed.signature, "nomba-timestamp": TIMESTAMP },
      Buffer.from(signed.body, "utf8")
    );

    expect(() => buildGuard("").canActivate(context)).toThrow(UnauthorizedException);
  });

  it("treats a literal responseCode of null and an absent responseCode identically", () => {
    const withNull = buildSignedNombaWebhook(samplePayload("null"), TIMESTAMP, SIGNING_KEY);
    const withAbsent = buildSignedNombaWebhook(samplePayload(undefined), TIMESTAMP, SIGNING_KEY);

    expect(withNull.signature).toBe(withAbsent.signature);

    const context = contextFor(
      { "nomba-signature": withNull.signature, "nomba-timestamp": TIMESTAMP },
      Buffer.from(withNull.body, "utf8")
    );
    expect(buildGuard().canActivate(context)).toBe(true);
  });
});
