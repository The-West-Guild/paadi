import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  BanksResponse,
  PayoutAccountDto,
  PayoutAccountsResponse,
  PayoutLookupResponse
} from "@paadi/contracts";
import { PayoutAccount } from "@paadi/db";
import { PaymentProviderPort } from "@paadi/domain";
import { CryptoService } from "../../../common/crypto/crypto.service";
import { PayoutAccountRepository } from "../../../infra/persistence/payout-account.repository";
import { ProfileRepository } from "../../../infra/persistence/profile.repository";
import { PinService } from "../pin/pin.service";
import { payoutNameMatches } from "./payout-name-match.util";

function toDto(row: PayoutAccount): PayoutAccountDto {
  return {
    id: row.id,
    bankCode: row.bankCode,
    bankName: row.bankName,
    accountNumberLast4: row.accountNumberLast4,
    accountName: row.accountName,
    nameMatchVerified: row.nameMatchVerified,
    isPrimary: row.isPrimary
  };
}

@Injectable()
export class PayoutAccountService {
  constructor(
    private readonly provider: PaymentProviderPort,
    private readonly repo: PayoutAccountRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly crypto: CryptoService,
    private readonly pin: PinService
  ) {}

  async listBanks(): Promise<BanksResponse> {
    return { banks: await this.provider.listBanks() };
  }

  async lookup(bankCode: string, accountNumber: string): Promise<PayoutLookupResponse> {
    return this.provider.lookupAccountName(accountNumber, bankCode);
  }

  async list(userId: string): Promise<PayoutAccountsResponse> {
    const rows = await this.repo.listForUser(userId);
    return { accounts: rows.map(toDto) };
  }

  async create(
    userId: string,
    bankCode: string,
    accountNumber: string,
    pin: string
  ): Promise<PayoutAccountDto> {
    await this.pin.verify(userId, pin);
    const { accountName } = await this.provider.lookupAccountName(accountNumber, bankCode);
    const banks = await this.provider.listBanks();
    const bankName = banks.find((b) => b.code === bankCode)?.name ?? bankCode;
    const profile = await this.profileRepo.findByUserId(userId);
    const nameMatchVerified = payoutNameMatches(profile ?? {}, accountName);
    const accountNumberEnc = this.crypto.encryptAccountNumber(accountNumber);
    const accountNumberLast4 = accountNumber.slice(-4);
    const isPrimary = !(await this.repo.hasAny(userId));
    const row = await this.repo.create({
      userId,
      bankCode,
      bankName,
      accountNumberEnc,
      accountNumberLast4,
      accountName,
      nameMatchVerified,
      isPrimary
    });
    return toDto(row);
  }

  async setPrimary(userId: string, id: string): Promise<{ ok: boolean }> {
    const row = await this.repo.findById(id);
    if (!row || row.userId !== userId) {
      throw new NotFoundException("payout account not found");
    }
    await this.repo.setPrimary(userId, id);
    return { ok: true };
  }

  async remove(userId: string, id: string, pin: string): Promise<{ ok: boolean }> {
    await this.pin.verify(userId, pin);
    const row = await this.repo.findById(id);
    if (!row || row.userId !== userId) {
      throw new NotFoundException("payout account not found");
    }
    await this.repo.remove(id);
    return { ok: true };
  }
}
