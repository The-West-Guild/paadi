import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class TwilioClient {
  private readonly logger = new Logger(TwilioClient.name);

  async sendSms(target: string, message: string): Promise<{ delivered: boolean }> {
    this.logger.warn(`[DEV TWILIO SMS] -> ${target}: ${message}`);
    return { delivered: true };
  }

  async sendWhatsapp(target: string, message: string): Promise<{ delivered: boolean }> {
    this.logger.warn(`[DEV TWILIO WHATSAPP] -> ${target}: ${message}`);
    return { delivered: true };
  }
}