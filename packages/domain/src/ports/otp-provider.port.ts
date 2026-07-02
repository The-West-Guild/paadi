export type OtpChannel = "sms" | "whatsapp" | "email";

export abstract class OtpProvider {
  abstract send(channel: OtpChannel, target: string, code: string): Promise<{ reference: string }>;
}
