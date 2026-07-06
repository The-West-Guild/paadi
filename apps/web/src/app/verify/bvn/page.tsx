"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSubmitBvn } from "@/features/kyc/hooks";
import { toast } from "@/features/toast/store";
import { Loader2, Hash } from "lucide-react";

export default function KycBvnPage() {
  const router = useRouter();
  const submitBvnMutation = useSubmitBvn();
  const [bvn, setBvn] = useState("");

  const isPending = submitBvnMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!/^\d{11}$/.test(bvn)) {
      toast.error("BVN must be exactly 11 digits.");
      return;
    }

    submitBvnMutation.mutate(bvn, {
      onSuccess: () => {
        router.push("/verify/selfie");
      },
      onError: (err: any) => {
        toast.error(err.message ?? "BVN name check failed. Ensure your registered profile name matches the bank records.");
      },
    });
  }

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-8 pt-5 justify-between max-w-sm mx-auto overflow-y-auto">
      {/* HEADER */}
      <div className="flex items-center justify-between w-full relative shrink-0">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-xl font-bold p-2 text-ink/70 hover:text-ink transition-colors z-30"
        >
          ←
        </button>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xl font-black tracking-tight text-ink">Verification</span>
        </div>
        <div className="w-10" />
      </div>

      {/* CORE DISPLAY */}
      <div className="flex-1 flex flex-col justify-center w-full my-auto max-y-[450px]">
        <div className="flex flex-col items-center text-center py-2 shrink-0 mb-6">
          <div className="h-12 w-12 rounded-full bg-primary/10 border border-ink/5 text-primary flex items-center justify-center mb-3">
            <Hash className="h-6 w-6 text-ink" />
          </div>
          <h1 className="text-[26px] font-black tracking-tight text-ink leading-tight">
            Verify BVN
          </h1>
          <p className="mt-2 text-xs font-semibold text-ink/40 max-w-[260px] leading-relaxed">
            Enter your 11-digit Bank Verification Number. This verifies your identity and is not shared with anyone.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 mt-2">
            <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
              Bank Verification Number (BVN)
            </label>
            <input
              type="text"
              value={bvn}
              onChange={(e) => setBvn(e.target.value.replace(/\D/g, "").slice(0, 11))}
              disabled={isPending}
              placeholder="22200000000"
              className="w-full bg-white border-2 border-ink rounded-xl px-4 py-3.5 text-sm font-semibold text-ink placeholder:text-ink/30 text-center tracking-widest focus:outline-hidden focus:border-primary shadow-[2px_2px_0px_0px_#111827] disabled:opacity-50 transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-50 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all select-none mt-2"
          >
            {isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <span>Continue</span>
                <span className="text-lg">➔</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* SECURED BRANDING FOOTER */}
      <div className="w-full mt-auto pt-4 shrink-0 text-center flex flex-col gap-2">
        <span className="text-[9px] font-bold text-ink/30 tracking-widest uppercase">Secured by Nomba</span>
        <p className="text-[10px] text-ink/40 leading-relaxed px-4">
          Dial *565*0# from your registered mobile line to check your BVN.
        </p>
      </div>
    </div>
  );
}
