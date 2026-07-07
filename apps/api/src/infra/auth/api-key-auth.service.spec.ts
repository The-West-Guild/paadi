import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiKey } from "@paadi/db";
import { createHash } from "node:crypto";
import { CryptoService } from "../../common/crypto/crypto.service";
import { ApiKeyRepository } from "../persistence/api-key.repository";
import { UserRepository } from "../persistence/user.repository";
import { RedisService } from "../redis/redis.service";
import { ApiKeyAuthService } from "./api-key-auth.service";

const TOKEN = "pk_test_secret-token";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeKeyRow(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: overrides.id ?? "key-1",
    userId: overrides.userId ?? "user-1",
    name: overrides.name ?? "test key",
    prefix: overrides.prefix ?? "pk_test_secr",
    keyHash: overrides.keyHash ?? sha256(TOKEN),
    scopes: overrides.scopes ?? ["pots:read"],
    lastUsedAt: overrides.lastUsedAt ?? null,
    expiresAt: "expiresAt" in overrides ? (overrides.expiresAt ?? null) : null,
    revokedAt: "revokedAt" in overrides ? (overrides.revokedAt ?? null) : null,
    createdAt: overrides.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-07-01T00:00:00.000Z")
  } as ApiKey;
}

interface BuildOptions {
  key?: ApiKey | null;
  user?: { id: string; tier: string; status: string } | null;
  cached?: string | null;
}

function build(options: BuildOptions = {}) {
  const store = new Map<string, string>();
  if (options.cached) {
    store.set(`apikey:principal:${sha256(TOKEN)}`, options.cached);
  }
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    setex: jest.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    })
  } as unknown as RedisService;

  const keys = {
    findByHash: jest.fn(async () => ("key" in options ? options.key : makeKeyRow())),
    touchLastUsed: jest.fn(async () => undefined)
  } as unknown as ApiKeyRepository;

  const users = {
    findById: jest.fn(async () =>
      "user" in options ? options.user : { id: "user-1", tier: "TIER_1", status: "ACTIVE" }
    )
  } as unknown as UserRepository;

  const crypto = { sha256 } as unknown as CryptoService;
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

  const service = new ApiKeyAuthService(keys, users, crypto, redis, config);
  return { service, keys, users, redis, store };
}

describe("ApiKeyAuthService.verify", () => {
  it("resolves a valid key to an apikey principal acting as the owner", async () => {
    const { service } = build();
    const claims = await service.verify(TOKEN);
    expect(claims).toEqual({
      sub: "user-1",
      sid: "apikey:key-1",
      tier: "TIER_1",
      via: "apikey",
      scopes: ["pots:read"],
      apiKeyId: "key-1"
    });
  });

  it("caches the principal and skips the DB on the second call", async () => {
    const { service, keys } = build();
    await service.verify(TOKEN);
    await service.verify(TOKEN);
    expect((keys.findByHash as jest.Mock).mock.calls.length).toBe(1);
  });

  it("rejects an unknown key", async () => {
    const { service } = build({ key: null });
    await expect(service.verify(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a revoked key", async () => {
    const { service } = build({ key: makeKeyRow({ revokedAt: new Date() }) });
    await expect(service.verify(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects an expired key", async () => {
    const { service } = build({
      key: makeKeyRow({ expiresAt: new Date("2020-01-01T00:00:00.000Z") })
    });
    await expect(service.verify(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a cached principal whose key has since expired", async () => {
    const { service } = build({
      cached: JSON.stringify({
        sub: "user-1",
        sid: "apikey:key-1",
        tier: "TIER_1",
        via: "apikey",
        scopes: ["pots:read"],
        apiKeyId: "key-1",
        expiresAt: "2020-01-01T00:00:00.000Z"
      })
    });
    await expect(service.verify(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a key whose owner is not active", async () => {
    const { service } = build({ user: { id: "user-1", tier: "TIER_1", status: "SUSPENDED" } });
    await expect(service.verify(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("evict removes the cached principal", async () => {
    const { service, store } = build();
    await service.verify(TOKEN);
    expect(store.has(`apikey:principal:${sha256(TOKEN)}`)).toBe(true);
    await service.evict(sha256(TOKEN));
    expect(store.has(`apikey:principal:${sha256(TOKEN)}`)).toBe(false);
  });
});
