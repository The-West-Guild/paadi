import { Money } from "@paadi/domain";
import { NombaWebhookBody } from "../../webhooks/nomba-webhook.types";

export interface MappedVirtualAccountCredit {
  aliasAccountNumber: string | null;
  transactionId: string | null;
  amountKobo: number;
  aliasAccountType: string | null;
  senderName: string | null;
  senderAccount: string | null;
  senderBank: string | null;
  senderBankCode: string | null;
}

function toAmountKobo(transactionAmount?: string | number | null): number {
  if (transactionAmount === null || transactionAmount === undefined || transactionAmount === "") {
    return 0;
  }
  const naira = Number(transactionAmount);
  if (!Number.isFinite(naira) || naira < 0) {
    return 0;
  }
  return Money.fromNaira(naira).kobo;
}

export function mapVirtualAccountCredit(body: NombaWebhookBody): MappedVirtualAccountCredit {
  const transaction = body.data?.transaction;
  const customer = body.data?.customer;
  return {
    aliasAccountNumber: transaction?.aliasAccountNumber ?? null,
    transactionId: transaction?.transactionId ?? null,
    amountKobo: toAmountKobo(transaction?.transactionAmount),
    aliasAccountType: transaction?.aliasAccountType ?? null,
    senderName: customer?.senderName ?? null,
    senderAccount: customer?.accountNumber ?? null,
    senderBank: customer?.bankName ?? null,
    senderBankCode: customer?.bankCode ?? null
  };
}
