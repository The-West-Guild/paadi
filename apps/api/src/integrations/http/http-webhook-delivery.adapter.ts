import { Injectable } from "@nestjs/common";
import { WebhookDeliveryPort, WebhookDeliveryResult } from "@paadi/domain";

const DELIVERY_TIMEOUT_MS = 10_000;
const NETWORK_FAILURE_STATUS = 0;

@Injectable()
export class HttpWebhookDeliveryAdapter extends WebhookDeliveryPort {
  async deliver(
    url: string,
    headers: Record<string, string>,
    body: string
  ): Promise<WebhookDeliveryResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
        signal: controller.signal
      });
      return { statusCode: response.status, ok: response.ok };
    } catch {
      return { statusCode: NETWORK_FAILURE_STATUS, ok: false };
    } finally {
      clearTimeout(timer);
    }
  }
}
