import { Injectable, Logger } from "@nestjs/common";
import { OtpChannel, OtpProvider } from "@paadi/domain";

@Injectable()
export class ConsoleOtpProvider extends OtpProvider {
  private readonly logger = new Logger(ConsoleOtpProvider.name);

  async send(channel: OtpChannel, target: string, code: string): Promise<{ reference: string }> {
    this.logger.warn(`[DEV OTP] -> ${target} (${channel}): ${code}`);
    return { reference: `dev-${code}` };
  }
}
