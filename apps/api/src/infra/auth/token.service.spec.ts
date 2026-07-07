import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { UnauthorizedException } from "@nestjs/common";
import { CryptoService } from "../../common/crypto/crypto.service";
import { redisKeys } from "../redis/redis.keys";
import { TokenService } from "./token.service";

interface FakeSession {
  id: string;
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  parentId?: string;
  deviceInfo?: unknown;
  ip?: string;
  userAgent?: string;
  expiresAt: Date;
  rotatedAt?: Date | null;
  revokedAt?: Date | null;
}

function fakeSessions() {
  const rows = new Map<string, FakeSession>();
  let counter = 0;
  const create = jest.fn(async (input: Partial<FakeSession>) => {
    const id = `session-${++counter}`;
    const row: FakeSession = {
      id,
      userId: input.userId!,
      familyId: input.familyId!,
      refreshTokenHash: input.refreshTokenHash!,
      parentId: input.parentId,
      deviceInfo: input.deviceInfo,
      ip: input.ip,
      userAgent: input.userAgent,
      expiresAt: input.expiresAt!,
      rotatedAt: null,
      revokedAt: null
    };
    rows.set(id, row);
    return row;
  });
  return {
    rows,
    create,
    findByRefreshHash: jest.fn(async (hash: string) => {
      for (const row of rows.values()) {
        if (row.refreshTokenHash === hash) {
          return row;
        }
      }
      return null;
    }),
    rotate: jest.fn(async (oldId: string, child: Partial<FakeSession>) => {
      const old = rows.get(oldId)!;
      old.rotatedAt = new Date();
      const created = await create({
        userId: old.userId,
        familyId: old.familyId,
        parentId: old.id,
        refreshTokenHash: child.refreshTokenHash,
        deviceInfo: child.deviceInfo,
        ip: child.ip,
        userAgent: child.userAgent,
        expiresAt: child.expiresAt
      });
      return created;
    }),
    revoke: jest.fn(async (id: string) => {
      const row = rows.get(id)!;
      row.revokedAt = new Date();
      return row;
    }),
    revokeFamily: jest.fn(async (familyId: string) => {
      let count = 0;
      for (const row of rows.values()) {
        if (row.familyId === familyId && !row.revokedAt) {
          row.revokedAt = new Date();
          count++;
        }
      }
      return { count };
    }),
    revokeAllForUser: jest.fn(async (userId: string) => {
      let count = 0;
      for (const row of rows.values()) {
        if (row.userId === userId && !row.revokedAt) {
          row.revokedAt = new Date();
          count++;
        }
      }
      return { count };
    }),
    listActiveForUser: jest.fn(async (userId: string) =>
      [...rows.values()].filter((row) => row.userId === userId && !row.revokedAt)
    )
  };
}

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

function fakeUsers(tier = "TIER_1") {
  return { findById: jest.fn(async (id: string) => ({ id, tier })) };
}

function buildService(currentTier = "TIER_1") {
  const config = new ConfigService({
    nodeEnv: "test",
    jwt: { accessSecret: "test-access-secret", accessTtl: "15m", refreshAbsoluteDays: 90 }
  });
  const crypto = new CryptoService(new ConfigService({ nodeEnv: "test" }));
  const jwt = new JwtService({});
  const sessions = fakeSessions();
  const users = fakeUsers(currentTier);
  const redis = fakeRedis();
  const service = new TokenService(jwt, crypto, sessions as never, users as never, redis as never, config);
  return { service, sessions, users, redis, jwt, crypto };
}

describe("TokenService", () => {
  it("issues an access token whose claims include sub, sid and tier", async () => {
    const { service, jwt, sessions } = buildService();
    const issued = await service.issueSession({ id: "user-1", tier: "TIER_2" });

    expect(issued.tokenType).toBe("Bearer");
    expect(issued.refreshToken).toHaveLength(43);

    const claims = await jwt.verifyAsync<{ sub: string; sid: string; tier: string }>(issued.accessToken, {
      secret: "test-access-secret"
    });
    const created = [...sessions.rows.values()][0];
    expect(claims.sub).toBe("user-1");
    expect(claims.sid).toBe(created.id);
    expect(claims.tier).toBe("TIER_2");
  });

  it("rotates a known refresh into a new token, marks the old session rotated, and refreshes tier from the user record", async () => {
    const { service, sessions, jwt } = buildService("TIER_2");
    const issued = await service.issueSession({ id: "user-1", tier: "TIER_0" });
    const original = [...sessions.rows.values()][0];

    const rotated = await service.rotate(issued.refreshToken);

    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    expect(original.rotatedAt).toBeInstanceOf(Date);
    expect(sessions.rotate).toHaveBeenCalledTimes(1);

    const claims = await jwt.verifyAsync<{ sub: string; sid: string; tier: string }>(rotated.accessToken, {
      secret: "test-access-secret"
    });
    expect(claims.sub).toBe("user-1");
    expect(claims.sid).not.toBe(original.id);
    expect(claims.tier).toBe("TIER_2");
  });

  it("detects reuse of an already rotated refresh, revokes the family and denylists active sessions", async () => {
    const { service, sessions, redis } = buildService();
    const issued = await service.issueSession({ id: "user-1", tier: "TIER_1" });
    const original = [...sessions.rows.values()][0];

    await service.rotate(issued.refreshToken);
    const child = [...sessions.rows.values()].find((row) => row.parentId === original.id)!;

    await expect(service.rotate(issued.refreshToken)).rejects.toThrow(UnauthorizedException);
    expect(sessions.revokeFamily).toHaveBeenCalledWith(original.familyId);
    expect(redis.store.has(redisKeys.sessionDenylist(child.id))).toBe(true);
    expect(child.revokedAt).toBeInstanceOf(Date);
  });
});

describe("TokenService.verifyAccess", () => {
  it("returns a session principal for a valid token", async () => {
    const { service } = buildService();
    const issued = await service.issueSession({ id: "user-1", tier: "TIER_1" });

    const claims = await service.verifyAccess(issued.accessToken);

    expect(claims.sub).toBe("user-1");
    expect(claims.tier).toBe("TIER_1");
    expect(claims.via).toBe("session");
  });

  it("maps a malformed token to 401 instead of leaking a 500", async () => {
    const { service } = buildService();
    await expect(service.verifyAccess("garbage.jwt.here")).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verifyAccess("notajwt")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("maps a wrong-signature token to 401", async () => {
    const { service } = buildService();
    const foreign = await new JwtService({}).signAsync(
      { sub: "user-1", sid: "sid-1", tier: "TIER_1" },
      { secret: "some-other-secret", expiresIn: "15m" }
    );
    await expect(service.verifyAccess(foreign)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("maps an expired token to 401", async () => {
    const { service, jwt } = buildService();
    const expired = await jwt.signAsync(
      { sub: "user-1", sid: "sid-1", tier: "TIER_1" },
      { secret: "test-access-secret", expiresIn: "0s" }
    );
    await expect(service.verifyAccess(expired)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a denylisted session with 401", async () => {
    const { service, sessions } = buildService();
    const issued = await service.issueSession({ id: "user-1", tier: "TIER_1" });
    const session = [...sessions.rows.values()][0];

    await service.revoke(session.id);

    await expect(service.verifyAccess(issued.accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
