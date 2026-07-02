import { NotificationChannel, NotificationEvent } from "@paadi/db";

interface NotificationDefault {
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationDefault[] = [
  { event: NotificationEvent.NEW_CONTRIBUTION, channel: NotificationChannel.PUSH, enabled: true },
  { event: NotificationEvent.NEW_CONTRIBUTION, channel: NotificationChannel.SMS, enabled: false },
  { event: NotificationEvent.NEW_CONTRIBUTION, channel: NotificationChannel.WHATSAPP, enabled: false },
  { event: NotificationEvent.POT_SETTLED, channel: NotificationChannel.PUSH, enabled: true },
  { event: NotificationEvent.POT_SETTLED, channel: NotificationChannel.WHATSAPP, enabled: true },
  { event: NotificationEvent.POT_SETTLED, channel: NotificationChannel.SMS, enabled: false },
  { event: NotificationEvent.PAYOUT_ALERT, channel: NotificationChannel.PUSH, enabled: true },
  { event: NotificationEvent.PAYOUT_ALERT, channel: NotificationChannel.SMS, enabled: true },
  { event: NotificationEvent.PAYOUT_ALERT, channel: NotificationChannel.WHATSAPP, enabled: false },
  { event: NotificationEvent.NEW_LOGIN, channel: NotificationChannel.PUSH, enabled: true },
  { event: NotificationEvent.NEW_LOGIN, channel: NotificationChannel.SMS, enabled: false },
  { event: NotificationEvent.NEW_LOGIN, channel: NotificationChannel.WHATSAPP, enabled: false },
  { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.PUSH, enabled: true },
  { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.WHATSAPP, enabled: true },
  { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.SMS, enabled: false },
  { event: NotificationEvent.FRIEND_REQUEST, channel: NotificationChannel.PUSH, enabled: true },
  { event: NotificationEvent.FRIEND_REQUEST, channel: NotificationChannel.SMS, enabled: false },
  { event: NotificationEvent.FRIEND_REQUEST, channel: NotificationChannel.WHATSAPP, enabled: false }
];
