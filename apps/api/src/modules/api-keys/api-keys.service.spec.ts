import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { apiKeyCreatedSchema, apiKeysResponseSchema } from "@paadi/contracts";
import { ApiKey } from "@paadi/db";
import { AuditService } from "../../infra/audit/audit.service";
import { ApiKeyAuthService } from "../../infra/auth/api-key-auth.service";
import type { AccessClaims } from "../../infra/auth/token.service";
import { ApiKeyRepository } from "../../infra/persistence/api-key.repository";
import { ApiKeysService } from "./api-keys.service";

const SECRET = "pk_test_returned_once";

function sessionClaims(sub = "user-1"): AccessClaims {
  return { sub, sid: "sid-1", tier: "TIER_1", via: "session" };
}

function apiKeyClaims(sub = "user-1", apiKeyId = "key-1"): AccessClaims {
  return { sub, sid: `apikey:${apiKeyId}`, tier: "TIER_1", via: "apikey", scopes: ["pots:read"], apiKeyId };
}

function makeKeyRow(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: overrides.id ?? "key-1",
    userId: overrides.userId ?? "user-1",
    name: overrides.name ?? "agent key",
    prefix: overrides.prefix ?? "pk_test_retu",
    keyHash: overrides.keyHash ?? "hash-1",
    scopes: overrides.scopes ?? ["pots:read"],
    lastUsedAt: overrides.lastUsedAt ?? null,
    expiresAt: overrides.expiresAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-07-01T00:00:00.000Z")
  } as ApiKey;
}

interface BuildOptions {
  rows?: ApiKey[];
  activeCount?: number;
}

function build(options: BuildOptions = {}) {
  const rows = new Map<string, ApiKey>((options.rows ?? []).map((r) => [r.id, r]));
  const repo = {
    mint: jest.fn(async (input: { userId: string; name: string; scopes: string[] }) => {
      const key = makeKeyRow({ id: `key-${rows.size + 1}`, userId: input.userId, name: input.name, scopes: input.scopes });
      rows.set(key.id, key);
      return { key, secret: SECRET };
    }),
    findById: jest.fn(async (id: string) => rows.get(id) ?? null),
    listForUser: jest.fn(async (userId: string) => [...rows.values()].filter((r) => r.userId === userId)),
    countActiveForUser: jest.fn(async () => options.activeCount ?? rows.size),
    revoke: jest.fn(async (id: string) => {
      const revoked = makeKeyRow({ ...rows.get(id), id, revokedAt: new Date() });
      rows.set(id, revoked);
      return revoked;
    })
  } as unknown as ApiKeyRepository;

  const auth = { evict: jest.fn(async () => undefined) } as unknown as ApiKeyAuthService;
  const audit = { recordSafe: jest.fn(async () => undefined) } as unknown as AuditService;
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;
  const service = new ApiKeysService(repo, auth, audit, config);
  return { service, repo, auth, audit };
}

describe("ApiKeysService.mint", () => {
  it("returns the plaintext key once and a DTO that validates without hash fields", async () => {
    const { service, audit } = build();
    const created = await service.mint(sessionClaims(), { name: "agent key", scopes: ["pots:read"] });
    expect(apiKeyCreatedSchema.parse(created).key).toBe(SECRET);
    expect(created).not.toHaveProperty("keyHash");
    expect(audit.recordSafe).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "apikey.minted" })
    );
    // The audit payload must never contain the plaintext key.
    const payload = (audit.recordSafe as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toContain(SECRET);
  });

  it("rejects api-key principals with 403 (a key must not mint keys)", async () => {
    const { service } = build();
    await expect(service.mint(apiKeyClaims(), { name: "x", scopes: ["pots:read"] })).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("enforces the per-user active key cap", async () => {
    const { service } = build({ activeCount: 10 });
    await expect(service.mint(sessionClaims(), { name: "x", scopes: ["pots:read"] })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("rejects an expiresAt in the past", async () => {
    const { service } = build();
    await expect(
      service.mint(sessionClaims(), { name: "x", scopes: ["pots:read"], expiresAt: "2020-01-01T00:00:00.000Z" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("ApiKeysService.list", () => {
  it("lists only the caller's keys with no secret material", async () => {
    const { service } = build({ rows: [makeKeyRow(), makeKeyRow({ id: "key-2", userId: "user-2" })] });
    const response = await service.list(sessionClaims());
    const parsed = apiKeysResponseSchema.parse(response);
    expect(parsed.keys).toHaveLength(1);
    expect(parsed.keys[0]).not.toHaveProperty("key");
    expect(parsed.keys[0]).not.toHaveProperty("keyHash");
  });

  it("rejects api-key principals", async () => {
    const { service } = build();
    await expect(service.list(apiKeyClaims())).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("ApiKeysService.revoke", () => {
  it("revokes an owned key, evicts its cached principal, and audits", async () => {
    const { service, auth, audit } = build({ rows: [makeKeyRow()] });
    const revoked = await service.revoke(sessionClaims(), "key-1");
    expect(revoked.revokedAt).not.toBeNull();
    expect(auth.evict).toHaveBeenCalledWith("hash-1");
    expect(audit.recordSafe).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "apikey.revoked" })
    );
  });

  it("404s on another user's key (no IDOR)", async () => {
    const { service } = build({ rows: [makeKeyRow({ userId: "user-2" })] });
    await expect(service.revoke(sessionClaims("user-1"), "key-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects api-key principals", async () => {
    const { service } = build({ rows: [makeKeyRow()] });
    await expect(service.revoke(apiKeyClaims(), "key-1")).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("ApiKeysService.current", () => {
  it("returns identity and scopes for the calling key", async () => {
    const { service } = build({ rows: [makeKeyRow()] });
    const current = await service.current(apiKeyClaims());
    expect(current).toEqual({
      id: "key-1",
      name: "agent key",
      prefix: "pk_test_retu",
      mode: "test",
      scopes: ["pots:read"]
    });
  });

  it("reports live mode for pk_live_ prefixes", async () => {
    const { service } = build({ rows: [makeKeyRow({ prefix: "pk_live_abcd" })] });
    const current = await service.current(apiKeyClaims());
    expect(current.mode).toBe("live");
  });

  it("400s for session principals", async () => {
    const { service } = build();
    await expect(service.current(sessionClaims())).rejects.toBeInstanceOf(BadRequestException);
  });
});
