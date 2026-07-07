"use client";

import { useRouter } from "next/navigation";
import { useKycStatus } from "@/features/kyc/hooks";
import { Loader2, ShieldCheck, UserCheck } from "lucide-react";

export default function KycPage() {
  const router = useRouter();
  const { data, isPending, error } = useKycStatus();

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
        {isPending && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-10 w-10 text-primary animate-spin stroke-[2.5]" />
            <span className="text-xs font-bold text-ink/40 tracking-wider uppercase">Checking KYC status...</span>
          </div>
        )}

        {error && !isPending && (
          <div className="text-center py-6">
            <p className="text-xs font-bold text-danger">❌ Couldn&apos;t check verification status.</p>
          </div>
        )}

        {data && !isPending && (
          <div className="flex flex-col gap-6">
            {/* Status-specific illustration / icon */}
            <div className="flex flex-col items-center text-center">
              {data.kycStatus === "VERIFIED" ? (
                <div className="h-16 w-16 bg-success/15 border-2 border-success rounded-3xl flex items-center justify-center text-success mb-4 shadow-[2px_2px_0px_0px_#10B981]">
                  <ShieldCheck className="h-9 w-9 stroke-[2.5]" />
                </div>
              ) : data.kycStatus === "PENDING" ? (
                <div className="h-16 w-16 bg-primary/10 border-2 border-primary rounded-3xl flex items-center justify-center text-primary mb-4 animate-pulse shadow-[2px_2px_0px_0px_#ffd200]">
                  <Loader2 className="h-9 w-9 animate-spin stroke-[2.5] text-ink" />
                </div>
              ) : (
                <div className="h-16 w-16 bg-ink/5 border-2 border-ink rounded-3xl flex items-center justify-center text-ink/60 mb-4">
                  <UserCheck className="h-9 w-9 stroke-[2]" />
                </div>
              )}

              <h1 className="text-[26px] font-black tracking-tight text-ink leading-tight">
                {data.kycStatus === "VERIFIED"
                  ? "Identity Verified"
                  : data.kycStatus === "PENDING"
                  ? "Verification Pending"
                  : "Verify Identity"}
              </h1>
              <p className="mt-2 text-xs font-semibold text-ink/50 px-6 leading-relaxed">
                {data.kycStatus === "VERIFIED"
                  ? "Your account is fully upgraded to Tier 1. Enjoy unlimited splits and high settlement limits."
                  : data.kycStatus === "PENDING"
                  ? "We are currently processing your KYC documents. This usually takes less than 3 minutes."
                  : "To unlock full transfers, high settlement caps, and payouts, please verify your details."}
              </p>
            </div>

            {/* Verification Steps / Detail list */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex flex-col gap-4">
              <div className="flex justify-between items-center w-full">
                <span className="text-[10px] font-extrabold text-ink/40 tracking-wider uppercase">Verification Checklist</span>
                <span className="bg-amber-100 text-amber-900 text-[10px] font-extrabold px-2 py-0.5 rounded-sm uppercase tracking-wider">
                  Tier 1 limit
                </span>
              </div>

              <div className="w-full h-[1px] bg-slate-100" />

              <div className="flex flex-col gap-3 text-xs font-semibold">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={data.bvnVerified ? "text-success" : "text-ink/30"}>
                      {data.bvnVerified ? "✓" : "○"}
                    </span>
                    <span className="text-ink/80">1. Bank Verification Number (BVN)</span>
                  </div>
                  {data.bvnVerified && <span className="text-[10px] font-bold text-success">Done</span>}
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={data.kycStatus === "VERIFIED" ? "text-success" : "text-ink/30"}>
                      {data.kycStatus === "VERIFIED" ? "✓" : "○"}
                    </span>
                    <span className="text-ink/80">2. Liveness Selfie Verification</span>
                  </div>
                  {data.kycStatus === "VERIFIED" && <span className="text-[10px] font-bold text-success">Done</span>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ACTION FOOTER */}
      <div className="w-full mt-auto pt-4 shrink-0">
        {data && !isPending && (
          <>
            {data.kycStatus === "NONE" || data.kycStatus === "FAILED" ? (
              <button
                type="button"
                onClick={() => router.push("/verify/bvn")}
                className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all select-none"
              >
                <span>Start Verification</span>
                <span className="text-lg">➔</span>
              </button>
            ) : data.kycStatus === "PENDING" ? (
              <button
                type="button"
                onClick={() => router.push("/verify/pending")}
                className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all select-none"
              >
                <span>Check Pending Status</span>
                <span className="text-lg">➔</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => router.push("/home")}
                className="w-full rounded-2xl bg-white py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink hover:bg-slate-50 transition-all select-none"
              >
                Back to Dashboard
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
