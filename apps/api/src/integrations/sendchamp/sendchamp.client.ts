import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OtpChannel } from "@paadi/domain";
import { randomUUID } from "node:crypto";

@Injectable()
export class SendchampClient {
  constructor(private readonly config: ConfigService) {}

  sendOtp(channel: OtpChannel, target: string, code: string): Promise<{ reference: string }> {
    if (channel === "email") {
      return this.sendEmail(target, code);
    }
    return this.sendSms(target, `Your Paadi verification code is ${code}. It expires in 5 minutes.`);
  }

  private sendSms(target: string, message: string): Promise<{ reference: string }> {
    return this.post("/sms/send", {
      to: [target.replace(/^\+/, "")],
      message,
      sender_name: this.config.get<string>("sendchamp.sender"),
      route: "dnd"
    });
  }

  private sendEmail(target: string, code: string): Promise<{ reference: string }> {
    return this.post("/email/send", {
      to: [{ email: target, name: target }],
      from: {
        email: this.config.get<string>("sendchamp.senderEmail") ?? "",
        name: this.config.get<string>("sendchamp.sender")
      },
      subject: "Your Paadi verification code",
      message_body: {
        type: "text/html",
        value: `Your Paadi verification code is <b>${code}</b>. It expires in 5 minutes.`
      }
    });
  }

  private async post(path: string, body: unknown): Promise<{ reference: string }> {
    const response = await fetch(`${this.config.get<string>("sendchamp.baseUrl")}/api/v1${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.get<string>("sendchamp.apiKey")}`,
        Accept: "application/json,version=1.0.0",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = (await response.json()) as {
      status?: string;
      message?: string;
      data?: { reference?: string; id?: string; business_uid?: string };
    };
    if (!response.ok || payload.status === "error") {
      throw new HttpException(`Sendchamp ${path} failed: ${payload.message ?? response.status}`, HttpStatus.BAD_GATEWAY);
    }
    return {
      reference: payload.data?.reference ?? payload.data?.id ?? payload.data?.business_uid ?? randomUUID()
    };
  }
}
