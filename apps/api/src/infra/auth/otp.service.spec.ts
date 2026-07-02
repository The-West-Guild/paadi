import { ConfigService } from "@nestjs/config";
import { OtpChannel, OtpProvider } from "@paadi/domain";
import { CryptoService } from "../../common/crypto/crypto.service";
import { redisKeys } from "../redis/redis.keys";
import { OtpService } from "./otp.service";

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    setex: jest.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return "OK" as const;
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    getdel: jest.fn(async (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    }),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    incr: jest.fn(async (key: string) => {
      const next = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: jest.fn(async () => 1),
    ttl: jest.fn(async () => 1)
  };
}

class CapturingOtpProvider extends OtpProvider {
  lastCode = "";

  send(_channel: OtpChannel, _target: string, code: string): Promise<{ reference: string }> {
    this.lastCode = code;
    return Promise.resolve({ reference: "ref-1" });
  }
}

function buildService() {
  const config = new ConfigService({ otp: { ttlSeconds: 300, maxAttempts: 3, resendSeconds: 60 } });
  const crypto = new CryptoService(new ConfigService({ nodeEnv: "test" }));
  const redis = fakeRedis();
  const provider = new CapturingOtpProvider();
  const service = new OtpService(redis as never, crypto, provider, config);
  return { service, redis, provider, crypto };
}

describe("OtpService", () => {
  it("issues a code that verifies once then fails on replay", async () => {
    const { service, provider } = buildService();
    const result = await service.issue("login", "+2348012345678", "sms");

    expect(result).toEqual({ expiresIn: 300, resendIn: 60 });
    expect(await service.verify("login", "+2348012345678", provider.lastCode)).toBe(true);
    expect(await service.verify("login", "+2348012345678", provider.lastCode)).toBe(false);
  });

  it("throws when a resend is requested too soon", async () => {
    const { service } = buildService();
    await service.issue("login", "+2348012345678", "sms");
    await expect(service.issue("login", "+2348012345678", "sms")).rejects.toMatchObject({ status: 429 });
  });

  it("increments attempts on a wrong code and deletes the stored otp after max attempts", async () => {
    const { service, redis, crypto } = buildService();
    jest.spyOn(crypto, "randomOtp").mockReturnValue("424242");
    await service.issue("login", "+2348012345678", "sms");
    const otpKey = redisKeys.otp("login", "+2348012345678");
    const attemptsKey = redisKeys.otpAttempts("login", "+2348012345678");

    expect(await service.verify("login", "+2348012345678", "000000")).toBe(false);
    expect(redis.store.get(attemptsKey)).toBe("1");
    expect(redis.store.has(otpKey)).toBe(true);

    expect(await service.verify("login", "+2348012345678", "111111")).toBe(false);
    expect(await service.verify("login", "+2348012345678", "222222")).toBe(false);

    expect(redis.store.has(otpKey)).toBe(false);
    expect(redis.store.has(attemptsKey)).toBe(false);
  });
});
