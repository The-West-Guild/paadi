import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiKeyCreatedDto, ApiKeyCurrentDto, ApiKeyDto, ApiKeysResponse, MintApiKeyInput } from "@paadi/contracts";
import { ApiKey } from "@paadi/db";
import { AuditService } from "../../infra/audit/audit.service";
import { ApiKeyAuthService } from "../../infra/auth/api-key-auth.service";
import type { AccessClaims } from "../../infra/auth/token.service";
import { ApiKeyRepository } from "../../infra/persistence/api-key.repository";

const DEFAULT_MAX_PER_USER = 10;

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly apiKeyAuth: ApiKeyAuthService,
    private readonly audit: AuditService,
    private readonly config: ConfigService
  ) {}

  async mint(claims: AccessClaims, input: MintApiKeyInput): Promise<ApiKeyCreatedDto> {
    this.assertSession(claims);
    const active = await this.keys.countActiveForUser(claims.sub);
    if (active >= this.maxPerUser()) {
      throw new BadRequestException("api key limit reached");
    }
    if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException("expiresAt must be in the future");
    }
    const { key, secret } = await this.keys.mint({
      userId: claims.sub,
      name: input.name,
      scopes: input.scopes,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined
    });
    await this.audit.recordSafe({
      eventType: "apikey.minted",
      actorId: claims.sub,
      targetId: key.id,
      payload: { keyId: key.id, prefix: key.prefix, scopes: key.scopes }
    });
    // The plaintext key is returned exactly once; only its hash is stored.
    return { ...this.toDto(key), key: secret };
  }

  async list(claims: AccessClaims): Promise<ApiKeysResponse> {
    this.assertSession(claims);
    const rows = await this.keys.listForUser(claims.sub);
    return { keys: rows.map((row) => this.toDto(row)) };
  }

  async revoke(claims: AccessClaims, id: string): Promise<ApiKeyDto> {
    this.assertSession(claims);
    const key = await this.ownedKey(claims.sub, id);
    const revoked = await this.keys.revoke(key.id);
    // Evict the cached principal so revocation is immediate, not TTL-delayed.
    await this.apiKeyAuth.evict(key.keyHash);
    await this.audit.recordSafe({
      eventType: "apikey.revoked",
      actorId: claims.sub,
      targetId: key.id,
      payload: { keyId: key.id, prefix: key.prefix }
    });
    return this.toDto(revoked);
  }

  async current(claims: AccessClaims): Promise<ApiKeyCurrentDto> {
    if (claims.via !== "apikey" || !claims.apiKeyId) {
      throw new BadRequestException("not an api key");
    }
    const key = await this.keys.findById(claims.apiKeyId);
    if (!key) {
      throw new NotFoundException("api key not found");
    }
    return {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      mode: key.prefix.startsWith("pk_live_") ? "live" : "test",
      scopes: key.scopes
    };
  }

  /** Management endpoints are session-only: a key must never mint, list, or revoke keys. */
  private assertSession(claims: AccessClaims): void {
    if (claims.via !== "session") {
      throw new ForbiddenException("session authentication required");
    }
  }

  private async ownedKey(userId: string, id: string): Promise<ApiKey> {
    const key = await this.keys.findById(id);
    if (!key || key.userId !== userId) {
      throw new NotFoundException("api key not found");
    }
    return key;
  }

  private toDto(key: ApiKey): ApiKeyDto {
    return {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
      expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
      revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
      createdAt: key.createdAt.toISOString(),
      updatedAt: key.updatedAt.toISOString()
    };
  }

  private maxPerUser(): number {
    return this.config.get<number>("apiKeys.maxPerUser") ?? DEFAULT_MAX_PER_USER;
  }
}
