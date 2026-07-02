export interface WebhookDeliveryResult {
  statusCode: number;
  ok: boolean;
}

export abstract class WebhookDeliveryPort {
  abstract deliver(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<WebhookDeliveryResult>;
}
