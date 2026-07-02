export const OtpChannel = {
  Sms: "sms",
  WhatsApp: "whatsapp",
  Email: "email"
} as const;
export type OtpChannel = (typeof OtpChannel)[keyof typeof OtpChannel];
