export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export abstract class PushProvider {
  abstract send(pushToken: string, payload: PushPayload): Promise<{ delivered: boolean }>;
}