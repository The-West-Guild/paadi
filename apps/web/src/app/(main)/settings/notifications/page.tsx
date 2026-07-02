"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNotificationPrefs, useUpdateNotificationPrefs } from "@/features/settings/notifications-hooks"; // Adjust path as needed
import { NotificationEvent, NotificationChannel, NotificationPreference } from "@/lib/api/notifications";
import { ChevronLeft, Loader2, BellRing } from "lucide-react";

// Beautiful user-facing translation layer to convert screaming backend string types into clear, human copy
const EVENT_LABELS: Record<NotificationEvent, { title: string; description: string }> = {
  NEW_CONTRIBUTION: {
    title: "New Contribution",
    description: "When someone drops cash into a pot you're in.",
  },
  POT_SETTLED: {
    title: "Pot Settled",
    description: "Alert me the exact second a money group payout hits.",
  },
  PAYOUT_ALERT: {
    title: "Payout Status",
    description: "Instant verification alerts for bank payout logs.",
  },
  NEW_LOGIN: {
    title: "Account Security",
    description: "Get notified immediately if a new device logs into your profile.",
  },
  ORGANIZER_REMINDER: {
    title: "Organizer Reminders",
    description: "Nudges from group organizers when payment deadlines approach.",
  },
  FRIEND_REQUEST: {
    title: "Paadi Requests",
    description: "When someone adds your username to their active circles.",
  },
};

export default function NotificationsPage() {
  const router = useRouter();
  const { data, isPending, error } = useNotificationPrefs();
  const updateMutation = useUpdateNotificationPrefs();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // The critical mutation helper: safely swaps one row while preserving everything else
  function handleToggleChannel(
    targetEvent: NotificationEvent,
    channel: NotificationChannel,
    currentStatus: boolean
  ) {
    if (!data?.preferences) return;
    setPendingKey(`${targetEvent}:${channel}`);
  
    const atomicPayload = data.preferences.map((row) =>
      row.event === targetEvent && row.channel === channel
        ? { ...row, enabled: !currentStatus }
        : row
    );
  
    updateMutation.mutate(atomicPayload, { onSettled: () => setPendingKey(null) });
  }

  return (
    <div className="w-full flex flex-col">
      {/* HEADER BAR */}
      <div className="flex items-center gap-2 mb-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-1.5 rounded-lg hover:bg-ink/5 text-ink/60 transition-colors mr-1"
        >
          <ChevronLeft className="h-5 w-5 stroke-[2.5]" />
        </button>
        <h1 className="text-2xl font-black text-ink tracking-tight">Notifications</h1>
      </div>

      {/* ERROR FRAME */}
      {error && !isPending && (
        <div className="rounded-2xl border-2 border-danger/20 bg-danger/5 p-4 text-center mb-4">
          <p className="text-xs font-bold text-danger">
            ❌ Failed to fetch preferences. Swipe down or return later.
          </p>
        </div>
      )}

      {/* DYNAMIC LIST LAYER */}
      <div className="flex flex-col gap-4">
        {isPending ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-6 w-6 text-secondary animate-spin stroke-[2.5]" />
            <p className="text-xs font-bold text-ink/40">Loading preferences...</p>
          </div>
        ) : (
          data?.preferences.map((pref) => {
            const copy = EVENT_LABELS[pref.event] || {
              title: pref.event.replace("_", " "),
              description: "System channel configuration events.",
            };

            return (
              <div
                key={pref.event}
                className="rounded-2xl border border-slate-100 bg-white p-4.5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex items-center justify-between gap-4 transition-all"
              >
                {/* Text Block Content */}
                <div className="flex flex-col gap-1 min-w-0">
                  <h3 className="text-sm font-black text-ink/90 leading-tight">
                    {copy.title}
                  </h3>
                  <p className="text-xs font-semibold text-ink/40 leading-normal pr-2">
                    {copy.description}
                  </p>
                </div>

                {/* Custom Soft Brutalist Toggle Switch Component */}
                <button
  type="button"
  disabled={pendingKey === `${pref.event}:${pref.channel}`}
  onClick={() => handleToggleChannel(pref.event, pref.channel, pref.enabled)}
  className={`w-12 h-7 rounded-full border-2 border-ink transition-all relative shrink-0 outline-none ${
    pref.enabled 
      ? "bg-primary shadow-[1px_1px_0px_0px_#111827]" 
      : "bg-slate-100 shadow-none"
  }`}
>
  <div
    className={`absolute top-[3px] w-4 h-4 rounded-full border border-ink bg-white transition-all ${
      pref.enabled 
        ? "left-[22px] shadow-none" 
        : "left-[4px]"
    }`}
  />
</button>
              </div>
            );
          })
        )}
      </div>

      {/* CONTEXT INFORMATION CARD */}
      {!isPending && !error && (
        <div className="mt-8 rounded-2xl border-2 border-dashed border-ink/10 p-4 flex items-start gap-3 bg-slate-50/50">
          <BellRing className="h-5 w-5 text-ink/40 shrink-0 mt-0.5" />
          <p className="text-[11px] font-medium text-ink/50 leading-relaxed">
            By default, Paadi routes high-priority alerts via PUSH to maintain secure wallet status verification. Channels like SMS and WhatsApp settings can be localized further down the stream.
          </p>
        </div>
      )}
    </div>
  );
}