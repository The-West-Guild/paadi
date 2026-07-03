"use client";

import { useQuery } from "@tanstack/react-query";
import { getAuthedClient } from "@/lib/api/client";
import { Loader2, ArrowUpRight, ArrowDownLeft, ShieldAlert, Sparkles, UserPlus } from "lucide-react";

export default function ActivityPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ["me", "activity"],
    queryFn: () => getAuthedClient().getActivity(),
  });

  function getActivityIcon(type: string) {
    switch (type) {
      case "contribution_received":
      case "wallet_credit":
      case "wallet_settlement_in":
        return <ArrowDownLeft className="h-5 w-5 text-success stroke-[2.5]" />;
      case "wallet_withdrawal":
      case "pot_settled_bank":
      case "pot_settled_bill":
      case "pot_settled_wallet":
        return <ArrowUpRight className="h-5 w-5 text-amber-600 stroke-[2.5]" />;
      case "reminder_sent":
      case "pot_expired":
        return <ShieldAlert className="h-5 w-5 text-danger stroke-[2.5]" />;
      case "friend_request":
        return <UserPlus className="h-5 w-5 text-secondary stroke-[2.5]" />;
      default:
        return <Sparkles className="h-5 w-5 text-primary stroke-[2.5]" />;
    }
  }

  return (
    <div className="w-full flex flex-col pb-6 text-left">
      <h1 className="text-2xl font-black text-ink tracking-tight">Activity</h1>

      <div className="mt-5 flex flex-col gap-3">
        {isPending && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <span className="text-xs font-bold text-ink/40 tracking-wider uppercase">Loading activity feed...</span>
          </div>
        )}

        {error && !isPending && (
          <div className="text-center py-8">
            <p className="text-xs font-bold text-danger">❌ Failed to retrieve activity records.</p>
          </div>
        )}

        {data && data.items.length === 0 && !isPending && (
          <div className="text-center py-16 bg-white border border-slate-100 rounded-2xl p-6 shadow-xs flex flex-col items-center gap-2">
            <span className="text-2xl">⚡</span>
            <h3 className="text-sm font-black text-ink mt-1">No activity yet</h3>
            <p className="text-xs text-ink/40 mt-1 max-w-[200px] leading-relaxed mx-auto">
              Your transaction history, contributions, and settlements will show up here.
            </p>
          </div>
        )}

        {data && data.items.length > 0 && !isPending && (
          <div className="flex flex-col rounded-2xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.01)] overflow-hidden">
            {data.items.map((item, i) => {
              const occurred = new Date(item.occurredAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              });

              return (
                <div
                  key={item.id}
                  className={`flex gap-4 px-4 py-4 items-start active:bg-slate-50 transition-colors ${
                    i !== data.items.length - 1 ? "border-b border-slate-100" : ""
                  }`}
                >
                  <div className="h-9 w-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                    {getActivityIcon(item.type)}
                  </div>

                  <div className="flex-1 flex flex-col min-w-0">
                    <span className="text-xs font-extrabold text-ink leading-snug">
                      {item.headline}
                    </span>
                    <span className="text-[10px] font-semibold text-ink/40 mt-1">
                      {occurred}
                    </span>
                  </div>

                  {item.amountKobo != null && (
                    <span className={`text-xs font-black shrink-0 ${
                      item.type.includes("credit") || item.type.includes("received")
                        ? "text-success"
                        : "text-ink"
                    }`}>
                      {item.type.includes("credit") || item.type.includes("received") ? "+" : "-"}
                      ₦{(item.amountKobo / 100).toLocaleString()}
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
