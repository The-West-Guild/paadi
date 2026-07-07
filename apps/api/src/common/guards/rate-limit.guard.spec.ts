import { ExecutionContext, HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AccessClaims } from "../../infra/auth/token.service";
import { RedisService } from "../../infra/redis/redis.service";
import { RateLimitGuard } from "./rate-limit.guard";

interface BuildOptions {
  user?: Partial<AccessClaims>;
  config?: Record<string, unknown>;
  redisFails?: boolean;
}

function build(options: BuildOptions = {}) {
  const counters = new Map<string, number>();
  const headers: Record<string, string> = {};
  const redis = {
    incr: jest.fn(async (key: string) => {
      if (options.redisFails) {
        throw new Error("redis down");
      }
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    expire: jest.fn(async () => 1)
  } as unknown as RedisService;

  const configValues: Record<string, unknown> = {
    "rateLimit.enabled": true,
    "rateLimit.windowSeconds": 60,
    "rateLimit.authenticatedLimit": 5,
    "rateLimit.apiKeyLimit": 3,
    "rateLimit.publicLimit": 2,
    ...options.config
  };
  const config = {
    get: jest.fn((path: string) => configValues[path])
  } as unknown as ConfigService;

  const request = { headers: {}, ip: "10.0.0.1", user: options.user };
  const response = {
    header: jest.fn((name: string, value: string) => {
      headers[name] = value;
    })
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response })
  } as unknown as ExecutionContext;

  const guard = new RateLimitGuard(redis, config);
  return { guard, context, redis, headers, counters };
}

const API_KEY_USER: Partial<AccessClaims> = {
  sub: "user-1",
  via: "apikey",
  apiKeyId: "key-1"
};
const SESSION_USER: Partial<AccessClaims> = { sub: "user-1", via: "session" };

describe("RateLimitGuard", () => {
  it("tracks api-key principals by key id with the api-key limit", async () => {
    const { guard, context, counters, headers } = build({ user: API_KEY_USER });
    await guard.canActivate(context);
    expect([...counters.keys()][0]).toContain("key:key-1");
    expect(headers["X-RateLimit-Limit"]).toBe("3");
  });

  it("tracks session principals by user id", async () => {
    const { guard, context, counters, headers } = build({ user: SESSION_USER });
    await guard.canActivate(context);
    expect([...counters.keys()][0]).toContain("user:user-1");
    expect(headers["X-RateLimit-Limit"]).toBe("5");
  });

  it("tracks anonymous requests by ip with the public limit", async () => {
    const { guard, context, counters, headers } = build();
    await guard.canActivate(context);
    expect([...counters.keys()][0]).toContain("ip:10.0.0.1");
    expect(headers["X-RateLimit-Limit"]).toBe("2");
  });

  it("returns 429 with Retry-After once the limit is exceeded", async () => {
    const { guard, context, headers } = build();
    await guard.canActivate(context);
    await guard.canActivate(context);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);
    try {
      await guard.canActivate(context);
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(429);
    }
    expect(headers["Retry-After"]).toBeDefined();
    expect(Number(headers["X-RateLimit-Remaining"])).toBe(0);
  });

  it("decrements the remaining header as hits accrue", async () => {
    const { guard, context, headers } = build({ user: SESSION_USER });
    await guard.canActivate(context);
    expect(headers["X-RateLimit-Remaining"]).toBe("4");
    await guard.canActivate(context);
    expect(headers["X-RateLimit-Remaining"]).toBe("3");
  });

  it("fails open when redis is unavailable", async () => {
    const { guard, context } = build({ redisFails: true });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("passes through when disabled", async () => {
    const { guard, context, redis } = build({ config: { "rateLimit.enabled": false } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.incr).not.toHaveBeenCalled();
  });
});
