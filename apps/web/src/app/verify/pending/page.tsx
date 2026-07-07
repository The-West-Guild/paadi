"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthedClient } from "@/lib/api/client";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";

export default function KycPendingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["me", "kyc"],
    queryFn: () => getAuthedClient().getKyc(),
    // Poll every 3 seconds while status is PENDING
    refetchInterval: (query) => {
      const kycData = query.state.data;
      if (kycData && kycData.kycStatus === "PENDING") {
        return 3000;
      }
      return false;
    },
  });

  const kycStatus = data?.kycStatus;

  // React to verification result
  useEffect(() => {
    if (kycStatus === "VERIFIED") {
      // Invalidate main me query so the layout/profile updates tier
      queryClient.invalidateQueries({ queryKey: ["me"] });
    }
  }, [kycStatus, queryClient]);

  function handleFinish() {
    router.push("/home");
  }

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-8 pt-5 justify-between max-w-sm mx-auto overflow-y-auto">
      {/* HEADER */}
      <div className="flex items-center justify-between w-full relative shrink-0">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xl font-black tracking-tight text-ink">Verification</span>
        </div>
        <div className="w-10" />
      </div>

      {/* CORE DISPLAY */}
      <div className="flex-1 flex flex-col justify-center items-center w-full my-auto max-y-[450px]">
        {kycStatus === "PENDING" || isPending ? (
          <div className="flex flex-col items-center text-center">
            <div className="h-16 w-16 bg-primary/10 border-2 border-primary rounded-3xl flex items-center justify-center text-primary mb-6 animate-pulse shadow-[2px_2px_0px_0px_#ffd200]">
              <Loader2 className="h-9 w-9 animate-spin stroke-[2.5] text-ink" />
            </div>
            <h1 className="text-[26px] font-black tracking-tight text-ink leading-tight">
              Processing KYC
            </h1>
            <p className="mt-2.5 text-xs font-semibold text-ink/40 px-6 leading-relaxed">
              We are checking your selfie against your BVN records. Please do not close this window.
            </p>
          </div>
        ) : kycStatus === "VERIFIED" ? (
          <div className="flex flex-col items-center text-center">
            <div className="h-16 w-16 bg-success/15 border-2 border-success rounded-3xl flex items-center justify-center text-success mb-6 shadow-[2px_2px_0px_0px_#10B981]">
              <ShieldCheck className="h-9 w-9 stroke-[2.5]" />
            </div>
            <h1 className="text-[26px] font-black tracking-tight text-ink leading-tight text-success">
              Verification Successful!
            </h1>
            <p className="mt-2.5 text-xs font-semibold text-ink/40 px-6 leading-relaxed">
              Congratulations! Your identity has been verified. Your account is now upgraded to <span className="font-extrabold text-ink">{data?.tier}</span>.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <div className="h-16 w-16 bg-danger/10 border-2 border-danger rounded-3xl flex items-center justify-center text-danger mb-6 shadow-[2px_2px_0px_0px_#b91c1c]">
              <ShieldAlert className="h-9 w-9 stroke-[2.5]" />
            </div>
            <h1 className="text-[26px] font-black tracking-tight text-ink leading-tight text-danger">
              Verification Failed
            </h1>
            <p className="mt-2.5 text-xs font-semibold text-ink/40 px-6 leading-relaxed">
              Unfortunately, we couldn&apos;t verify your identity. Please ensure your selfie is clear and try again.
            </p>
          </div>
        )}
      </div>

      {/* FOOTER ACTIONS */}
      <div className="w-full mt-auto pt-4 shrink-0">
        {kycStatus === "VERIFIED" ? (
          <button
            type="button"
            onClick={handleFinish}
            className="w-full rounded-2xl bg-success py-4 px-4 font-bold text-white text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all select-none"
          >
            <span>Enter Dashboard</span>
            <span className="text-lg">➔</span>
          </button>
        ) : kycStatus === "FAILED" ? (
          <button
            type="button"
            onClick={() => router.push("/verify")}
            className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all select-none"
          >
            <span>Try Again</span>
            <span className="text-lg">➔</span>
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="w-full rounded-2xl bg-slate-100 py-4 px-4 font-bold text-ink/30 text-base flex items-center justify-center gap-2 border-2 border-ink/10 select-none cursor-not-allowed"
          >
            <span>Waiting for outcome...</span>
          </button>
        )}
      </div>
    </div>
  );
}
