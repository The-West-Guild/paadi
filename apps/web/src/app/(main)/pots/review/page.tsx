"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreatePotStore } from "@/features/create-pot/store";
import { useCreatePot } from "@/features/create-pot/hooks";
import { toast } from "@/features/toast/store";
import { Loader2, ShieldCheck, Calendar, Lock } from "lucide-react";
import { DeadlinePicker } from "@/components/ui/deadline-picker";

export default function ReviewPotPage() {
  const router = useRouter();
  const store = useCreatePotStore();
  const createPotMutation = useCreatePot();

  const [completionRule, setCompletionRule] = useState<"progressive" | "all_or_nothing">("progressive");
  const [deadlineDate, setDeadlineDate] = useState("");


  const isPending = createPotMutation.isPending;

  function handleSubmit() {
    // Prepare CreatePotInput
    const input: any = {
      title: store.title,
      description: store.description || undefined,
      totalKobo: store.totalKobo,
      settlementType: store.settlementType,
      completionRule: completionRule,
      splitMode: store.splitMode,
      splits: store.splits.map((s) => {
        const split: any = { label: s.label };
        if (store.splitMode === "weight") {
          split.weight = s.weight;
        } else if (store.splitMode === "amount") {
          split.amountKobo = s.amountKobo;
        } else if (store.splitMode === "percent") {
          split.percent = s.percent;
        }
        return split;
      }),
    };

    if (deadlineDate) {
      // Convert user date input to ISO 8601 string
      const localDate = new Date(deadlineDate);
      if (isNaN(localDate.getTime())) {
        toast.error("Invalid deadline date.");
        return;
      }
      if (localDate.getTime() <= Date.now()) {
        toast.error("Deadline must be in the future.");
        return;
      }
      input.deadlineAt = localDate.toISOString();
    }

    if (store.settlementType === "bill_payment") {
      input.billerCategory = store.billerCategory;
      input.billerProductCode = store.billerProductCode;
      input.billerCustomerId = store.billerCustomerId;
      input.meterType = store.meterType;
    } else if (store.settlementType === "bank_payout") {
      input.payoutAccountId = store.payoutAccountId;
    }

    // Generate random UUID for idempotency key
    const idempotencyKey = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2) + Date.now().toString(36);

    createPotMutation.mutate(
      { input, idempotencyKey },
      {
        onSuccess: (potDetail) => {
          toast.success("Pot created successfully!");
          // Reset store state
          store.reset();
          // Navigate to detail screen
          router.push(`/pots/${potDetail.id}`);
        },
        onError: (err: any) => {
          toast.error(err.message ?? "Failed to create pot. Check your details and try again.");
        },
      }
    );
  }

  return (
    <div className="w-full flex flex-col pb-6">
      {/* HEADER */}
      <div className="flex items-center justify-between w-full">
        <h1 className="text-2xl font-black text-ink tracking-tight">Review Pot</h1>
        <span className="text-xs font-bold text-ink/50 bg-ink/5 px-2.5 py-1 rounded-full">
          Step 3/3
        </span>
      </div>



      {/* SUMMARY CARD */}
      <div className="mt-5 flex flex-col gap-4 bg-white border border-slate-100 p-4 rounded-2xl shadow-sm">
        <div className="flex justify-between items-start">
          <div className="flex flex-col text-left">
            <span className="text-[10px] font-extrabold text-ink/40 tracking-wider uppercase">Title</span>
            <span className="text-base font-black text-ink leading-tight">{store.title}</span>
          </div>
          <div className="flex flex-col text-right">
            <span className="text-[10px] font-extrabold text-ink/40 tracking-wider uppercase">Total Amount</span>
            <span className="text-base font-black text-primary bg-ink border border-ink px-2.5 py-0.5 rounded-lg shadow-sm leading-none mt-1">
              ₦{(store.totalKobo / 100).toLocaleString()}
            </span>
          </div>
        </div>

        {store.description && (
          <div className="flex flex-col text-left">
            <span className="text-[10px] font-extrabold text-ink/40 tracking-wider uppercase">Description</span>
            <span className="text-xs font-semibold text-ink/70 mt-0.5 leading-relaxed">{store.description}</span>
          </div>
        )}

        <div className="w-full h-[1px] bg-slate-100" />

        {/* Settlement Summary */}
        <div className="flex flex-col text-left gap-1">
          <span className="text-[10px] font-extrabold text-ink/40 tracking-wider uppercase">Settlement Details</span>
          {store.settlementType === "bill_payment" ? (
            <div className="flex flex-col gap-0.5 text-xs font-semibold text-ink/80">
              <p>Type: <span className="font-extrabold">Bill Payment ({store.billerCategory})</span></p>
              <p>Provider: <span className="font-extrabold uppercase">{store.billerProductCode}</span></p>
              <p>Number: <span className="font-extrabold">{store.billerCustomerId}</span></p>
              {store.billerCustomerName && <p>Name: <span className="font-extrabold text-success">{store.billerCustomerName}</span></p>}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 text-xs font-semibold text-ink/80">
              <p>Type: <span className="font-extrabold">Bank Payout</span></p>
              <p>Status: <span className="font-extrabold text-success">Verified payout account linked</span></p>
            </div>
          )}
        </div>
      </div>

      {/* ADDITIONAL SETTINGS */}
      <div className="mt-5 flex flex-col gap-4 bg-white border border-slate-100 p-4 rounded-2xl shadow-sm">
        {/* Completion Rule Selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
            Completion Rule
          </label>
          <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100">
            <button
              type="button"
              onClick={() => setCompletionRule("progressive")}
              className={`py-2 rounded-lg text-xs font-extrabold flex items-center justify-center transition-all ${
                completionRule === "progressive" ? "bg-white text-ink border border-slate-100 shadow-xs" : "text-ink/40"
              }`}
            >
              Progressive (Payout any amount)
            </button>
            <button
              type="button"
              onClick={() => setCompletionRule("all_or_nothing")}
              className={`py-2 rounded-lg text-xs font-extrabold flex items-center justify-center transition-all ${
                completionRule === "all_or_nothing" ? "bg-white text-ink border border-slate-100 shadow-xs" : "text-ink/40"
              }`}
            >
              All or Nothing (Full target only)
            </button>
          </div>
        </div>

        {/* Deadline Picker */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1 flex items-center gap-1">
            <Calendar className="h-3 w-3" /> Set Collection Deadline (Optional)
          </label>
          <DeadlinePicker
            value={deadlineDate}
            onChange={(iso) => setDeadlineDate(iso)}
            disabled={isPending}
          />
        </div>
      </div>

      {/* CREATE CTA BUTTON */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending}
        className="mt-6 w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-50 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all select-none"
      >
        {isPending ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Creating Pot...</span>
          </>
        ) : (
          <>
            <Lock className="h-4.5 w-4.5 stroke-[2.5]" />
            <span>Create & Launch Pot</span>
          </>
        )}
      </button>
    </div>
  );
}
