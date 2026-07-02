import { Inject, Injectable, Logger } from "@nestjs/common";
import { ExceptionReason, PaymentRecordStatus } from "@paadi/contracts";
import { PaymentProviderPort } from "@paadi/domain";
import { PrismaService, VirtualAccountStatus } from "@paadi/db";
import { NombaWebhookBody } from "../../webhooks/nomba-webhook.types";
import { IngestPaymentResult } from "../../infra/persistence/payment-ingestion.repository";
import {
  CreditWalletResult,
  RecordUnmatchedInput,
  RecordUnmatchedResult,
  WalletCreditRepository
} from "../../infra/persistence/wallet-credit.repository";
import { VirtualAccountRepository } from "../../infra/persistence/virtual-account.repository";
import { MappedVirtualAccountCredit, mapVirtualAccountCredit } from "./virtual-account-credit.mapper";
import { IngestionEvent } from "./checkout-payment.handler";

@Injectable()
export class VirtualAccountCreditHandler {
  private readonly logger = new Logger(VirtualAccountCreditHandler.name);

  constructor(
    @Inject(PaymentProviderPort) private readonly provider: PaymentProviderPort,
    private readonly prisma: PrismaService,
    private readonly wallet: WalletCreditRepository,
    private readonly virtualAccounts: VirtualAccountRepository
  ) {}

  async handle(event: IngestionEvent, body: NombaWebhookBody): Promise<IngestPaymentResult> {
    const mapped = mapVirtualAccountCredit(body);

    if (!Number.isFinite(mapped.amountKobo) || mapped.amountKobo <= 0) {
      throw new Error(`unreadable amount for event ${event.id}`);
    }

    const transactionId = mapped.transactionId ?? "";
    const requery = await this.provider.verifyTransactionById(transactionId);

    if (!requery.success) {
      this.logger.warn(`requery denied success for event ${event.id}`);
      return this.parkProcessed(event.id, PaymentRecordStatus.Unconfirmed);
    }

    if (requery.amountKobo > 0 && requery.amountKobo !== mapped.amountKobo) {
      this.logger.warn(`requery amount mismatch for event ${event.id}`);
      const unmatched = await this.wallet.recordUnmatched(
        this.buildUnmatchedInput(event.id, transactionId, mapped, PaymentRecordStatus.AmountMismatch)
      );
      return this.toUnmatchedResult(unmatched, PaymentRecordStatus.AmountMismatch);
    }

    const virtualAccount = mapped.aliasAccountNumber
      ? await this.virtualAccounts.findByAccountNumber(mapped.aliasAccountNumber)
      : null;

    if (!virtualAccount) {
      this.logger.warn(`unknown virtual account for event ${event.id}`);
      const unmatched = await this.wallet.recordUnmatched(
        this.buildUnmatchedInput(event.id, transactionId, mapped, ExceptionReason.UnknownAccount)
      );
      return this.toUnmatchedResult(unmatched, PaymentRecordStatus.Unmatched);
    }

    if (virtualAccount.status !== VirtualAccountStatus.ACTIVE) {
      this.logger.warn(`inactive virtual account for event ${event.id}`);
      const unmatched = await this.wallet.recordUnmatched(
        this.buildUnmatchedInput(event.id, transactionId, mapped, ExceptionReason.ClosedAccount)
      );
      return this.toUnmatchedResult(unmatched, PaymentRecordStatus.Unmatched);
    }

    const credited = await this.wallet.creditWallet({
      userId: virtualAccount.userId,
      virtualAccountId: virtualAccount.id,
      nombaTransactionId: transactionId,
      amountKobo: mapped.amountKobo,
      senderName: mapped.senderName,
      senderAccount: mapped.senderAccount,
      senderBank: mapped.senderBank,
      senderBankCode: mapped.senderBankCode,
      rawEventId: event.id
    });

    return this.toCreditResult(credited);
  }

  private toCreditResult(result: CreditWalletResult): IngestPaymentResult {
    return {
      status: PaymentRecordStatus.Succeeded,
      paymentId: result.walletCreditId,
      potId: null,
      splitId: null,
      attributedKobo: result.alreadyProcessed ? 0 : result.amountKobo,
      excessKobo: 0,
      funded: false,
      alreadyProcessed: result.alreadyProcessed
    };
  }

  private buildUnmatchedInput(
    webhookEventInId: string,
    nombaTransactionId: string,
    mapped: MappedVirtualAccountCredit,
    reason: ExceptionReason | PaymentRecordStatus
  ): RecordUnmatchedInput {
    return {
      webhookEventInId,
      accountNumber: mapped.aliasAccountNumber,
      nombaTransactionId,
      amountKobo: mapped.amountKobo,
      reason,
      senderName: mapped.senderName,
      senderAccount: mapped.senderAccount,
      senderBank: mapped.senderBank
    };
  }

  private toUnmatchedResult(
    result: RecordUnmatchedResult,
    status: PaymentRecordStatus
  ): IngestPaymentResult {
    return {
      status,
      paymentId: null,
      potId: null,
      splitId: null,
      attributedKobo: 0,
      excessKobo: result.amountKobo,
      funded: false,
      alreadyProcessed: false
    };
  }

  private async parkProcessed(
    webhookEventInId: string,
    status: PaymentRecordStatus
  ): Promise<IngestPaymentResult> {
    await this.prisma.webhookEventIn.update({
      where: { id: webhookEventInId },
      data: { processedAt: new Date() }
    });
    return {
      status,
      paymentId: null,
      potId: null,
      splitId: null,
      attributedKobo: 0,
      excessKobo: 0,
      funded: false,
      alreadyProcessed: false
    };
  }
}
