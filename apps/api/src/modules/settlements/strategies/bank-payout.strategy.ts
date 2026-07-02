import { Injectable, Logger } from "@nestjs/common";
import { SettlementFailureReason } from "@paadi/contracts";
import { PaymentProviderPort, TransferResult } from "@paadi/domain";
import { PrismaService, Tier as DbTier } from "@paadi/db";
import {
  BeginSettlementResult,
  SettlementsRepository
} from "../../../infra/persistence/settlements.repository";
import { CryptoService } from "../../../common/crypto/crypto.service";
import { payoutNameMatches } from "../../auth/payout/payout-name-match.util";
import { SettleResult, SettlementStrategy } from "../settlements.service";

const SENDER_NAME = "Paadi";

const ALLOWED_TIERS: ReadonlySet<DbTier> = new Set<DbTier>([DbTier.TIER_1, DbTier.TIER_2]);

@Injectable()
export class BankPayoutStrategy implements SettlementStrategy {
  private readonly logger = new Logger(BankPayoutStrategy.name);

  constructor(
    private readonly settlements: SettlementsRepository,
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProviderPort,
    private readonly crypto: CryptoService
  ) {}

  async dispatch(begin: BeginSettlementResult): Promise<SettleResult> {
    const { context, merchantTxRef, settlementId } = begin;

    const creator = await this.prisma.user.findUniqueOrThrow({
      where: { id: context.creatorId },
      include: { profile: true }
    });
    if (!ALLOWED_TIERS.has(creator.tier)) {
      return this.fail(context.potId, settlementId, SettlementFailureReason.KycTierRequired);
    }

    const account =
      context.payoutAccountId === null
        ? null
        : await this.prisma.payoutAccount.findUnique({ where: { id: context.payoutAccountId } });
    if (account === null || account.userId !== context.creatorId || !account.nameMatchVerified) {
      return this.fail(context.potId, settlementId, SettlementFailureReason.PayoutAccountInvalid);
    }
    if (!payoutNameMatches(creator.profile ?? {}, account.accountName)) {
      return this.fail(context.potId, settlementId, SettlementFailureReason.NameMismatch);
    }

    const netKobo = context.collectedKobo - context.feeKobo;
    let transfer: TransferResult;
    try {
      transfer = await this.provider.transferToBank(
        this.crypto.decryptAccountNumber(account.accountNumberEnc),
        account.accountName,
        account.bankCode,
        netKobo,
        merchantTxRef,
        SENDER_NAME
      );
    } catch (error) {
      this.logger.error(`bank transfer failed for pot ${context.potId}`, error as Error);
      await this.settlements.failSettlement(context.potId, SettlementFailureReason.Gateway);
      throw error;
    }

    const nombaRef = transfer.transferId ?? transfer.reference;

    if (transfer.status === "success") {
      const finalized = await this.settlements.finalizeSettlement(context.potId, {
        kind: "settled",
        netKobo,
        feeKobo: context.feeKobo,
        vendToken: null,
        vendUnits: null,
        nombaRef,
        providerStatus: transfer.status
      });
      return { settlementId: finalized.settlementId, status: "settled" };
    }

    const finalized = await this.settlements.finalizeSettlement(context.potId, {
      kind: "pending",
      netKobo,
      feeKobo: context.feeKobo,
      nombaRef,
      providerStatus: "PENDING_BILLING"
    });
    return { settlementId: finalized.settlementId, status: "awaiting_confirmation" };
  }

  private async fail(
    potId: string,
    settlementId: string,
    reason: SettlementFailureReason
  ): Promise<SettleResult> {
    await this.settlements.failSettlement(potId, reason);
    this.logger.warn(`bank payout settlement ${settlementId} failed: ${reason}`);
    return { settlementId, status: "noop" };
  }
}
