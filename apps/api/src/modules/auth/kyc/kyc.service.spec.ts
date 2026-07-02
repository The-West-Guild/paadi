import { BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KycStatus, Tier } from "@paadi/db";
import { KycService } from "./kyc.service";

describe("KycService", () => {
  const bvnRecord = {
    firstName: "Ada",
    lastName: "Okeke",
    dateOfBirth: "1990-01-01",
    phoneNumber: "+2348000000001",
    reference: "22222222222"
  };

  function build() {
    const kycProvider = {
      validateBvn: jest.fn().mockResolvedValue(bvnRecord),
      verifyLiveness: jest.fn().mockResolvedValue({ passed: true, confidence: 0.99, reference: "mock-liveness" })
    };
    const userRepo = {
      findById: jest.fn(),
      updateKyc: jest.fn().mockResolvedValue(undefined),
      setKycPending: jest.fn().mockResolvedValue(undefined),
      findByKycReference: jest.fn()
    };
    const profileRepo = {
      findByUserId: jest.fn().mockResolvedValue({ firstName: "Ada", lastName: "Okeke" })
    };
    const store = new Map<string, string>();
    const redis = {
      setex: jest.fn((key: string, _ttl: number, value: string) => {
        store.set(key, value);
        return Promise.resolve("OK");
      }),
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      del: jest.fn((key: string) => {
        store.delete(key);
        return Promise.resolve(1);
      })
    };
    const outbox = {
      enqueue: jest.fn().mockResolvedValue(undefined)
    };
    const service = new KycService(
      kycProvider as never,
      userRepo as never,
      profileRepo as never,
      redis as never,
      new ConfigService({ dojah: { webhookSecret: "secret" } }),
      outbox as never
    );
    return { service, kycProvider, userRepo, profileRepo, redis, outbox };
  }

  it("canReceivePayout is false for TIER_0 only", () => {
    const { service } = build();
    expect(service.canReceivePayout(Tier.TIER_0)).toBe(false);
    expect(service.canReceivePayout(Tier.TIER_1)).toBe(true);
  });

  it("getStatus throws NotFound when user missing", async () => {
    const { service, userRepo } = build();
    userRepo.findById.mockResolvedValue(null);
    await expect(service.getStatus("u1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("getStatus serializes bvnVerifiedAt", async () => {
    const { service, userRepo } = build();
    const at = new Date("2026-01-01T00:00:00.000Z");
    userRepo.findById.mockResolvedValue({
      kycStatus: KycStatus.VERIFIED,
      tier: Tier.TIER_1,
      bvnVerified: true,
      bvnVerifiedAt: at
    });
    await expect(service.getStatus("u1")).resolves.toEqual({
      kycStatus: KycStatus.VERIFIED,
      tier: Tier.TIER_1,
      bvnVerified: true,
      bvnVerifiedAt: at.toISOString()
    });
  });

  it("submitBvn sets pending and never stores the bvn", async () => {
    const { service, userRepo, redis } = build();
    await expect(service.submitBvn("u1", "22222222222")).resolves.toEqual({ status: "pending_liveness" });
    expect(userRepo.setKycPending).toHaveBeenCalledWith("u1", "22222222222");
    expect(redis.setex).toHaveBeenCalledWith("kyc:pending:u1", 3600, "22222222222");
  });

  it("submitBvn rejects on name mismatch", async () => {
    const { service, profileRepo } = build();
    profileRepo.findByUserId.mockResolvedValue({ firstName: "Chidi", lastName: "Nwosu" });
    await expect(service.submitBvn("u1", "22222222222")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("submitSelfie requires a pending bvn", async () => {
    const { service } = build();
    await expect(service.submitSelfie("u1", "img")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("submitSelfie verifies and upgrades to TIER_1", async () => {
    const { service, userRepo, outbox } = build();
    await service.submitBvn("u1", "22222222222");
    await expect(service.submitSelfie("u1", "img")).resolves.toEqual({ status: "verified", tier: Tier.TIER_1 });
    expect(userRepo.updateKyc).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ kycStatus: KycStatus.VERIFIED, tier: Tier.TIER_1, bvnVerified: true })
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ event: { type: "kyc.verified", userId: "u1" } })
    );
  });

  it("submitSelfie marks FAILED when liveness fails", async () => {
    const { service, kycProvider, userRepo } = build();
    kycProvider.verifyLiveness.mockResolvedValue({ passed: false, confidence: 0.1, reference: "mock-liveness" });
    await service.submitBvn("u1", "22222222222");
    await expect(service.submitSelfie("u1", "img")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(userRepo.updateKyc).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ kycStatus: KycStatus.FAILED, tier: Tier.TIER_0, bvnVerified: false })
    );
  });

  it("completeByReference is idempotent for already-verified users", async () => {
    const { service, userRepo, outbox } = build();
    userRepo.findByKycReference.mockResolvedValue({ id: "u1", kycStatus: KycStatus.VERIFIED });
    await service.completeByReference("ref");
    expect(userRepo.updateKyc).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("completeByReference upgrades a pending user", async () => {
    const { service, userRepo, outbox } = build();
    userRepo.findByKycReference.mockResolvedValue({ id: "u1", kycStatus: KycStatus.PENDING });
    await service.completeByReference("ref");
    expect(userRepo.updateKyc).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ kycStatus: KycStatus.VERIFIED, tier: Tier.TIER_1 })
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ event: { type: "kyc.verified", userId: "u1" } })
    );
  });
});
