import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KycProvider, OutboxMessage, OutboxRepository } from "@paadi/domain";
import { KycStatus, Tier } from "@paadi/db";
import type { KycStatusResponse } from "@paadi/contracts";
import { randomUUID } from "node:crypto";
import { ProfileRepository } from "../../../infra/persistence/profile.repository";
import { UserRepository } from "../../../infra/persistence/user.repository";
import { RedisService } from "../../../infra/redis/redis.service";
import { nameMatches } from "./name-match.util";

const KYC_PENDING_TTL_SECONDS = 3600;
const OUTBOX_TARGET = "internal";

@Injectable()
export class KycService {
  constructor(
    private readonly kycProvider: KycProvider,
    private readonly userRepo: UserRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    @Inject(OutboxRepository) private readonly outbox: OutboxRepository
  ) {
    void this.config;
  }

  canReceivePayout(tier: Tier): boolean {
    return tier !== Tier.TIER_0;
  }

  async getStatus(userId: string): Promise<KycStatusResponse> {
    const u = await this.userRepo.findById(userId);
    if (!u) {
      throw new NotFoundException("user not found");
    }
    return {
      kycStatus: u.kycStatus,
      tier: u.tier,
      bvnVerified: u.bvnVerified,
      bvnVerifiedAt: u.bvnVerifiedAt ? u.bvnVerifiedAt.toISOString() : null
    };
  }

  async submitBvn(userId: string, bvn: string): Promise<{ status: string }> {
    const record = await this.kycProvider.validateBvn(bvn);
    const profile = await this.profileRepo.findByUserId(userId);
    if (!nameMatches(profile ?? {}, record)) {
      throw new UnauthorizedException("bvn name mismatch");
    }
    await this.userRepo.setKycPending(userId, record.reference);
    await this.redis.setex(`kyc:pending:${userId}`, KYC_PENDING_TTL_SECONDS, record.reference);
    return { status: "pending_liveness" };
  }

  async submitSelfie(userId: string, image: string): Promise<{ status: string; tier: Tier }> {
    const ref = await this.redis.get(`kyc:pending:${userId}`);
    if (!ref) {
      throw new BadRequestException("submit bvn first");
    }
    const result = await this.kycProvider.verifyLiveness(image, ref);
    if (!result.passed) {
      await this.userRepo.updateKyc(userId, {
        kycStatus: KycStatus.FAILED,
        tier: Tier.TIER_0,
        bvnVerified: false,
        bvnVerifiedAt: new Date(0),
        kycReference: ref
      });
      throw new UnauthorizedException("liveness failed");
    }
    await this.completeKyc(userId, result.reference);
    await this.redis.del(`kyc:pending:${userId}`);
    return { status: "verified", tier: Tier.TIER_1 };
  }

  async completeKyc(userId: string, reference: string): Promise<void> {
    await this.userRepo.updateKyc(userId, {
      kycStatus: KycStatus.VERIFIED,
      tier: Tier.TIER_1,
      bvnVerified: true,
      bvnVerifiedAt: new Date(),
      kycReference: reference
    });
    await this.outbox.enqueue(this.kycVerified(userId));
  }

  async completeByReference(reference: string): Promise<void> {
    const u = await this.userRepo.findByKycReference(reference);
    if (!u) {
      return;
    }
    if (u.kycStatus === KycStatus.VERIFIED) {
      return;
    }
    await this.completeKyc(u.id, reference);
  }

  private kycVerified(userId: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "kyc.verified", userId },
      attempts: 0
    };
  }
}
