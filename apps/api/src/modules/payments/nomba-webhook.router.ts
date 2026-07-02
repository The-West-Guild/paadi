import { Injectable, Logger } from "@nestjs/common";
import { NombaWebhookBody } from "../../webhooks/nomba-webhook.types";
import { mapWebhookToPayment } from "../../infra/persistence/mappers/payment.mapper";
import {
  IngestPaymentResult,
  PaymentIngestionRepository
} from "../../infra/persistence/payment-ingestion.repository";
import { CheckoutPaymentHandler, IngestionEvent } from "./checkout-payment.handler";
import { VirtualAccountCreditHandler } from "./virtual-account-credit.handler";

@Injectable()
export class NombaWebhookRouter {
  private readonly logger = new Logger(NombaWebhookRouter.name);

  constructor(
    private readonly checkout: CheckoutPaymentHandler,
    private readonly virtualAccount: VirtualAccountCreditHandler,
    private readonly ingestion: PaymentIngestionRepository
  ) {}

  route(event: IngestionEvent, body: NombaWebhookBody): Promise<IngestPaymentResult> {
    const type = (body.data?.transaction?.type ?? "").toLowerCase();
    if (type === "online_checkout") {
      return this.checkout.handle(event, body);
    }
    if (type === "vact_transfer") {
      return this.virtualAccount.handle(event, body);
    }
    return this.parkUnknown(event, body);
  }

  private parkUnknown(event: IngestionEvent, body: NombaWebhookBody): Promise<IngestPaymentResult> {
    this.logger.warn(`unhandled webhook transaction type for event ${event.id}`);
    const mapped = mapWebhookToPayment(body);
    return this.ingestion.ingest({
      webhookEventInId: event.id,
      nombaTransactionId: body.data?.transaction?.transactionId ?? "",
      splitId: null,
      potId: null,
      amountKobo: mapped.amountKobo,
      method: mapped.method,
      senderName: mapped.senderName,
      senderAccount: mapped.senderAccount,
      senderBank: mapped.senderBank
    });
  }
}
