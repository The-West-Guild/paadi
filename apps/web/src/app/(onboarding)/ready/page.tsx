"use client";

import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { useOnboardingStore } from "@/features/onboarding/store";

export default function OnboardingReadyPage() {
  const router = useRouter();
  const resetOnboarding = useOnboardingStore((s) => s.reset);

  function handleFinish() {
    // Clear onboarding store after session is set and we're ready
    resetOnboarding();
    // Forward the fully configured profile user onto the main feed/dashboard
    router.push("/home");
  }


  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-8 pt-5 justify-between max-w-sm mx-auto overflow-y-auto">
      
     

      {/* CORE CELEBRATION CONTEXT */}
      <div className="flex-1 flex flex-col items-center justify-center w-full my-auto max-y-[420px]">
        
        {/* Animated Celebration Ring Hero */}
        <div className="w-16 h-16 bg-success/10 border-2 border-success rounded-[24px] flex items-center justify-center text-success mb-6 shadow-[2px_2px_0px_0px_#10B981]">
          <CheckCircle className="h-8 w-8 stroke-[2.5]" />
        </div>

        {/* Messaging Headers */}
        <div className="w-full text-center shrink-0 mb-6">
          <h1 className="text-[26px] font-black tracking-tight text-ink leading-tight">
            You are good to go!
          </h1>
          <p className="mt-2 text-xs font-medium text-ink/60 px-4 leading-relaxed">
            Your ledger profiles and transactional vaults are ready. Welcome to the group.
          </p>
        </div>

        {/* TIER LEVEL CONFIRMATION METRIC CARD (Soft-Brutalist Layout) */}
        <div className="w-full bg-white border border-slate-100 rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex flex-col gap-3.5">
          <div className="flex items-center justify-between w-full">
            <span className="text-[10px] font-extrabold text-ink/40 tracking-wider uppercase">
              Account Level
            </span>
            <span className="bg-secondary text-white text-[10px] font-black px-2.5 py-0.5 rounded-md border border-ink uppercase tracking-wide shadow-[1px_1px_0px_0px_#111827]">
              Tier 0 Verified
            </span>
          </div>

          <div className="w-full h-1px bg-slate-100" />

          {/* Checklist Summary */}
          <ul className="flex flex-col gap-2.5 text-xs font-semibold text-ink/70">
            <li className="flex items-center gap-2">
              <span className="text-success text-sm">✓</span> Unique handle configured
            </li>
            <li className="flex items-center gap-2">
              <span className="text-success text-sm">✓</span> Secure access parameters active
            </li>
            <li className="flex items-center gap-2">
              <span className="text-success text-sm">✓</span> Transaction pots tracking initialized
            </li>
          </ul>
        </div>

      </div>

      {/* FOOTER CALL TO ACTION */}
      <div className="w-full mt-auto pt-4 shrink-0">
        <button
          type="button"
          onClick={handleFinish}
          className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all select-none"
        >
          <span>Enter Dashboard</span>
          <span className="text-lg">➔</span>
        </button>
      </div>

    </div>
  );
}