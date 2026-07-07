"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import {
  usePot,
  useCancelPot,
  useDeletePot,
  usePotSettlement,
  usePotActivity
} from "@/features/pots/hooks";
import {
  Loader2,
  Calendar,
  CheckCircle,
  Copy,
  Receipt,
  ArrowLeft
} from "lucide-react";

export default function PotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data: pot, isPending, error } = usePot(id);
  const { data: settlement } = usePotSettlement(id);
  const { data: activity } = usePotActivity(id);

  const cancelPotMutation = useCancelPot(id);
  const deletePotMutation = useDeletePot(id);

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const isMutating = cancelPotMutation.isPending || deletePotMutation.isPending;

  function handleCopyLink(token: string, index: number) {
    if (typeof window === "undefined") return;
    const payLink = `${window.location.origin}/pay/${token}`;
    navigator.clipboard.writeText(payLink);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }

  function handleCancel() {
    if (!window.confirm("Are you sure you want to cancel this pot? This will stop collections.")) return;
    cancelPotMutation.mutate(undefined, {
      onError: (err: Error) => setErrorMsg(err.message ?? "Failed to cancel pot.")
    });
  }

  function handleDelete() {
    if (!window.confirm("Are you sure you want to delete this pot permanently?")) return;
    deletePotMutation.mutate(undefined, {
      onSuccess: () => {
        router.push("/pots");
      },
      onError: (err: Error) => setErrorMsg(err.message ?? "Failed to delete pot.")
    });
  }

  if (isPending) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-50 p-6">
        <div className="flex flex-col items-center gap-4 bg-white/80 backdrop-blur-md p-8 border border-[#111827]/10 shadow-[0_8px_32px_rgba(0,0,0,0.06)] rounded-2xl">
          <Loader2 className="h-8 w-8 text-amber-500 animate-spin stroke-[2.5]" />
          <span className="text-[10px] font-black text-[#111827]/50 tracking-wide uppercase">Loading Pot...</span>
        </div>
      </div>
    );
  }

  if (error || !pot) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-slate-50 text-center p-6">
        <div className="bg-white/85 backdrop-blur-md border border-[#111827] p-6 rounded-2xl max-w-sm w-full shadow-[0_12px_32px_rgba(0,0,0,0.08)]">
          <p className="text-xs font-black text-[#111827] uppercase tracking-wide">❌ Pot not found or access denied.</p>
          <button
            onClick={() => router.push("/pots")}
            className="mt-5 w-full py-3.5 bg-amber-400 border border-[#111827] rounded-xl text-xs font-black uppercase tracking-wide text-[#111827] shadow-[0_6px_20px_rgba(255,210,0,0.4)] active:scale-98 active:shadow-[0_2px_8px_rgba(255,210,0,0.2)] transition-all"
          >
            Back to Pots
          </button>
        </div>
      </div>
    );
  }

  const progressPct = pot.totalKobo > 0 ? Math.min(100, Math.round((pot.progress.collectedKobo / pot.totalKobo) * 100)) : 0;
  const deadline = pot.deadlineAt ? new Date(pot.deadlineAt).toLocaleDateString() : null;

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col pb-28 pt-4 bg-slate-50/60 min-h-screen font-sans">
      {errorMsg && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-xs font-bold text-red-600 uppercase tracking-wide text-center">
          ❌ {errorMsg}
        </div>
      )}

      {/* CORE DETAIL CONTAINER */}
      <div className="mt-4 rounded-2xl border border-[#111827]/10 bg-white/90 backdrop-blur-md p-5 shadow-[0_8px_32px_rgba(0,0,0,0.05)] flex flex-col gap-5">
        <div className="flex justify-between items-start gap-4">
          <div className="flex flex-col text-left">
            <h2 className="text-base font-black text-[#111827] tracking-tight uppercase leading-tight">{pot.title}</h2>
            {deadline && (
              <span className="text-[10px] font-black uppercase tracking-wide text-[#111827]/40 mt-1.5 flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 stroke-2" /> Ends {deadline}
              </span>
            )}
          </div>
          <span className={`text-[9px] font-black px-2.5 py-1 rounded-lg uppercase border tracking-wide shrink-0 ${
            pot.status === "open"
              ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
              : pot.status === "settled"
              ? "bg-amber-500/10 text-amber-700 border-amber-500/20"
              : "bg-slate-100 text-slate-500 border-slate-200"
          }`}>
            {pot.status}
          </span>
        </div>

        {pot.description && (
          <p className="text-xs font-semibold text-[#111827]/60 leading-relaxed text-left border-l-2 border-[#111827]/20 pl-3 py-0.5">
            {pot.description}
          </p>
        )}

        <div className="w-full h-[1px] bg-[#111827]/5" />

        {/* PROGRESS METRICS */}
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5 text-left">
            <span className="text-[10px] font-black uppercase tracking-wide text-[#111827]/40">
              Collection Progress ({pot.progress.paidCount}/{pot.progress.splitCount} paid)
            </span>
            <span className="text-base font-mono font-black text-[#111827]">
              ₦{(pot.progress.collectedKobo / 100).toLocaleString()} <span className="font-sans text-xs text-[#111827]/30 font-black">/</span> ₦{(pot.totalKobo / 100).toLocaleString()}
            </span>
          </div>

          <div className="w-full h-3.5 bg-slate-100/80 border border-[#111827]/10 rounded-full overflow-hidden relative p-[1px]">
            <div
              className="h-full bg-amber-400 border-r border-[#111827]/10 rounded-full transition-all duration-500 shadow-[inset_-2px_0_4px_rgba(0,0,0,0.05)]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* SETTLEMENT STATUS PANEL */}
      {settlement?.settlement && (
        <div className="mt-4 bg-indigo-50/60 border border-indigo-100 rounded-2xl p-5 text-left shadow-[0_4px_20px_rgba(99,102,241,0.05)]">
          <div className="flex items-center gap-2 text-indigo-900 mb-3">
            <Receipt className="h-4.5 w-4.5 stroke-[2.5]" />
            <span className="text-[10px] font-black uppercase tracking-wide">Settlement status</span>
          </div>

          <div className="flex flex-col gap-2.5 text-xs text-indigo-950 font-bold">
            <p className="uppercase tracking-wide text-[10px] text-indigo-900/60">Status: <span className="font-black bg-white/80 border border-indigo-200/60 px-2 py-0.5 rounded-md ml-1 text-indigo-700 capitalize">{settlement.settlement.status}</span></p>
            
            {settlement.settlement.vendToken && (
              <div className="mt-1 bg-white border border-[#111827]/5 rounded-xl p-3.5 shadow-sm flex flex-col gap-1">
                <p className="text-[10px] font-black uppercase text-[#111827]/40 tracking-wide">Electricity Token</p>
                <p className="font-mono font-black text-sm text-[#111827] select-all tracking-wider p-2.5 bg-slate-50 border border-dashed border-[#111827]/10 rounded-lg mt-1 text-center">
                  {settlement.settlement.vendToken || "Generating..."}
                </p>
                <p className="text-[10px] font-black uppercase tracking-wide text-[#111827]/40 mt-1">{settlement.settlement.vendUnits || "0"} units vended</p>
              </div>
            )}
            
          </div>
        </div>
      )}

      {/* SPLITS LIST */}
      <div className="mt-5 flex flex-col gap-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-[#111827]/40 px-1 text-left">
          Split Links for Contributors
        </span>

        <div className="flex flex-col gap-2">
          {pot.splits.map((split, i) => (
            <div
              key={split.id}
              className="bg-white border border-[#111827]/5 rounded-xl p-4 flex justify-between items-center shadow-xs"
            >
              <div className="flex flex-col text-left">
                <span className="text-xs font-black uppercase tracking-tight text-[#111827]">{split.label}</span>
                <span className="text-[10px] font-mono font-black text-[#111827]/50 mt-1">
                  ₦{(split.shareKobo / 100).toLocaleString()} <span className="font-sans text-[#111827]/20">·</span> <span className="font-sans uppercase text-[9px] tracking-wide bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{split.status}</span>
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleCopyLink(split.payToken, i)}
                  className={`h-11 px-4 border rounded-xl flex items-center justify-center gap-1.5 font-black text-[10px] uppercase tracking-wide transition-all ${
                    copiedIndex === i
                      ? "bg-emerald-500 border-emerald-500 text-white shadow-none"
                      : "bg-slate-50 border-slate-100 text-[#111827] active:scale-95"
                  }`}
                >
                  {copiedIndex === i ? (
                    <>
                      <CheckCircle className="h-3.5 w-3.5 stroke-[2.5]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 stroke-2 text-[#111827]/40" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ACTIVITY FEED SUB-LIST */}
      {activity?.items && activity.items.length > 0 && (
        <div className="mt-5 flex flex-col gap-2 text-left">
          <span className="text-[10px] font-black uppercase tracking-wide text-[#111827]/40 px-1">
            Recent activity
          </span>
          <div className="bg-white border border-[#111827]/5 rounded-xl p-4 flex flex-col gap-3.5 shadow-xs">
            {activity.items.slice(0, 3).map((act) => (
              <div key={act.id} className="flex gap-3 items-start text-xs">
                <div className="h-6 w-6 border border-amber-200 rounded-lg bg-amber-500/10 flex items-center justify-center text-[10px] shrink-0">
                  ⚡
                </div>
                <div className="flex flex-col pt-0.5">
                  <span className="font-bold text-[#111827] leading-tight">{act.headline}</span>
                  <span className="text-[9px] font-black uppercase tracking-wide text-[#111827]/30 mt-0.5">{new Date(act.occurredAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* POT MANAGEMENT ACTIONS */}
      <div className="mt-6 flex flex-col gap-2 w-full">
        {pot.status === "open" && pot.progress.collectedKobo === 0 && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isMutating}
            className="w-full py-4 bg-red-50 border border-red-200/60 text-red-600 rounded-xl text-xs font-black uppercase tracking-wide active:scale-98 transition-all text-center flex items-center justify-center gap-2 disabled:opacity-50 shadow-xs"
          >
            Delete Pot Permanently
          </button>
        )}

        {pot.status === "open" && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={isMutating}
            className="w-full py-4 bg-[#111827] text-white rounded-xl text-xs font-black uppercase tracking-wide active:scale-98 transition-all text-center disabled:opacity-50 shadow-[0_8px_24px_rgba(17,24,39,0.25)]"
          >
            Cancel Pot (Stop collections)
          </button>
        )}
      </div>
    </div>
  );
}