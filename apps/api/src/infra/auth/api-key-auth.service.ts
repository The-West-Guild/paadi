import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CryptoService } from "../../common/crypto/crypto.service";
import { ApiKeyRepository } from "../persistence/api-key.repository";
import { UserRepository } from "../persistence/user.repository";
import { redisKeys } from "../redis/redis.keys";
import { RedisService } from "../redis/redis.service";
import type { AccessClaims } from "./token.service";

const DEFAULT_CACHE_TTL_SECONDS = 60;
const TOUCH_DEBOUNCE_SECONDS = 60;

interface CachedPrincipal extends AccessClaims {
  expiresAt?: string;
}

@Injectable()
export class ApiKeyAuthService {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly users: UserRepository,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {}

  /**
   * Resolves a `pk_*` bearer token to a principal. Lookup is by sha256 of the
   * full secret through the unique keyHash index — the key is 256-bit random,
   * so the hash alone is enough (no slow hash, no timing side channel on an
   * indexed one-way hash of a high-entropy input). Verified principals are
   * cached briefly in Redis; revocation deletes the cache entry, so a revoked
   * key dies immediately on this instance and within the TTL everywhere else.
   */
  async verify(token: string): Promise<AccessClaims> {
    const keyHash = this.crypto.sha256(token);

    const cached = await this.redis.get(redisKeys.apiKeyPrincipal(keyHash));
    if (cached) {
      const principal = JSON.parse(cached) as CachedPrincipal;
      if (principal.expiresAt && new Date(principal.expiresAt).getTime() < Date.now()) {
        throw new UnauthorizedException("api key expired");
      }
      const { expiresAt: _expiresAt, ...claims } = principal;
      if (claims.apiKeyId) {
        this.touch(claims.apiKeyId);
      }
      return claims;
    }

    const key = await this.keys.findByHash(keyHash);
    if (!key || key.revokedAt) {
      throw new UnauthorizedException("invalid api key");
    }
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("api key expired");
    }

    const user = await this.users.findById(key.userId);
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("invalid api key");
    }

    const claims: AccessClaims = {
      sub: key.userId,
      sid: `apikey:${key.id}`,
      tier: user.tier,
      via: "apikey",
      scopes: key.scopes,
      apiKeyId: key.id
    };

    const cacheable: CachedPrincipal = {
      ...claims,
      expiresAt: key.expiresAt?.toISOString()
    };
    await this.redis.setex(
      redisKeys.apiKeyPrincipal(keyHash),
      this.cacheTtlSeconds(),
      JSON.stringify(cacheable)
    );
    this.touch(key.id);

    return claims;
  }

  /** Evicts a key's cached principal so revocation takes effect immediately. */
  async evict(keyHash: string): Promise<void> {
    await this.redis.del(redisKeys.apiKeyPrincipal(keyHash));
  }

  /** lastUsedAt bookkeeping: fire-and-forget, debounced to one write per minute per key. */
  private touch(keyId: string): void {
    void (async () => {
      if (await this.redis.get(redisKeys.apiKeyTouch(keyId))) {
        return;
      }
      await this.redis.setex(redisKeys.apiKeyTouch(keyId), TOUCH_DEBOUNCE_SECONDS, "1");
      await this.keys.touchLastUsed(keyId);
    })().catch(() => undefined);
  }

  private cacheTtlSeconds(): number {
    return this.config.get<number>("apiKeys.cacheTtlSeconds") ?? DEFAULT_CACHE_TTL_SECONDS;
  }
}
