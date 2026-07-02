import { Money, TransactionStatus } from "@paadi/domain";
import { PaymentMethod } from "@paadi/contracts";
import { NombaWebhookBody } from "../../../webhooks/nomba-webhook.types";

export interface RequeryTransferDetails {
  originatorAccountName?: string | null;
  originatorAccountNumber?: string | null;
  bankName?: string | null;
}

export interface PaymentRequery extends TransactionStatus {
  transferDetails?: RequeryTransferDetails | null;
}

export interface MappedPayment {
  amountKobo: number;
  method: PaymentMethod;
  senderName: string | null;
  senderAccount: string | null;
  senderBank: string | null;
}

export function mapPaymentMethod(paymentMethod?: string): PaymentMethod {
  switch ((paymentMethod ?? "").toLowerCase()) {
    case "card_payment":
      return PaymentMethod.Card;
    case "bank_transfer":
      return PaymentMethod.Transfer;
    case "ussd":
      return PaymentMethod.Ussd;
    default:
      return PaymentMethod.Transfer;
  }
}

export function mapWebhookToPayment(body: NombaWebhookBody, requery?: PaymentRequery): MappedPayment {
  const naira = body.data?.order?.amount ?? body.data?.transaction?.transactionAmount;
  const amountKobo = Money.fromNaira(Number(naira)).kobo;
  const details = requery?.transferDetails ?? null;
  return {
    amountKobo,
    method: mapPaymentMethod(body.data?.order?.paymentMethod),
    senderName: details?.originatorAccountName ?? null,
    senderAccount: details?.originatorAccountNumber ?? null,
    senderBank: details?.bankName ?? null
  };
}

export function toAmountKoboBigInt(amountKobo: number): bigint {
  return BigInt(amountKobo);
}

export function fromAmountKoboBigInt(amountKobo: bigint): number {
  return Number(amountKobo);
}
