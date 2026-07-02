import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import { PaymentProviderPort } from "@paadi/domain";
import {
  KycStatus,
  AccountStatus,
  Tier,
  VirtualAccount,
  VirtualAccountStatus as DbVirtualAccountStatus
} from "@paadi/db";
import { ProfileRepository } from "../../infra/persistence/profile.repository";
import { UserRepository } from "../../infra/persistence/user.repository";
import { VirtualAccountRepository } from "../../infra/persistence/virtual-account.repository";

const ACCOUNT_NAME_MIN = 8;
const ACCOUNT_NAME_MAX = 64;
const ACCOUNT_NAME_PAD = "PAADI USER";

export interface ProvisionOutcome {
  virtualAccount: VirtualAccount;
  created: boolean;
}

@Injectable()
export class VirtualAccountService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly repo: VirtualAccountRepository,
    private readonly provider: PaymentProviderPort
  ) {}

  async getForUser(userId: string): Promise<VirtualAccount> {
    const existing = await this.repo.findByUserId(userId);
    if (!existing) {
      throw new NotFoundException("no virtual account");
    }
    return existing;
  }

  async provisionVirtualAccount(userId: string): Promise<ProvisionOutcome> {
    const existing = await this.repo.findByUserId(userId);
    if (existing) {
      return { virtualAccount: existing, created: false };
    }

    const user = await this.userRepo.findById(userId);
    if (!user || !this.isEligible(user.tier, user.kycStatus, user.status)) {
      throw new ForbiddenException("kyc verification required");
    }

    const profile = await this.profileRepo.findByUserId(userId);
    const accountName = this.deriveAccountName(profile);
    const details = await this.provider.createVirtualAccount({
      accountRef: this.referenceFor(userId),
      accountName
    });

    return this.repo.provisionVirtualAccount({
      userId,
      accountNumber: details.accountNumber,
      accountName: details.accountName,
      providerBank: details.providerBank,
      nombaAccountRef: this.referenceFor(userId)
    });
  }

  async renameFromIdentity(userId: string): Promise<VirtualAccount | null> {
    const existing = await this.repo.findByUserId(userId);
    if (!existing || existing.status === DbVirtualAccountStatus.CLOSED) {
      return null;
    }
    const profile = await this.profileRepo.findByUserId(userId);
    const nextName = this.deriveAccountName(profile);
    if (nextName === existing.accountName) {
      return existing;
    }
    const details = await this.provider.updateVirtualAccount(existing.nombaAccountRef, {
      accountName: nextName
    });
    return this.repo.updateName(userId, details.accountName);
  }

  async suspend(userId: string): Promise<VirtualAccount | null> {
    const existing = await this.repo.findByUserId(userId);
    if (!existing || existing.status !== DbVirtualAccountStatus.ACTIVE) {
      return existing;
    }
    return this.repo.setStatus(userId, DbVirtualAccountStatus.SUSPENDED);
  }

  async restore(userId: string): Promise<VirtualAccount | null> {
    const existing = await this.repo.findByUserId(userId);
    if (!existing || existing.status !== DbVirtualAccountStatus.SUSPENDED) {
      return existing;
    }
    return this.repo.setStatus(userId, DbVirtualAccountStatus.ACTIVE);
  }

  async close(userId: string): Promise<VirtualAccount | null> {
    const existing = await this.repo.findByUserId(userId);
    if (!existing || existing.status === DbVirtualAccountStatus.CLOSED) {
      return existing;
    }
    await this.provider.expireVirtualAccount(existing.nombaAccountRef);
    return this.repo.close(userId);
  }

  private isEligible(tier: Tier, kycStatus: KycStatus, status: AccountStatus): boolean {
    return (
      tier !== Tier.TIER_0 &&
      kycStatus === KycStatus.VERIFIED &&
      status === AccountStatus.ACTIVE
    );
  }

  private referenceFor(userId: string): string {
    return `va_${userId}`;
  }

  private deriveAccountName(
    profile: { firstName?: string | null; lastName?: string | null; displayName?: string | null } | null
  ): string {
    const legal = this.normalize(
      `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim()
    );
    const base = legal.length > 0 ? legal : this.normalize(profile?.displayName ?? "");
    if (base.length === 0) {
      throw new UnprocessableEntityException("verified identity name required for virtual account");
    }
    const padded = base.length >= ACCOUNT_NAME_MIN ? base : `${base} ${ACCOUNT_NAME_PAD}`.trim();
    return padded.slice(0, ACCOUNT_NAME_MAX);
  }

  private normalize(value: string): string {
    return value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }
}
