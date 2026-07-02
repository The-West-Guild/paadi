import { ConfigService } from "@nestjs/config";
import { CryptoService } from "./crypto.service";

describe("CryptoService", () => {
  const crypto = new CryptoService(new ConfigService({ nodeEnv: "test" }));

  it("round-trips phone encryption without leaking plaintext", () => {
    const phone = "+2348012345678";
    const encrypted = crypto.encryptPhone(phone);
    expect(encrypted).not.toContain(phone);
    expect(crypto.decryptPhone(encrypted)).toBe(phone);
  });

  it("produces a deterministic blind index", () => {
    expect(crypto.phoneBlindIndex("+2348012345678")).toBe(crypto.phoneBlindIndex("+2348012345678"));
    expect(crypto.phoneBlindIndex("+2348012345678")).not.toBe(crypto.phoneBlindIndex("+2348000000000"));
  });

  it("generates a six-digit otp and hashes it irreversibly", () => {
    const code = crypto.randomOtp();
    expect(code).toMatch(/^\d{6}$/);
    expect(crypto.hashOtp(code)).not.toBe(code);
    expect(crypto.hashOtp(code)).toBe(crypto.hashOtp(code));
  });

  it("hashes and verifies a secret with argon2", async () => {
    const hash = await crypto.hashSecret("correct horse battery staple");
    expect(await crypto.verifySecret(hash, "correct horse battery staple")).toBe(true);
    expect(await crypto.verifySecret(hash, "wrong")).toBe(false);
  });
});
