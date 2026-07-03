"use client";

import { useRouter } from "next/navigation";
import { useMe } from "@/features/settings/profile-hooks";
import { ChevronRight, Settings, ShieldCheck, ShieldAlert, Wallet, Lock, Bell, HelpCircle } from "lucide-react";
import Link from "next/link";

export default function ProfilePage() {
  const router = useRouter();
  const { data, isPending, error } = useMe();

  const links = [
    { label: "Edit Profile", icon: Settings, href: "/settings/profile" },
    { label: "Payout Accounts", icon: Wallet, href: "/settings/payout" },
    { label: "Security & PIN", icon: Lock, href: "/settings/security" },
    { label: "Notification Preferences", icon: Bell, href: "/settings/notifications" },
  ];

  return (
    <div className="w-full flex flex-col">
      <h1 className="text-2xl font-black text-ink tracking-tight">Profile</h1>

      {/* IDENTITY DETAIL CARD */}
      <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex flex-col items-center text-center">
        {isPending && (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="h-20 w-20 animate-pulse rounded-full bg-ink/10" />
            <div className="h-5 w-32 animate-pulse rounded-md bg-ink/10" />
            <div className="h-4 w-20 animate-pulse rounded-md bg-ink/10" />
          </div>
        )}

        {error && !isPending && (
          <p className="text-xs font-bold text-danger py-4">
            ❌ Couldn&apos;t load profile details.
          </p>
        )}

        {data && !isPending && (
          <>
            {/* Avatar Initials Ring */}
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary border-2 border-ink text-xl font-black text-ink shadow-[3px_3px_0px_0px_#111827]">
              {(data.profile.firstName?.[0] ?? data.profile.username[0]).toUpperCase()}
            </div>

            <h2 className="mt-4 font-black text-ink text-lg leading-tight">
    {data?.profile?.displayName?.trim() || 
   `${data?.profile?.firstName ?? ""} ${data?.profile?.lastName ?? ""}`.trim() || 
   data?.profile?.username}
</h2>
            <p className="text-xs font-bold text-ink/40 mt-1">@{data.profile.username}</p>

            {/* KYC Status Banner */}
            <div className="w-full mt-5">
              {data.tier === "TIER_0" ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2 text-amber-800">
                    <ShieldAlert className="h-4 w-4 stroke-[2.5]" />
                    <span className="text-xs font-extrabold uppercase tracking-wider">Tier 0 (Unverified)</span>
                  </div>
                  <p className="text-[11px] font-semibold text-amber-900/60 leading-relaxed">
                    Verify your identity to increase transaction limits and enable direct bank withdrawals.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push("/verify")}
                    className="w-full py-2 bg-amber-500 hover:bg-primary border-2 border-ink shadow-[2px_2px_0px_0px_#111827] active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#111827] rounded-xl text-xs font-black text-ink transition-all"
                  >
                    Verify Identity
                  </button>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between w-full">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-success/15 flex items-center justify-center text-success">
                      <ShieldCheck className="h-4.5 w-4.5 stroke-[2.5]" />
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[10px] font-extrabold text-ink/40 tracking-wider uppercase">KYC Level</span>
                      <span className="text-xs font-black text-ink">{data.tier.replace("_", " ")}</span>
                    </div>
                  </div>
                  <span className="bg-success/10 text-success text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider">
                    Verified
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* QUICK LINKS GROUP */}
      <div className="mt-5 flex flex-col rounded-2xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
        {links.map((link, i) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-3.5 px-4 py-4 text-left active:bg-slate-50/60 transition-colors ${
              i !== links.length - 1 ? "border-b border-slate-100" : ""
            }`}
          >
            <div className="p-1 text-ink/60">
              <link.icon className="h-5 w-5 stroke-[2.25]" />
            </div>
            <span className="flex-1 font-bold text-sm text-ink/80">{link.label}</span>
            <ChevronRight className="h-4 w-4 text-ink/30 mr-1" />
          </Link>
        ))}
      </div>

      {/* SETTINGS QUICK SHORTCUT */}
      <button
        type="button"
        onClick={() => router.push("/settings")}
        className="mt-5 flex items-center justify-center gap-2 rounded-2xl border-2 border-ink/10 hover:border-ink/20 bg-white py-3.5 text-xs font-black text-ink/60 active:bg-slate-50 transition-all shadow-sm"
      >
        Settings Hub
      </button>
    </div>
  );
}