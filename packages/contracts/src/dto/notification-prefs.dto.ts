import { z } from "zod";

export const notificationPreferenceSchema = z.object({
  event: z.string(),
  channel: z.enum(["PUSH", "SMS", "WHATSAPP"]),
  enabled: z.boolean()
});

export const updateNotificationPrefsSchema = z.object({
  preferences: z.array(notificationPreferenceSchema)
});

export const notificationPrefsResponseSchema = z.object({
  preferences: z.array(notificationPreferenceSchema)
});

export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceSchema>;
export type UpdateNotificationPrefsInput = z.infer<typeof updateNotificationPrefsSchema>;
export type NotificationPrefsResponse = z.infer<typeof notificationPrefsResponseSchema>;
