import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { redisKeys } from "../../infra/redis/redis.keys";
import { RedisService } from "../../infra/redis/redis.service";
import type { AccessClaims } from "../../infra/auth/token.service";

// GUARDING COMMENT — bounded by design: one INCR + one EXPIRE per request in a
// fixed window; keys self-expire after windowSeconds + 1. Fails OPEN on Redis
// errors (an infra outage must degrade to "no limiting", never to "API down").
// Do not add retries here — the guard runs on every request.

interface RateLimitConfig {
  enabled: boolean;
  windowSeconds: number;
  authenticatedLimit: number;
  apiKeyLimit: number;
  publicLimit: number;
}

const DEFAULTS: RateLimitConfig = {
  enabled: true,
  windowSeconds: 60,
  authenticatedLimit: 120,
  apiKeyLimit: 60,
  publicLimit: 20
};

/**
 * Redis fixed-window rate limiting keyed on the resolved principal — API key,
 * then user, then client IP. Registered after JwtGuard so request.user is set.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const cfg = this.settings();
    if (!cfg.enabled) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const claims = request.user as AccessClaims | undefined;

    const [tracker, limit] = claims?.apiKeyId
      ? [`key:${claims.apiKeyId}`, cfg.apiKeyLimit]
      : claims?.sub
        ? [`user:${claims.sub}`, cfg.authenticatedLimit]
        : [`ip:${request.ip ?? "unknown"}`, cfg.publicLimit];

    const window = Math.floor(Date.now() / (cfg.windowSeconds * 1000));

    let hits: number;
    try {
      const key = redisKeys.rateLimit(tracker, window);
      hits = await this.redis.incr(key);
      if (hits === 1) {
        await this.redis.expire(key, cfg.windowSeconds + 1);
      }
    } catch {
      return true; // fail-open: never let a Redis outage take the API down
    }

    const resetSeconds = Math.max(
      1,
      Math.ceil(((window + 1) * cfg.windowSeconds * 1000 - Date.now()) / 1000)
    );
    response.header("X-RateLimit-Limit", String(limit));
    response.header("X-RateLimit-Remaining", String(Math.max(0, limit - hits)));
    response.header("X-RateLimit-Reset", String(resetSeconds));

    if (hits > limit) {
      response.header("Retry-After", String(resetSeconds));
      throw new HttpException("rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private settings(): RateLimitConfig {
    return {
      enabled: this.config.get<boolean>("rateLimit.enabled") ?? DEFAULTS.enabled,
      windowSeconds: this.config.get<number>("rateLimit.windowSeconds") ?? DEFAULTS.windowSeconds,
      authenticatedLimit:
        this.config.get<number>("rateLimit.authenticatedLimit") ?? DEFAULTS.authenticatedLimit,
      apiKeyLimit: this.config.get<number>("rateLimit.apiKeyLimit") ?? DEFAULTS.apiKeyLimit,
      publicLimit: this.config.get<number>("rateLimit.publicLimit") ?? DEFAULTS.publicLimit
    };
  }
}
