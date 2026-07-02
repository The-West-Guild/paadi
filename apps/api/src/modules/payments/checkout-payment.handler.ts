import { Injectable, Logger } from "@nestjs/common";
import { PaymentRecordStatus } from "@paadi/contracts";
import { PaymentProviderPort } from "@paadi/domain";
import { PrismaService } from "@paadi/db";
import { NombaWebhookBody } from "../../webhooks/nomba-webhook.types";
import { mapWebhookToPayment } from "../../infra/persistence/mappers/payment.mapper";
import {
  IngestPaymentInput,
  IngestPaymentResult,
  PaymentIngestionRepository
} from "../../infra/persistence/payment-ingestion.repository";
import { RecordContributionService } from "./record-contribution.service";

export interface IngestionEvent {
  id: string;
}

@Injectable()
export class CheckoutPaymentHandler {
  private readonly logger = new Logger(CheckoutPaymentHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProviderPort,
    private readonly contributions: RecordContributionService,
    private readonly ingestion: PaymentIngestionRepository
  ) {}

  async handle(event: IngestionEvent, body: NombaWebhookBody): Promise<IngestPaymentResult> {
    const orderReference = body.data?.order?.orderReference ?? null;
    const transactionId = body.data?.transaction?.transactionId ?? "";

    const requery = orderReference
      ? await this.provider.verifyTransaction(orderReference)
      : await this.provider.verifyTransactionById(transactionId);
    const resolvedRef = orderReference ?? requery.reference;

    if (!requery.success) {
      this.logger.warn(`requery denied success for event ${event.id}`);
      return this.parkProcessed(event.id, PaymentRecordStatus.Unconfirmed);
    }

    const mapped = mapWebhookToPayment(body, requery);
    if (!Number.isFinite(mapped.amountKobo) || mapped.amountKobo <= 0) {
      throw new Error(`unreadable amount for event ${event.id}`);
    }

    const split = resolvedRef
      ? await this.prisma.split.findUnique({ where: { checkoutOrderRef: resolvedRef } })
      : null;

    const currency = body.data?.order?.currency;
    if (currency && currency.toUpperCase() !== "NGN") {
      this.logger.warn(`non-ngn currency ${currency} for event ${event.id}`);
      return this.ingestion.ingestSuspense(
        this.parkInput(event.id, transactionId, split?.potId ?? null, mapped),
        PaymentRecordStatus.AmountMismatch
      );
    }

    if (requery.amountKobo > 0 && requery.amountKobo !== mapped.amountKobo) {
      this.logger.warn(`requery amount mismatch for event ${event.id}`);
      return this.ingestion.ingestSuspense(
        this.parkInput(event.id, transactionId, split?.potId ?? null, mapped),
        PaymentRecordStatus.AmountMismatch
      );
    }

    return this.contributions.recordContribution({
      source: "checkout",
      webhookEventInId: event.id,
      nombaTransactionId: transactionId,
      splitId: split?.id ?? null,
      potId: split?.potId ?? null,
      amountKobo: mapped.amountKobo,
      method: mapped.method,
      sender: {
        senderName: mapped.senderName,
        senderAccount: mapped.senderAccount,
        senderBank: mapped.senderBank
      }
    });
  }

  private parkInput(
    webhookEventInId: string,
    nombaTransactionId: string,
    potId: string | null,
    mapped: ReturnType<typeof mapWebhookToPayment>
  ): IngestPaymentInput {
    return {
      webhookEventInId,
      nombaTransactionId,
      splitId: null,
      potId,
      amountKobo: mapped.amountKobo,
      method: mapped.method,
      senderName: mapped.senderName,
      senderAccount: mapped.senderAccount,
      senderBank: mapped.senderBank
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
