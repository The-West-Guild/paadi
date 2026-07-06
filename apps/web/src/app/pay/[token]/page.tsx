"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { publicClient } from "@/lib/api/client";
import { Loader2, ShieldCheck, CreditCard, ExternalLink, ArrowRight, Users, Eye, Zap } from "lucide-react";

export default function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  // Poll every 3.5 seconds if the split status is not paid yet
  const { data: view, isPending, error } = useQuery({
    queryKey: ["pay", token],
    queryFn: () => publicClient.getPayerView(token),
    refetchInterval: (query) => {
      const currentView = query.state.data;
      if (currentView && (currentView.shareStatus === "pending" || currentView.shareStatus === "partially_paid")) {
        return 3500; // poll to wait for Nomba checkout webhook completion
      }
      return false;
    },
  });

  if (isPending) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#f9fafb] p-6">
        <div className="flex flex-col items-center gap-4 bg-white/80 backdrop-blur-md p-8 border border-[#111827]/10 shadow-[0_8px_32px_rgba(0,0,0,0.06)] rounded-2xl">
          <Loader2 className="h-8 w-8 text-amber-500 animate-spin stroke-[2.5]" />
          <span className="text-[10px] font-black text-[#111827]/50 tracking-wide uppercase">Loading Payment Link...</span>
        </div>
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-[#f9fafb] text-center px-6">
        <div className="bg-white/85 backdrop-blur-md border border-[#111827]/10 p-6 rounded-2xl max-w-sm w-full shadow-[0_12px_32px_rgba(0,0,0,0.08)]">
          <p className="text-xs font-black text-red-600 uppercase tracking-wide">❌ Payment link not found or expired.</p>
          <p className="text-[11px] font-semibold text-[#111827]/50 mt-2 max-w-[240px] mx-auto leading-relaxed">
            Contact the pot organizer to check if this split link is still valid.
          </p>
        </div>
      </div>
    );
  }

  const isPaid = view.shareStatus === "paid" || view.shareStatus === "overpaid";
  const overallProgressPct = view.progress.targetKobo > 0 ? Math.min(100, Math.round((view.progress.collectedKobo / view.progress.targetKobo) * 100)) : 0;

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-[#f9fafb] via-[#f9fafb] to-[#f472b6]/5 px-5 pb-8 pt-5 justify-between max-w-sm mx-auto overflow-y-auto font-sans">
      
      {/* BRANDING HEADER */}
      <div className="flex items-center justify-center w-full shrink-0 py-3.5 border border-[#111827]/10 bg-white/80 backdrop-blur-md rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
        <span className="text-lg font-black tracking-tight text-[#111827] uppercase">Paadi</span>
      </div>

      {/* CORE PAYMENT DETAIL AREA */}
      <div className="flex-1 flex flex-col justify-center w-full my-auto max-h-[460px] gap-5">
        
        {/* Pot Title Messaging */}
        <div className="text-center">
          <span className="text-[10px] font-black uppercase tracking-wider text-[#111827]/40 bg-white/60 border border-[#111827]/5 px-2.5 py-1 rounded-full">
            Contribution Split
          </span>
          <h1 className="text-xl font-black tracking-tight text-[#111827] uppercase leading-tight mt-3 px-2">
            {view.potTitle}
          </h1>
        </div>

        {/* Organizer details card */}
        <div className="bg-white/90 backdrop-blur-md border border-[#111827]/10 rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.04)] flex items-center gap-4 text-left">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#ffd200] border border-[#111827]/20 text-sm font-black text-[#111827] shadow-xs">
            {view.organizerName[0].toUpperCase()}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[9px] font-black text-[#111827]/40 uppercase tracking-wide">Organizer</span>
            <span className="font-black text-[#111827] leading-tight text-sm mt-0.5 uppercase tracking-tight">{view.organizerName}</span>
            <span className="text-[11px] font-bold text-[#111827]/30 mt-0.5">@{view.organizerHandle}</span>
          </div>
        </div>

        {/* Payment Amount Card */}
        <div className="bg-white border border-[#111827]/10 rounded-2xl p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)] flex flex-col gap-4 text-center">
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-black text-[#111827]/40 tracking-wide uppercase">Your Split Share ({view.splitLabel})</span>
            <span className="text-2xl font-mono font-black text-[#111827] tracking-tight mt-1.5">
              ₦{(view.shareKobo / 100).toLocaleString()}
            </span>
          </div>

          <div className="w-full h-[1px] bg-[#111827]/5" />

          {/* Overall pot progress details */}
          <div className="flex flex-col gap-2.5">
            <div className="flex justify-between text-[10px] font-black uppercase tracking-wide text-[#111827]/40">
              <span>Overall pot progress</span>
              <span className="text-[#111827] font-mono">
                ₦{(view.progress.collectedKobo / 100).toLocaleString()}
              </span>
            </div>
            
            <div className="w-full h-3 bg-slate-100/80 border border-[#111827]/5 rounded-full overflow-hidden p-[1px]">
              <div
                className="h-full bg-[#ffd200] rounded-full transition-all duration-500 shadow-[inset_-1px_0_3px_rgba(0,0,0,0.05)]"
                style={{ width: `${overallProgressPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER CALL TO ACTION & ONBOARDING PROMPT */}
      <div className="w-full mt-auto pt-4 shrink-0">
        {isPaid ? (
          <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-3 duration-500">
            {/* Payment success banner */}
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center gap-3.5 text-left">
              <div className="h-9 w-9 shrink-0 rounded-xl bg-[#10b981]/10 flex items-center justify-center text-[#10b981] border border-[#10b981]/20">
                <ShieldCheck className="h-5 w-5 stroke-[2.5]" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black uppercase tracking-wide text-emerald-800">Payment Verified</span>
                <p className="text-[10px] text-emerald-900/60 font-semibold mt-0.5">
                  The organizer has been credited and notified immediately.
                </p>
              </div>
            </div>

            {/* Premium Onboarding Hook Card */}
            <div className="bg-white/90 backdrop-blur-md border border-[#111827]/10 rounded-2xl p-5 shadow-[0_12px_32px_rgba(0,0,0,0.05)] flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-[#f472b6]">Track your split</span>
                <h3 className="text-sm font-black text-[#111827] uppercase tracking-tight">See who has paid inside Paadi</h3>
                <p className="text-[11px] font-medium text-[#111827]/50 leading-relaxed mt-0.5">
                  Don't be left guessing. Create an account to monitor this group pot directly.
                </p>
              </div>

              {/* Value Propositions */}
              <div className="flex flex-col gap-2.5 border-t border-b border-[#111827]/5 py-3">
                <div className="flex items-center gap-2.5 text-left">
                  <Eye className="h-3.5 w-3.5 text-[#ffd200] stroke-[3]" />
                  <span className="text-[10px] font-bold text-[#111827]/70 uppercase tracking-wide">Live tracking of other members</span>
                </div>
                <div className="flex items-center gap-2.5 text-left">
                  <Users className="h-3.5 w-3.5 text-[#ffd200] stroke-[3]" />
                  <span className="text-[10px] font-bold text-[#111827]/70 uppercase tracking-wide">Start your own collection pots</span>
                </div>
                <div className="flex items-center gap-2.5 text-left">
                  <Zap className="h-3.5 w-3.5 text-[#ffd200] stroke-[3]" />
                  <span className="text-[10px] font-bold text-[#111827]/70 uppercase tracking-wide">Instant, automated bank payouts</span>
                </div>
              </div>

              {/* Conversion Buttons */}
              <div className="flex flex-col gap-2">
                <a
                  href="https://paadi.app/signup" // Update with real registration flow path or app store link
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full rounded-xl bg-[#ffd200] py-3 px-4 font-black text-[#111827] text-xs uppercase tracking-wide flex items-center justify-center gap-2 border border-[#111827]/10 shadow-[0_4px_12px_rgba(255,210,0,0.25)] active:scale-98 transition-all text-center select-none"
                >
                  <span>Claim Your Free Account</span>
                  <ArrowRight className="h-3.5 w-3.5 stroke-[3]" />
                </a>
              </div>
            </div>
          </div>
        ) : view.potStatus === "cancelled" ? (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center text-[#111827]/50 text-xs font-black uppercase tracking-wide">
            🚫 This split pot has been cancelled by the organizer.
          </div>
        ) : view.checkoutUrl ? (
          <a
            href={view.checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full rounded-2xl bg-[#ffd200] py-4 px-5 font-black text-[#111827] text-sm uppercase tracking-wide flex items-center justify-center gap-2.5 border border-[#111827]/10 shadow-[0_8px_24px_rgba(255,210,0,0.35)] active:scale-98 active:shadow-[0_4px_12px_rgba(255,210,0,0.2)] transition-all text-center select-none"
          >
            <CreditCard className="h-4.5 w-4.5 stroke-[2.5]" />
            <span>Pay with Nomba Checkout</span>
            <ExternalLink className="h-4 w-4 stroke-[2.5] opacity-60" />
          </a>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center text-[#111827]/50 text-xs font-black uppercase tracking-wide">
            ⏳ Checkout session is not initialized. Try again.
          </div>
        )}
      </div>
    </div>
  );
}