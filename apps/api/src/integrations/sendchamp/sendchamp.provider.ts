import { Injectable } from "@nestjs/common";
import { OtpChannel, OtpProvider } from "@paadi/domain";
import { SendchampClient } from "./sendchamp.client";

@Injectable()
export class SendchampOtpProvider extends OtpProvider {
  constructor(private readonly client: SendchampClient) {
    super();
  }

  send(channel: OtpChannel, target: string, code: string): Promise<{ reference: string }> {
    return this.client.sendOtp(channel, target, code);
  }
}
