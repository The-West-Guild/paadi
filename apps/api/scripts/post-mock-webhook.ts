import { randomUUID } from "node:crypto";
import { buildSignedNombaWebhook } from "../src/integrations/nomba/dev/sign-nomba-webhook";

function readArg(...names: string[]): string | undefined {
  for (const name of names) {
    const prefix = `--${name}=`;
    const match = process.argv.find((value) => value.startsWith(prefix));
    if (match) {
      return match.slice(prefix.length);
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const orderReference = readArg("orderRef", "orderReference");
  const amountKobo = Number(readArg("amount") ?? "0");
  const signingKey = process.env.NOMBA_WEBHOOK_SIGNING_KEY ?? "";
  const target = process.env.NOMBA_WEBHOOK_URL ?? "http://localhost:3001/webhooks/nomba";

  if (!orderReference) {
    throw new Error("usage: pnpm tsx apps/api/scripts/post-mock-webhook.ts --orderRef=<ref> --amount=<kobo>");
  }
  if (signingKey.length === 0) {
    throw new Error("NOMBA_WEBHOOK_SIGNING_KEY must be set to sign the synthetic webhook");
  }

  const timestamp = new Date().toISOString();
  const amountNaira = (amountKobo / 100).toFixed(2);
  const payload = {
    event_type: "payment_success",
    requestId: randomUUID(),
    data: {
      merchant: { userId: "mock-user", walletId: "mock-wallet" },
      transaction: {
        transactionId: `mock-txn-${orderReference}`,
        type: "online_checkout",
        time: timestamp,
        responseCode: "00",
        merchantTxRef: orderReference,
        orderReference,
        amount: amountNaira
      },
      order: { orderReference, amount: amountNaira }
    }
  };

  const { body, signature } = buildSignedNombaWebhook(payload, timestamp, signingKey);
  const response = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "nomba-signature": signature,
      "nomba-timestamp": timestamp
    },
    body
  });
  const text = await response.text();
  process.stdout.write(`${response.status} ${text}\n`);
  if (!response.ok) {
    process.exitCode = 1;
  }
}

void main();
