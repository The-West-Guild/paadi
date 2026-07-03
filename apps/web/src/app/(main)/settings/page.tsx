"use client";

import { useRouter } from "next/navigation";
import { useMe, useLogout } from "@/features/settings/profile-hooks";
import { ChevronRight, User, Lock, Wallet, Bell, LogOut, Loader2 } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const { data, isPending, error } = useMe();
  const logoutMutation = useLogout();

  const menuItems = [
    { label: "Profile", icon: User, href: "/settings/profile" },
    { label: "Security & PIN", icon: Lock, href: "/settings/security" },
    { label: "Payout accounts", icon: Wallet, href: "/settings/payout" },
    { label: "Notifications", icon: Bell, href: "/settings/notifications" },
  ];

  function handleLogOut() {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        router.push("/login");
      },
      onError: () => {
        router.push("/login");
      }
    });
  }


  return (
    <div className="w-full flex flex-col">
      {/* HEADER BAR */}
      <h1 className="text-2xl font-black text-ink tracking-tight">Settings</h1>

      {/* IDENTITY SUMMARY CARD (Soft Brutalist Glass Hybrid Style) */}
      <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        {isPending && (
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 animate-pulse rounded-full bg-ink/10" />
            <div className="flex-1 flex flex-col gap-2">
              <div className="h-4 w-32 animate-pulse rounded-md bg-ink/10" />
              <div className="h-3 w-20 animate-pulse rounded-md bg-ink/10" />
            </div>
          </div>
        )}

        {error && !isPending && (
          <p className="text-xs font-bold text-danger py-1">
            ❌ Couldn&apos;t load your profile. Pull down to retry.
          </p>
        )}

        {data && !isPending && (
          <div className="flex items-center gap-3.5">
            {/* Soft Premium Initial Avatar Ring */}
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary border border-ink/10 text-base font-black text-ink shadow-sm">
              {(data.profile.firstName?.[0] ?? data.profile.username[0]).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0">
              <p className="font-black text-ink leading-tight text-base">
                {data.profile.displayName ??
                  `${data.profile.firstName ?? ""} ${data.profile.lastName ?? ""}`.trim()}
              </p>
              <p className="text-xs font-semibold text-ink/40 mt-0.5 capitalize">
                @{data.profile.username} · <span className="text-secondary font-bold">{data.tier.replace("_", " ")}</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* MENU LIST GROUP */}
      <div className="mt-5 flex flex-col rounded-2xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        {menuItems.map((item, i) => (
          <button
            key={item.href}
            type="button"
            onClick={() => router.push(item.href)}
            className={`flex items-center gap-3.5 px-4 py-4.5 text-left active:bg-slate-50/60 transition-colors ${
              i !== menuItems.length - 1 ? "border-b border-slate-100" : ""
            }`}
          >
            <div className="p-1 text-ink/60">
              <item.icon className="h-5 w-5 stroke-[2.25]" />
            </div>
            <span className="flex-1 font-bold text-sm text-ink/80">{item.label}</span>
            <ChevronRight className="h-4 w-4 text-ink/30 mr-1" />
          </button>
        ))}
      </div>

      {/* LOGOUT BUTTON (Softened, clear action layout) */}
      <button
        type="button"
        onClick={handleLogOut}
        disabled={logoutMutation.isPending}
        className="mt-5 flex items-center justify-center gap-2 rounded-2xl border-2 border-danger/20 hover:border-danger/40 bg-white py-3.5 text-xs font-black text-danger active:bg-danger/5 disabled:opacity-50 transition-all shadow-sm w-full"
      >
        {logoutMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LogOut className="h-4 w-4 stroke-[2.5]" />
        )}
        {logoutMutation.isPending ? "Logging out..." : "Log out"}
      </button>
    </div>
  );
}