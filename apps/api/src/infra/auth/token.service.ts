import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";
import { Prisma } from "@paadi/db";
import { CryptoService } from "../../common/crypto/crypto.service";
import { RedisService } from "../redis/redis.service";
import { redisKeys } from "../redis/redis.keys";
import { SessionRepository } from "../persistence/session.repository";
import { UserRepository } from "../persistence/user.repository";

const DEV_ACCESS_SECRET = "paadi-dev-access-secret";
const DEFAULT_ACCESS_TTL_SECONDS = 900;

interface IssueUser {
  id: string;
  tier: string;
}

interface DeviceInfo {
  deviceId?: string;
  userAgent?: string;
  ip?: string;
}

interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: "Bearer";
}

export interface AccessClaims {
  sub: string;
  /** Session id for JWT principals; `apikey:<keyId>` for API-key principals. */
  sid: string;
  tier: string;
  via: "session" | "apikey";
  /** Present only for API-key principals; sessions have implicit full access. */
  scopes?: string[];
  apiKeyId?: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionRepository,
    private readonly users: UserRepository,
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {}

  async issueSession(user: IssueUser, deviceInfo?: DeviceInfo): Promise<IssuedTokens> {
    const refreshToken = this.crypto.randomToken(32);
    const refreshTokenHash = this.crypto.sha256(refreshToken);
    const familyId = this.crypto.randomToken(16);
    const expiresAt = new Date(Date.now() + this.refreshAbsoluteDays() * 86_400_000);

    const session = await this.sessions.create({
      userId: user.id,
      familyId,
      refreshTokenHash,
      deviceInfo: this.deviceInfoOf(deviceInfo),
      ip: deviceInfo?.ip,
      userAgent: deviceInfo?.userAgent,
      expiresAt
    });

    const accessToken = await this.signAccess(user.id, session.id, user.tier);

    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds(), tokenType: "Bearer" };
  }

  async rotate(refreshToken: string): Promise<IssuedTokens> {
    const hash = this.crypto.sha256(refreshToken);
    const session = await this.sessions.findByRefreshHash(hash);
    if (!session) {
      throw new UnauthorizedException("invalid refresh");
    }

    if (session.revokedAt || session.rotatedAt) {
      const active = await this.sessions.listActiveForUser(session.userId);
      await this.sessions.revokeFamily(session.familyId);
      for (const member of active) {
        if (member.familyId === session.familyId) {
          await this.redis.setex(redisKeys.sessionDenylist(member.id), this.accessTtlSeconds(), "1");
        }
      }
      throw new UnauthorizedException("token reuse detected");
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("refresh expired");
    }

    const newRefresh = this.crypto.randomToken(32);
    const child = await this.sessions.rotate(session.id, {
      refreshTokenHash: this.crypto.sha256(newRefresh),
      deviceInfo: this.deviceInfoOf(session.deviceInfo),
      ip: session.ip ?? undefined,
      userAgent: session.userAgent ?? undefined,
      expiresAt: session.expiresAt
    });

    const user = await this.users.findById(session.userId);
    if (!user) {
      throw new UnauthorizedException("user not found");
    }

    const accessToken = await this.signAccess(child.userId, child.id, user.tier);

    return { accessToken, refreshToken: newRefresh, expiresIn: this.accessTtlSeconds(), tokenType: "Bearer" };
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token, { secret: this.accessSecret() });
    } catch {
      // jsonwebtoken throws raw JsonWebTokenError/TokenExpiredError — without
      // this catch they surface as 500 through the global filter.
      throw new UnauthorizedException("invalid access token");
    }
    if (await this.redis.get(redisKeys.sessionDenylist(claims.sid))) {
      throw new UnauthorizedException("session revoked");
    }
    return { sub: claims.sub, sid: claims.sid, tier: claims.tier, via: "session" };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.redis.setex(redisKeys.sessionDenylist(sessionId), this.accessTtlSeconds(), "1");
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const active = await this.sessions.listActiveForUser(userId);
    await this.sessions.revokeAllForUser(userId);
    for (const session of active) {
      await this.redis.setex(redisKeys.sessionDenylist(session.id), this.accessTtlSeconds(), "1");
    }
  }

  private signAccess(sub: string, sid: string, tier: string): Promise<string> {
    const options: JwtSignOptions = {
      secret: this.accessSecret(),
      expiresIn: (this.config.get<string>("jwt.accessTtl") ?? "15m") as JwtSignOptions["expiresIn"]
    };
    return this.jwt.signAsync({ sub, sid, tier }, options);
  }

  private deviceInfoOf(deviceInfo: unknown): Prisma.InputJsonValue | undefined {
    if (deviceInfo && typeof deviceInfo === "object") {
      return deviceInfo as Prisma.InputJsonValue;
    }
    return undefined;
  }

  private accessSecret(): string {
    const secret = this.config.get<string>("jwt.accessSecret") ?? "";
    if (secret.length > 0) {
      return secret;
    }
    if ((this.config.get<string>("nodeEnv") ?? "development") === "production") {
      throw new Error("Missing required secret: jwt.accessSecret");
    }
    return DEV_ACCESS_SECRET;
  }

  private accessTtlSeconds(): number {
    const ttl = this.config.get<string>("jwt.accessTtl") ?? "15m";
    const match = /^(\d+)([smhd])?$/.exec(ttl.trim());
    if (!match) {
      return DEFAULT_ACCESS_TTL_SECONDS;
    }
    const value = Number(match[1]);
    switch (match[2]) {
      case "s":
        return value;
      case "h":
        return value * 3600;
      case "d":
        return value * 86_400;
      case "m":
      default:
        return value * 60;
    }
  }

  private refreshAbsoluteDays(): number {
    return this.config.get<number>("jwt.refreshAbsoluteDays") ?? 90;
  }
}
