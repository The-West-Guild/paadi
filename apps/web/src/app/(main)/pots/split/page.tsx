"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCreatePotStore, SplitInput } from "@/features/create-pot/store";
import { toast } from "@/features/toast/store";
import { Plus, Trash2, HelpCircle } from "lucide-react";

export default function SplitPotPage() {
  const router = useRouter();
  const store = useCreatePotStore();

  const [title, setTitle] = useState(store.title);
  const [description, setDescription] = useState(store.description);
  const [totalAmountNaira, setTotalAmountNaira] = useState(
    store.totalKobo ? (store.totalKobo / 100).toString() : ""
  );
  const [splitMode, setSplitMode] = useState(store.splitMode);
  const [splits, setSplits] = useState<SplitInput[]>(store.splits);


  // Sync back to store on every change
  useEffect(() => {
    store.setField("title", title);
    store.setField("description", description);
    const amountKobo = Math.round((parseFloat(totalAmountNaira) || 0) * 100);
    store.setField("totalKobo", amountKobo);
    store.setField("splitMode", splitMode);
    store.setField("splits", splits);
  }, [title, description, totalAmountNaira, splitMode, splits]);

  function handleAddSplit() {
    if (splits.length >= 50) return;
    setSplits([...splits, { label: `Friend ${splits.length}`, weight: 1 }]);
  }

  function handleRemoveSplit(index: number) {
    if (splits.length <= 2) return;
    const newSplits = [...splits];
    newSplits.splice(index, 1);
    setSplits(newSplits);
  }

  function handleSplitChange(index: number, key: keyof SplitInput, val: any) {
    const newSplits = [...splits];
    newSplits[index] = { ...newSplits[index], [key]: val };
    setSplits(newSplits);
  }

  // Calculate sum for splits validation helper
  const totalKobo = Math.round((parseFloat(totalAmountNaira) || 0) * 100);
  let currentSum = 0;
  if (splitMode === "amount") {
    currentSum = splits.reduce((sum, s) => sum + (s.amountKobo || 0), 0);
  } else if (splitMode === "percent") {
    currentSum = splits.reduce((sum, s) => sum + (s.percent || 0), 0);
  }

  function handleNext() {
    // General Validations
    if (!title.trim() || title.length < 3 || title.length > 120) {
      toast.error("Title must be between 3 and 120 characters.");
      return;
    }
    if (totalKobo <= 0) {
      toast.error("Total collection amount must be greater than ₦0.");
      return;
    }
    if (splits.some((s) => !s.label.trim())) {
      toast.error("All participants must have a label.");
      return;
    }

    // Split Mode Validations
    if (splitMode === "amount") {
      const sum = splits.reduce((sum, s) => sum + (s.amountKobo || 0), 0);
      if (sum !== totalKobo) {
        toast.error(
          `The sum of all split amounts (₦${(sum / 100).toLocaleString()}) must equal the total pot amount (₦${(
            totalKobo / 100
          ).toLocaleString()}).`
        );
        return;
      }
    } else if (splitMode === "percent") {
      const sum = splits.reduce((sum, s) => sum + (s.percent || 0), 0);
      if (sum !== 100) {
        toast.error(`The sum of all split percentages (${sum}%) must equal exactly 100%.`);
        return;
      }
    }

    router.push("/pots/review");
  }

  return (
    <div className="w-full flex flex-col pb-6">
      {/* HEADER */}
      <div className="flex items-center justify-between w-full">
        <h1 className="text-2xl font-black text-ink tracking-tight">Pot Details</h1>
        <span className="text-xs font-bold text-ink/50 bg-ink/5 px-2.5 py-1 rounded-full">
          Step 2/3
        </span>
      </div>



      {/* BASIC POT FIELDS */}
      <div className="mt-5 flex flex-col gap-4 bg-white border border-slate-100 p-4 rounded-2xl shadow-sm">
        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
            Pot Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. December Suya Split 🍕"
            className="w-full bg-white border-2 border-ink rounded-xl px-4 py-3 text-sm font-semibold text-ink placeholder:text-ink/30 focus:outline-hidden focus:border-primary shadow-[2px_2px_0px_0px_#111827]"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
            Description (Optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this split collection for?"
            rows={2}
            className="w-full bg-white border-2 border-ink rounded-xl px-4 py-3 text-sm font-semibold text-ink placeholder:text-ink/30 focus:outline-hidden focus:border-primary shadow-[2px_2px_0px_0px_#111827] resize-none"
          />
        </div>

        {/* Total Naira Amount */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
            Total Pot Amount (₦)
          </label>
          <input
            type="number"
            value={totalAmountNaira}
            onChange={(e) => setTotalAmountNaira(e.target.value)}
            placeholder="50,000"
            className="w-full bg-white border-2 border-ink rounded-xl px-4 py-3 text-sm font-semibold text-ink placeholder:text-ink/30 focus:outline-hidden focus:border-primary shadow-[2px_2px_0px_0px_#111827]"
          />
        </div>
      </div>

      {/* SPLIT CONFIGURATION */}
      <div className="mt-5 flex flex-col gap-4 bg-white border border-slate-100 p-4 rounded-2xl shadow-sm">
        {/* Split Mode Tabs */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
            Split Formula
          </label>
          <div className="grid grid-cols-3 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100">
            <button
              type="button"
              onClick={() => {
                setSplitMode("weight");
                // Clear weights/amounts
                setSplits(splits.map((s) => ({ label: s.label, weight: 1 })));
              }}
              className={`py-2 rounded-lg text-xs font-extrabold flex items-center justify-center transition-all ${
                splitMode === "weight" ? "bg-white text-ink border border-slate-100 shadow-xs" : "text-ink/40"
              }`}
            >
              Weight (Equal)
            </button>
            <button
              type="button"
              onClick={() => {
                setSplitMode("amount");
                setSplits(splits.map((s) => ({ label: s.label, amountKobo: 0 })));
              }}
              className={`py-2 rounded-lg text-xs font-extrabold flex items-center justify-center transition-all ${
                splitMode === "amount" ? "bg-white text-ink border border-slate-100 shadow-xs" : "text-ink/40"
              }`}
            >
              Amount (Naira)
            </button>
            <button
              type="button"
              onClick={() => {
                setSplitMode("percent");
                setSplits(splits.map((s) => ({ label: s.label, percent: Math.round(100 / splits.length) })));
              }}
              className={`py-2 rounded-lg text-xs font-extrabold flex items-center justify-center transition-all ${
                splitMode === "percent" ? "bg-white text-ink border border-slate-100 shadow-xs" : "text-ink/40"
              }`}
            >
              Percent (%)
            </button>
          </div>
        </div>

        {/* Dynamic Splits List */}
        <div className="flex flex-col gap-1.5 mt-2">
          <div className="flex justify-between items-center px-1">
            <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40">
              Participants ({splits.length}/50)
            </label>
            {splitMode !== "weight" && (
              <span className="text-[10px] font-extrabold text-ink/40">
                Sum: {splitMode === "amount" ? `₦${(currentSum / 100).toLocaleString()} / ₦${(totalKobo / 100).toLocaleString()}` : `${currentSum}% / 100%`}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {splits.map((split, i) => (
              <div key={i} className="flex gap-2 items-center">
                {/* Remove split row */}
                <button
                  type="button"
                  onClick={() => handleRemoveSplit(i)}
                  disabled={splits.length <= 2}
                  className="p-2 text-ink/30 hover:text-danger disabled:opacity-30 transition-colors shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>

                {/* Label input */}
                <input
                  type="text"
                  value={split.label}
                  onChange={(e) => handleSplitChange(i, "label", e.target.value)}
                  placeholder="e.g. John"
                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-ink"
                />

                {/* Dynamic Value Input */}
                {splitMode === "weight" && (
                  <input
                    type="number"
                    value={split.weight || ""}
                    onChange={(e) => handleSplitChange(i, "weight", parseFloat(e.target.value) || 0)}
                    placeholder="1"
                    className="w-16 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-center text-ink"
                  />
                )}

                {splitMode === "amount" && (
                  <div className="relative w-24 shrink-0">
                    <span className="absolute left-2.5 top-2 text-xs font-bold text-ink/30">₦</span>
                    <input
                      type="number"
                      value={split.amountKobo ? (split.amountKobo / 100).toString() : ""}
                      onChange={(e) =>
                        handleSplitChange(i, "amountKobo", Math.round((parseFloat(e.target.value) || 0) * 100))
                      }
                      placeholder="0"
                      className="w-full bg-white border border-slate-200 rounded-xl pl-6 pr-3 py-2 text-xs font-semibold text-right text-ink"
                    />
                  </div>
                )}

                {splitMode === "percent" && (
                  <div className="relative w-20 shrink-0">
                    <input
                      type="number"
                      value={split.percent || ""}
                      onChange={(e) => handleSplitChange(i, "percent", parseInt(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full bg-white border border-slate-200 rounded-xl pr-6 pl-3 py-2 text-xs font-semibold text-right text-ink"
                    />
                    <span className="absolute right-2.5 top-2 text-xs font-bold text-ink/30">%</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleAddSplit}
            className="mt-3 flex items-center justify-center gap-1.5 py-3 border border-dashed border-ink/20 hover:border-ink/40 text-ink/50 hover:text-ink rounded-xl text-xs font-extrabold transition-all"
          >
            <Plus className="h-4 w-4" /> Add Participant
          </button>
        </div>
      </div>

      {/* FOOTER ACTION */}
      <button
        type="button"
        onClick={handleNext}
        className="mt-6 w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all select-none"
      >
        <span>Continue to Review</span>
        <span className="text-lg">➔</span>
      </button>
    </div>
  );
}
