"use client";

import { useRouter } from "next/navigation";
import { useLogout } from "@/features/settings/profile-hooks";
import { ChevronRight, User, Lock, Wallet, Bell, LogOut, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { toast } from "@/features/toast/store";

export default function SettingsPage() {
  const router = useRouter();
  const logoutMutation = useLogout();

  function handleLogOut() {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        router.push("/welcome");
      },
      onError: (err: Error) => {
        toast.error(err.message ?? "Failed to log out.");
        router.push("/welcome");
      }
    });
  }

  const sections = [
    {
      title: "Account",
      items: [
        { label: "Personal Details", icon: User, href: "/profile" },
      ],
    },
    {
      title: "Financials",
      items: [
        { label: "Payout Accounts", icon: Wallet, href: "/settings/payout" },
      ],
    },
    {
      title: "Security",
      items: [
        { label: "Security & PIN", icon: Lock, href: "/settings/security" },
        { label: "Email Settings", icon: Mail, href: "/settings/email" },
      ],
    },
    {
      title: "Preferences",
      items: [
        { label: "Notification Preferences", icon: Bell, href: "/settings/notifications" },
      ],
    },
  ];

  return (
    <div className="w-full flex flex-col">
      {/* HEADER BAR */}
      <h1 className="text-2xl font-black text-ink tracking-tight mb-2">Settings</h1>

      {/* MENU LIST GROUPS */}
      <div className="mt-4 flex flex-col gap-6">
        {sections.map((section) => (
          <div key={section.title} className="flex flex-col gap-2">
            <h2 className="text-[10px] font-extrabold text-ink/40 tracking-wider uppercase px-2">
              {section.title}
            </h2>
            <div className="flex flex-col rounded-2xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
              {section.items.map((item, i) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3.5 px-4 py-4 text-left active:bg-slate-50/60 transition-colors ${
                    i !== section.items.length - 1 ? "border-b border-slate-100" : ""
                  }`}
                >
                  <div className="p-1 text-ink/60">
                    <item.icon className="h-5 w-5 stroke-[2.25]" />
                  </div>
                  <span className="flex-1 font-bold text-sm text-ink/80">{item.label}</span>
                  <ChevronRight className="h-4 w-4 text-ink/30 mr-1" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* LOGOUT BUTTON */}
      <button
        type="button"
        onClick={handleLogOut}
        disabled={logoutMutation.isPending}
        className="mt-6 mb-8 flex items-center justify-center gap-2 rounded-2xl border-2 border-danger/20 hover:border-danger/40 bg-white py-3.5 text-xs font-black text-danger active:bg-danger/5 disabled:opacity-50 transition-all shadow-sm w-full"
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