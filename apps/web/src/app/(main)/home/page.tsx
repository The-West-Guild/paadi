"use client";

import { useRouter } from "next/navigation";
import { useMe } from "@/features/settings/profile-hooks";
import { usePots } from "@/features/pots/hooks";
import { useQuery } from "@tanstack/react-query";
import { getAuthedClient } from "@/lib/api/client";
import { Loader2, Plus, ShieldAlert, Landmark, Wallet, ChevronRight, Layers, ArrowUpRight } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  const router = useRouter();

  const { data: me, isPending: loadingMe } = useMe();
  const { data: potsData, isPending: loadingPots } = usePots({ status: "open", limit: 3 });

  // Fetch optional wallet balance
  const { data: wallet, error: walletError } = useQuery({
    queryKey: ["me", "wallet"],
    queryFn: () => getAuthedClient().getWallet(),
    retry: false, // don't hammer the server if wallet is not provisioned or returns 404
  });

  const isPending = loadingMe || loadingPots;

  if (isPending) {
    return (
      <div className="flex h-[80vh] items-center justify-center bg-transparent">
        <Loader2 className="h-10 w-10 text-primary animate-spin stroke-[2.5]" />
      </div>
    );
  }

  const firstName = me?.profile.firstName ?? me?.profile.username ?? "User";

  return (
    <div className="w-full flex flex-col pb-6">
      {/* GREETING HEADER */}
      <div className="flex justify-between items-center w-full text-left">
        <div className="flex flex-col">
          <h1 className="text-2xl font-black text-ink tracking-tight">
            Hi, {firstName}!
          </h1>
          <p className="text-xs font-semibold text-ink/40 mt-0.5">Let&apos;s split and settle bills together</p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/pots/create")}
          className="h-11 w-11 rounded-xl bg-primary border-2 border-ink shadow-[2.5px_2.5px_0px_0px_#111827] active:translate-y-[1px] active:shadow-[1.5px_1.5px_0px_0px_#111827] flex items-center justify-center transition-all shrink-0"
        >
          <Plus className="h-5 w-5 text-ink stroke-[3]" />
        </button>
      </div>

      {/* WALLET OVERVIEW (Soft Brutalist Glass Hybrid Style) */}
      {wallet && !walletError && (
        <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex flex-col gap-4 text-left">
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-2">
              <Wallet className="h-4.5 w-4.5 text-ink/60 stroke-[2.25]" />
              <span className="text-[10px] font-extrabold text-ink/40 tracking-wider uppercase">Wallet Balance</span>
            </div>
            <span className="text-[10px] font-extrabold text-success uppercase tracking-widest bg-success/10 px-2 py-0.5 rounded-sm">
              Active
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-2xl font-black text-ink tracking-tight">
              ₦{(wallet.balanceKobo / 100).toLocaleString()}
            </span>
            {wallet.virtualAccount && (
              <span className="text-[10px] font-semibold text-ink/40 mt-1 flex items-center gap-1">
                <Landmark className="h-3 w-3" /> {wallet.virtualAccount.bankName} · {wallet.virtualAccount.accountNumber}
              </span>
            )}
          </div>
        </div>
      )}

      {/* KYC CTA BANNER */}
      {me?.tier === "TIER_0" && (
        <button
          type="button"
          onClick={() => router.push("/verify")}
          className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 text-left hover:border-amber-300 transition-colors shadow-xs w-full"
        >
          <div className="h-8 w-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <ShieldAlert className="h-4.5 w-4.5 stroke-[2.5]" />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <span className="text-xs font-black text-amber-900 leading-tight">Verify identity to unlock limits</span>
            <p className="text-[10px] font-medium text-amber-900/60 mt-0.5 leading-relaxed">
              Complete BVN and selfie check to upgrade your account and start direct payouts.
            </p>
          </div>
          <ChevronRight className="h-4.5 w-4.5 text-amber-700/60 my-auto shrink-0" />
        </button>
      )}

      {/* OPEN POTS PREVIEW */}
      <div className="mt-6 flex flex-col gap-3 text-left">
        <div className="flex justify-between items-center w-full">
          <span className="text-[10px] font-extrabold text-ink/40 tracking-wider uppercase px-1">Active Pots ({potsData?.items.length || 0})</span>
          <Link href="/pots" className="text-[10px] font-extrabold text-amber-500 hover:text-primary transition-colors flex items-center gap-0.5 uppercase tracking-wider">
            View All <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {potsData && potsData.items.length === 0 ? (
          <div className="bg-white border border-slate-100 rounded-2xl p-6 text-center flex flex-col items-center gap-3 shadow-xs">
            <span className="text-2xl">🍯</span>
            <div className="flex flex-col">
              <h3 className="text-sm font-black text-ink">No active collections</h3>
              <p className="text-xs text-ink/40 mt-1 max-w-[200px] leading-relaxed mx-auto">
                Start a new pot to divide bills, dinners, or group gifts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/pots/create")}
              className="mt-2 px-5 py-2 bg-primary border-2 border-ink shadow-[2.5px_2.5px_0px_0px_#111827] rounded-xl text-xs font-black text-ink"
            >
              Create Pot
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {potsData?.items.slice(0, 3).map((pot) => {
              const progressPct = pot.totalKobo > 0 ? Math.min(100, Math.round((pot.collectedKobo / pot.totalKobo) * 100)) : 0;
              return (
                <Link
                  key={pot.id}
                  href={`/pots/${pot.id}`}
                  className="bg-white border border-slate-100 rounded-xl p-4 shadow-xs flex items-center justify-between group hover:border-slate-200 transition-colors"
                >
                  <div className="flex flex-col text-left max-w-[65%]">
                    <span className="text-xs font-extrabold text-ink leading-tight truncate group-hover:text-amber-600 transition-colors">
                      {pot.title}
                    </span>
                    <span className="text-[10px] font-bold text-ink/40 mt-1">
                      ₦{(pot.collectedKobo / 100).toLocaleString()} of ₦{(pot.totalKobo / 100).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Circle progress indicator */}
                    <span className="text-[10px] font-extrabold text-ink/60">
                      {progressPct}%
                    </span>
                    <ChevronRight className="h-4 w-4 text-ink/30 mr-1" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* QUICK ACTIONS ROW */}
      <div className="mt-6 flex flex-col gap-2.5 w-full">
        <button
          type="button"
          onClick={() => router.push("/pots/create")}
          className="w-full py-4 bg-primary border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] rounded-2xl text-sm font-black text-ink transition-all text-center flex items-center justify-center gap-2 select-none"
        >
          <Plus className="h-5 w-5 stroke-[2.5]" />
          Create New Split Pot
        </button>
      </div>
    </div>
  );
}
