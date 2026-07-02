import { ApiError } from "./error";

/**
 * Contract for the "notifications" tag. Bearer-authenticated, same caveat
 * as me.ts — these fixtures don't check the token themselves.
 *
 * Important shape detail: PUT /me/notification-preferences takes the
 * ENTIRE preferences array, not a single toggle. There's no "update one
 * preference" endpoint. Whatever calls updateNotificationPreferences must
 * send back the full list with one (or more) entries changed — losing
 * rows here means silently disabling notification types the user never
 * touched. hooks.ts and the screen built on it both need to respect this.
 */

export type NotificationEvent =
  | "NEW_CONTRIBUTION"
  | "POT_SETTLED"
  | "PAYOUT_ALERT"
  | "NEW_LOGIN"
  | "ORGANIZER_REMINDER"
  | "FRIEND_REQUEST";

export type NotificationChannel = "PUSH" | "SMS" | "WHATSAPP";

export type NotificationPreference = {
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
};

export type NotificationPrefsResponse = {
  preferences: NotificationPreference[];
};

export type NotificationsApi = {
  getNotificationPreferences: () => Promise<NotificationPrefsResponse>;
  updateNotificationPreferences: (
    preferences: NotificationPreference[]
  ) => Promise<NotificationPrefsResponse>;
};

// ---- fixture implementation ----
// TEMPORARY — delete once @paadi/api-client ships a real NotificationsApi.

const FAKE_LATENCY_MS = 400;
function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), FAKE_LATENCY_MS));
}

const ALL_EVENTS: NotificationEvent[] = [
  "NEW_CONTRIBUTION",
  "POT_SETTLED",
  "PAYOUT_ALERT",
  "NEW_LOGIN",
  "ORGANIZER_REMINDER",
  "FRIEND_REQUEST",
];

// fake current preferences — one row per event, defaulted to PUSH/enabled.
// Real backend likely seeds something similar per-user on signup.
let fakePreferences: NotificationPreference[] = ALL_EVENTS.map((event) => ({
  event,
  channel: "PUSH" as const,
  enabled: true,
}));

export const fixtureNotificationsApi: NotificationsApi = {
  async getNotificationPreferences() {
    return delay({ preferences: fakePreferences });
  },

  async updateNotificationPreferences(preferences) {
    if (!Array.isArray(preferences) || preferences.length === 0) {
      throw new ApiError({
        message: "Validation failed",
        issues: [{ path: "preferences", message: "must be a non-empty array" }],
      });
    }
    fakePreferences = preferences;
    return delay({ preferences: fakePreferences });
  },
};