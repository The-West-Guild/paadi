import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiKey, PrismaService } from "@paadi/db";
import { CryptoService } from "../../common/crypto/crypto.service";

const SECRET_BYTES = 32;
const PREFIX_LENGTH = 12;

export interface MintApiKeyArgs {
  userId: string;
  name: string;
  scopes: string[];
  expiresAt?: Date;
}

export interface MintedApiKey {
  key: ApiKey;
  secret: string;
}

@Injectable()
export class ApiKeyRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService
  ) {}

  /**
   * Mints a new key. The plaintext secret leaves this method exactly once and
   * is never persisted — only its sha256 hash is stored. Keys are 256-bit
   * random, so a fast hash (not Argon2) is the right lookup primitive: the
   * unique index on keyHash gives O(1) verification and a DB dump alone
   * cannot recover the secret.
   */
  async mint(input: MintApiKeyArgs): Promise<MintedApiKey> {
    const mode = this.isProduction() ? "live" : "test";
    const secret = `pk_${mode}_${this.crypto.randomToken(SECRET_BYTES)}`;
    const key = await this.prisma.apiKey.create({
      data: {
        userId: input.userId,
        name: input.name,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        keyHash: this.crypto.sha256(secret),
        prefix: secret.slice(0, PREFIX_LENGTH)
      }
    });
    return { key, secret };
  }

  findByHash(keyHash: string): Promise<ApiKey | null> {
    return this.prisma.apiKey.findUnique({ where: { keyHash } });
  }

  findById(id: string): Promise<ApiKey | null> {
    return this.prisma.apiKey.findUnique({ where: { id } });
  }

  listForUser(userId: string): Promise<ApiKey[]> {
    return this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });
  }

  countActiveForUser(userId: string): Promise<number> {
    return this.prisma.apiKey.count({
      where: { userId, revokedAt: null }
    });
  }

  revoke(id: string): Promise<ApiKey> {
    return this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() }
    });
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() }
    });
  }

  private isProduction(): boolean {
    return (this.config.get<string>("nodeEnv") ?? "development") === "production";
  }
}
