import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { SettlementFailureReason, WithdrawInput, WithdrawalView } from "@paadi/contracts";
import { PaymentProviderPort, TransferResult } from "@paadi/domain";
import { PayoutAccount, PrismaService, Tier as DbTier } from "@paadi/db";
import { PinService } from "../auth/pin/pin.service";
import { PayoutAccountRepository } from "../../infra/persistence/payout-account.repository";
import { CryptoService } from "../../common/crypto/crypto.service";
import { payoutNameMatches } from "../auth/payout/payout-name-match.util";
import { WithdrawalRepository } from "../../infra/persistence/withdrawal.repository";
import { QUEUES } from "../../queue/queue.constants";

const SENDER_NAME = "Paadi";
const WITHDRAWAL_FEE_KOBO = 0;
const CONFIRM_JOB_NAME = "confirm";

const ALLOWED_TIERS: ReadonlySet<DbTier> = new Set<DbTier>([DbTier.TIER_1, DbTier.TIER_2]);

interface WithdrawalConfirmJob {
  kind: "withdrawal";
  id: string;
}

@Injectable()
export class WithdrawService {
  private readonly logger = new Logger(WithdrawService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pin: PinService,
    private readonly payoutAccounts: PayoutAccountRepository,
    private readonly crypto: CryptoService,
    @Inject(PaymentProviderPort) private readonly provider: PaymentProviderPort,
    private readonly withdrawals: WithdrawalRepository,
    @InjectQueue(QUEUES.payoutConfirm) private readonly payoutConfirm: Queue
  ) {}

  async withdraw(userId: string, input: WithdrawInput, idempotencyKey: string): Promise<WithdrawalView> {
    await this.pin.verify(userId, input.pin);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true }
    });
    if (!ALLOWED_TIERS.has(user.tier)) {
      throw new HttpException("kyc tier 1 required for withdrawal", HttpStatus.FORBIDDEN);
    }

    const account = await this.resolveDestination(userId, input.payoutAccountId);
    if (!payoutNameMatches(user.profile ?? {}, account.accountName)) {
      throw new HttpException("payout account not verified", HttpStatus.FORBIDDEN);
    }

    const begin = await this.withdrawals.requestWithdrawal({
      userId,
      payoutAccountId: account.id,
      amountKobo: input.amountKobo,
      feeKobo: WITHDRAWAL_FEE_KOBO,
      idempotencyKey
    });

    if (begin.alreadyExisted) {
      return this.viewOf(begin.withdrawalId, account);
    }

    let transfer: TransferResult;
    try {
      transfer = await this.provider.transferToBank(
        this.crypto.decryptAccountNumber(account.accountNumberEnc),
        account.accountName,
        account.bankCode,
        begin.netKobo,
        begin.merchantTxRef,
        SENDER_NAME
      );
    } catch (error) {
      this.logger.error(`withdrawal transfer dispatch failed for ${begin.withdrawalId}`, error as Error);
      await this.withdrawals.markPending(begin.withdrawalId, {
        nombaRef: null,
        providerStatus: "PENDING_BILLING"
      });
      await this.enqueueConfirm(begin.withdrawalId);
      return this.viewOf(begin.withdrawalId, account);
    }

    const nombaRef = transfer.transferId ?? transfer.reference;

    if (transfer.status === "success") {
      await this.withdrawals.confirmWithdrawal(begin.withdrawalId, {
        nombaRef,
        providerStatus: transfer.status
      });
      return this.viewOf(begin.withdrawalId, account);
    }

    await this.withdrawals.markPending(begin.withdrawalId, {
      nombaRef,
      providerStatus: "PENDING_BILLING"
    });
    await this.enqueueConfirm(begin.withdrawalId);
    return this.viewOf(begin.withdrawalId, account);
  }

  async confirmWithdrawal(withdrawalId: string, nombaRef: string | null): Promise<void> {
    await this.withdrawals.confirmWithdrawal(withdrawalId, { nombaRef, providerStatus: "SUCCESS" });
  }

  async reverseWithdrawal(withdrawalId: string, reason: SettlementFailureReason): Promise<void> {
    await this.withdrawals.reverseWithdrawal(withdrawalId, reason);
  }

  async getWithdrawal(userId: string, withdrawalId: string): Promise<WithdrawalView> {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (withdrawal === null || withdrawal.userId !== userId) {
      throw new HttpException("withdrawal not found", HttpStatus.NOT_FOUND);
    }
    const account = await this.payoutAccounts.findById(withdrawal.payoutAccountId);
    if (account === null) {
      throw new HttpException("withdrawal not found", HttpStatus.NOT_FOUND);
    }
    return this.viewOf(withdrawalId, account);
  }

  private async resolveDestination(
    userId: string,
    payoutAccountId: string | undefined
  ): Promise<PayoutAccount> {
    const accounts = await this.payoutAccounts.listForUser(userId);
    if (accounts.length === 0) {
      throw new HttpException("no payout account", HttpStatus.BAD_REQUEST);
    }
    const account =
      payoutAccountId === undefined
        ? accounts.find((candidate) => candidate.isPrimary) ?? null
        : accounts.find((candidate) => candidate.id === payoutAccountId) ?? null;
    if (account === null || account.userId !== userId || !account.nameMatchVerified) {
      throw new HttpException("payout account not verified", HttpStatus.FORBIDDEN);
    }
    return account;
  }

  private async viewOf(withdrawalId: string, account: PayoutAccount): Promise<WithdrawalView> {
    const withdrawal = await this.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    return {
      id: withdrawal.id,
      status: withdrawal.status.toLowerCase() as WithdrawalView["status"],
      amountKobo: Number(withdrawal.amountKobo),
      feeKobo: Number(withdrawal.feeKobo),
      nombaRef: withdrawal.nombaRef,
      providerStatus: withdrawal.providerStatus,
      failureReason: (withdrawal.failureReason as WithdrawalView["failureReason"]) ?? null,
      destination: {
        bankName: account.bankName,
        accountNumberLast4: account.accountNumberLast4,
        accountName: account.accountName
      },
      createdAt: withdrawal.createdAt.toISOString(),
      completedAt: withdrawal.completedAt ? withdrawal.completedAt.toISOString() : null
    };
  }

  private async enqueueConfirm(withdrawalId: string): Promise<void> {
    const job: WithdrawalConfirmJob = { kind: "withdrawal", id: withdrawalId };
    await this.payoutConfirm.add(CONFIRM_JOB_NAME, job);
  }
}
