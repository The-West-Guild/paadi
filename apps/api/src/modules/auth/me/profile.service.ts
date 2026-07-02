import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { MeResponse, PublicProfileResponse, UpdateProfileInput } from "@paadi/contracts";
import { OutboxMessage, OutboxRepository } from "@paadi/domain";
import { randomUUID } from "node:crypto";
import { CryptoService } from "../../../common/crypto/crypto.service";
import { ProfileRepository } from "../../../infra/persistence/profile.repository";
import { UserRepository } from "../../../infra/persistence/user.repository";
import { redisKeys } from "../../../infra/redis/redis.keys";
import { RedisService } from "../../../infra/redis/redis.service";
import { normalizeUsername, validateUsername } from "../username/username.util";

const TOMBSTONE_TTL_SECONDS = 14 * 86400;
const RENAME_TTL_SECONDS = 30 * 86400;
const OUTBOX_TARGET = "internal";

function mask(phone: string): string {
  if (phone.length <= 8) {
    return "***";
  }
  return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    @Inject(OutboxRepository) private readonly outbox: OutboxRepository
  ) {}

  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new NotFoundException("user not found");
    }
    const profile = await this.profileRepo.findByUserId(userId);
    const phoneMasked = mask(this.crypto.decryptPhone(user.phoneEncrypted));
    return {
      id: user.id,
      phoneMasked,
      email: user.email,
      emailVerified: !!user.emailVerifiedAt,
      tier: user.tier,
      kycStatus: user.kycStatus,
      status: user.status,
      profile: {
        username: profile?.username ?? "",
        displayName: profile?.displayName ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null
      }
    };
  }

  async updateProfile(userId: string, data: UpdateProfileInput): Promise<{ ok: boolean }> {
    await this.profileRepo.updateProfile(userId, data);
    await this.outbox.enqueue(this.nameChanged(userId));
    return { ok: true };
  }

  async changeUsername(userId: string, username: string): Promise<{ ok: boolean }> {
    const v = validateUsername(username);
    if (!v.ok) {
      throw new BadRequestException(v.reason);
    }
    if (await this.profileRepo.isUsernameTaken(v.normalized)) {
      throw new ConflictException("username taken");
    }
    if (await this.redis.get(redisKeys.usernameTombstone(v.normalized))) {
      throw new ConflictException("handle recently released");
    }
    if (await this.redis.get(redisKeys.usernameRename(userId))) {
      throw new ConflictException("rename too soon");
    }
    const current = await this.profileRepo.findByUserId(userId);
    await this.profileRepo.renameUsername(userId, username, v.normalized);
    if (current?.usernameNormalized) {
      await this.redis.setex(redisKeys.usernameTombstone(current.usernameNormalized), TOMBSTONE_TTL_SECONDS, "1");
    }
    await this.redis.setex(redisKeys.usernameRename(userId), RENAME_TTL_SECONDS, "1");
    return { ok: true };
  }

  async getPublicProfile(username: string): Promise<PublicProfileResponse> {
    const profile = await this.profileRepo.findByUsernameNormalized(normalizeUsername(username));
    if (!profile) {
      throw new NotFoundException("profile not found");
    }
    return {
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl
    };
  }

  private nameChanged(userId: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "profile.name_changed", userId },
      attempts: 0
    };
  }
}
