import { Injectable, Logger } from "@nestjs/common";
import { PushPayload, PushProvider } from "@paadi/domain";

@Injectable()
export class ConsolePushProvider extends PushProvider {
  private readonly logger = new Logger(ConsolePushProvider.name);

  async send(pushToken: string, payload: PushPayload): Promise<{ delivered: boolean }> {
    this.logger.warn(`[DEV PUSH] -> ${pushToken}: ${payload.title} — ${payload.body}`);
    return { delivered: true };
  }
}