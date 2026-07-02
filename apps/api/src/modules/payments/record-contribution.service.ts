import { Injectable } from "@nestjs/common";
import { PaymentMethod } from "@paadi/contracts";
import {
  IngestPaymentResult,
  PaymentIngestionRepository
} from "../../infra/persistence/payment-ingestion.repository";

export type ContributionSource = "checkout" | "wallet";

export interface ContributionSender {
  senderName: string | null;
  senderAccount: string | null;
  senderBank: string | null;
}

export interface RecordContributionInput {
  source: ContributionSource;
  webhookEventInId: string;
  nombaTransactionId: string;
  splitId: string | null;
  potId: string | null;
  amountKobo: number;
  method: PaymentMethod;
  sender?: ContributionSender;
}

@Injectable()
export class RecordContributionService {
  constructor(private readonly ingestion: PaymentIngestionRepository) {}

  recordContribution(input: RecordContributionInput): Promise<IngestPaymentResult> {
    return this.ingestion.ingest({
      webhookEventInId: input.webhookEventInId,
      nombaTransactionId: input.nombaTransactionId,
      splitId: input.splitId,
      potId: input.potId,
      amountKobo: input.amountKobo,
      method: input.method,
      senderName: input.sender?.senderName ?? null,
      senderAccount: input.sender?.senderAccount ?? null,
      senderBank: input.sender?.senderBank ?? null
    });
  }
}
