"use client";

import { useQuery } from "@tanstack/react-query";
import { getAuthedClient } from "@/lib/api/client";
import { Loader2, ArrowUpRight, ArrowDownLeft, ShieldAlert, Sparkles, UserPlus } from "lucide-react";

type ActivityItemConfig = {
  icon: React.ReactNode;
  bgClass: string;
  badgeText?: string;
};

export default function ActivityPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ["me", "activity"],
    queryFn: () => getAuthedClient().getActivity(),
  });

  // Helper config mapping semantic colors, backgrounds, and icons perfectly to your system properties
  function getActivityConfig(type: string): ActivityItemConfig {
    switch (type) {
      case "contribution_received":
      case "wallet_credit":
      case "wallet_settlement_in":
        return {
          icon: <ArrowDownLeft className="h-4.5 w-4.5 text-success stroke-[2.5]" />,
          bgClass: "bg-success/10 border-success/10",
        };
      case "wallet_withdrawal":
      case "pot_settled_bank":
      case "pot_settled_bill":
      case "pot_settled_wallet":
        return {
          icon: <ArrowUpRight className="h-4.5 w-4.5 text-amber-600 stroke-[2.5]" />,
          bgClass: "bg-amber-500/10 border-amber-500/10",
        };
      case "reminder_sent":
      case "pot_expired":
        return {
          icon: <ShieldAlert className="h-4.5 w-4.5 text-danger stroke-[2.5]" />,
          bgClass: "bg-danger/10 border-danger/10",
        };
      case "friend_request":
        return {
          icon: <UserPlus className="h-4.5 w-4.5 text-secondary stroke-[2.5]" />,
          bgClass: "bg-secondary/10 border-secondary/10",
        };
      default:
        return {
          icon: <Sparkles className="h-4.5 w-4.5 text-primary stroke-[2.5]" />,
          bgClass: "bg-primary/10 border-primary/10",
        };
    }
  }

  return (
    <div className="w-full flex flex-col pb-6 text-left font-sans select-none">
      <h1 className="text-xl font-black text-ink uppercase tracking-tight">Activity</h1>

      <div className="mt-4 flex flex-col gap-3">
        {isPending && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-4 bg-white/80 backdrop-blur-md p-8 border border-ink/10 shadow-[0_8px_32px_rgba(0,0,0,0.04)] rounded-2xl">
            <Loader2 className="h-7 w-7 text-primary animate-spin stroke-[2.5]" />
            <span className="text-[10px] font-black text-ink/40 tracking-wider uppercase">Loading activity feed...</span>
          </div>
        )}

        {error && !isPending && (
          <div className="text-center py-8 bg-red-50 border border-red-100 rounded-2xl p-5">
            <p className="text-xs font-black text-danger uppercase tracking-wide">❌ Failed to retrieve activity records.</p>
          </div>
        )}

        {data && data.items.length === 0 && !isPending && (
          <div className="text-center py-16 bg-white/80 backdrop-blur-md border border-ink/10 rounded-2xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] flex flex-col items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/10 flex items-center justify-center text-lg">
              ⚡
            </div>
            <h3 className="text-xs font-black text-ink uppercase tracking-tight mt-1">No activity yet</h3>
            <p className="text-[11px] font-medium text-ink/40 max-w-[220px] leading-relaxed mx-auto">
              Your transaction history, contributions, and settlements will show up here.
            </p>
          </div>
        )}

        {data && data.items.length > 0 && !isPending && (
          <div className="flex flex-col rounded-2xl border border-ink/10 bg-white/85 backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.04)] overflow-hidden">
            {data.items.map((item, i) => {
              const config = getActivityConfig(item.type);
              const isCredit = item.type.includes("credit") || item.type.includes("received");
              
              const occurred = new Date(item.occurredAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
              });

              return (
                <div
                  key={item.id}
                  className={`flex gap-4 px-4 py-4 items-center active:bg-ink/5 transition-colors ${
                    i !== data.items.length - 1 ? "border-b border-ink/5" : ""
                  }`}
                >
                  {/* Dynamic Colored Icon Box Wrapper */}
                  <div className={`h-10 w-10 rounded-xl border flex items-center justify-center shrink-0 ${config.bgClass}`}>
                    {config.icon}
                  </div>

                  {/* Activity Narrative text strings */}
                  <div className="flex-1 flex flex-col min-w-0">
                    <span className="text-xs font-black text-ink uppercase tracking-tight leading-snug">
                      {item.headline}
                    </span>
                    <span className="text-[9px] font-black uppercase tracking-wider text-ink/30 mt-0.5">
                      {occurred}
                    </span>
                  </div>

                  {/* Financial Values display framework */}
                  {item.amountKobo != null && (
                    <span className={`text-xs font-mono font-black shrink-0 tracking-tight ${
                      isCredit ? "text-success" : "text-ink"
                    }`}>
                      {isCredit ? "+" : "-"}₦{(item.amountKobo / 100).toLocaleString()}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}