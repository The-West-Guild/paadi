import { computeNombaSignature } from "../../../common/crypto/hmac";

export interface SignableNombaWebhook {
  event_type: string;
  requestId: string;
  data: unknown;
}

export interface SignedNombaWebhook {
  body: string;
  signature: string;
}

export function buildSignedNombaWebhook(
  payload: SignableNombaWebhook,
  timestamp: string,
  signingKey: string
): SignedNombaWebhook {
  const data = payload.data as {
    merchant?: Record<string, string>;
    transaction?: Record<string, string>;
  };
  const merchant = data.merchant ?? {};
  const transaction = data.transaction ?? {};
  const responseCode = transaction.responseCode;
  const signingString = [
    payload.event_type,
    payload.requestId,
    merchant.userId ?? "",
    merchant.walletId ?? "",
    transaction.transactionId ?? "",
    transaction.type ?? "",
    transaction.time ?? "",
    responseCode === "null" || responseCode === undefined ? "" : responseCode,
    timestamp
  ].join(":");
  return {
    body: JSON.stringify(payload),
    signature: computeNombaSignature(signingString, signingKey)
  };
}
