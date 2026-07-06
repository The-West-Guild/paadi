"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  useBanks, 
  usePayoutAccounts, 
  useLookupPayoutAccount, 
  useCreatePayoutAccount, 
  useSetPrimaryPayoutAccount,
  useDeletePayoutAccount 
} from "@/features/settings/payout-hooks"; // Adjust path as needed
import { ChevronLeft, Plus, CheckCircle2, Trash2, ShieldCheck, Loader2, Delete, Landmark } from "lucide-react";
import { toast } from "@/features/toast/store";
import { ApiError } from "@/lib/api/error";


type FlowMode = "list" | "add_account";
type AddStep = "input" | "verify_pin";

export default function PayoutAccountsPage() {
  const router = useRouter();
  
  // Core Navigation Flow States
  const [mode, setMode] = useState<FlowMode>("list");
  const [addStep, setAddStep] = useState<AddStep>("input");

  // Form Entry States
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [pin, setPin] = useState<string[]>([]);
  const maxLength = 4;

  // React Query Hooks
  const { data: banksData, isLoading: isLoadingBanks } = useBanks();
  const { data: accountsData, isLoading: isLoadingAccounts } = usePayoutAccounts();
  
  const lookupMutation = useLookupPayoutAccount();
  const createMutation = useCreatePayoutAccount();
  const setPrimaryMutation = useSetPrimaryPayoutAccount();
  const deleteMutation = useDeletePayoutAccount();
  const createError = createMutation.error as ApiError | null;
  const deleteError = deleteMutation.error as ApiError | null;

  // Active state handlers for targeted item deletions
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletePin, setDeletePin] = useState<string[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showBankPicker, setShowBankPicker] = useState(false);
    const selectedBank = banksData?.banks.find((b) => b.code === bankCode);

  // 🛡️ TRAP GUARD: If bank or account number changes, wipe lookup data immediately
  useEffect(() => {
    if (lookupMutation.data || lookupMutation.error) {
      lookupMutation.reset();
    }
    if (addStep === "verify_pin") {
      setAddStep("input");
      setPin([]);
    }
  }, [bankCode, accountNumber]);

  // Keypad controls for PIN authorization
  function handlePinPress(num: string) {
    if (showDeleteModal) {
      if (deletePin.length < maxLength) setDeletePin((prev) => [...prev, num]);
    } else {
      if (pin.length < maxLength) setPin((prev) => [...prev, num]);
    }
  }

  function handlePinDelete() {
    if (showDeleteModal) {
      setDeletePin((prev) => prev.slice(0, -1));
    } else {
      setPin((prev) => prev.slice(0, -1));
    }
  }

  // Trigger Step B: Lookup Verification
  function handleLookup() {
    if (!bankCode || accountNumber.length !== 10) return;
    lookupMutation.mutate({ bankCode, accountNumber });
  }

  // Trigger Step E: Final Execution Commit
  function handleCommitCreate() {
    if (pin.length !== maxLength) return;
    
    createMutation.mutate(
      { bankCode, accountNumber, pin: pin.join("") },
      {
        onSuccess: () => {
          toast.success("Payout account added successfully!");
          // Step F: Success Reset & Return
          setMode("list");
          setAddStep("input");
          setBankCode("");
          setAccountNumber("");
          setPin([]);
        },
        onError: (err: any) => {
          toast.error(
            err.statusCode === 401
              ? "Incorrect PIN. Please try again."
              : err.message ?? "Failed to add account. Try again."
          );
          setPin([]);
        }
      }
    );
  }

  function handleCommitDelete() {
    if (!deletingId || deletePin.length !== maxLength) return;
    
    deleteMutation.mutate(
      { id: deletingId, pin: deletePin.join("") },
      {
        onSuccess: () => {
          toast.success("Payout account removed.");
          setShowDeleteModal(false);
          setDeletingId(null);
          setDeletePin([]);
        },
        onError: (err: any) => {
          toast.error(
            err.statusCode === 401
              ? "Incorrect PIN. Please try again."
              : err.message ?? "Delete failed. Try again."
          );
          setDeletePin([]);
        }
      }
    );
  }

  return (
    <div className="w-full flex flex-col">
      
      {/* HEADER BAR */}
      {/* <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (mode === "add_account") {
                if (addStep === "verify_pin") setAddStep("input");
                else setMode("list");
              } else {
                router.back();
              }
            }}
            className="p-1.5 rounded-lg hover:bg-ink/5 text-ink/60 transition-colors mr-1"
          >
            <ChevronLeft className="h-5 w-5 stroke-[2.5]" />
          </button>
          <h1 className="text-2xl font-black text-ink tracking-tight">
            {mode === "list" ? "Payout Accounts" : "Add Account"}
          </h1>
        </div>
        
      </div> */}

      {/* =========================================
          MODE 1: MAIN LIST VIEW 
         ========================================= */}
      {mode === "list" && (
        <div className="flex flex-col gap-4">
          {isLoadingAccounts ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Loader2 className="h-5 w-5 text-secondary animate-spin" />
              <p className="text-xs font-semibold text-ink/40">Loading accounts...</p>
            </div>
          ) : accountsData?.accounts.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-ink/10 p-8 text-center bg-slate-50/50">
              <Landmark className="h-8 w-8 text-ink/30 mx-auto mb-3 stroke-[1.5]" />
              <p className="text-sm font-bold text-ink/70">No settlement account linked</p>
              <p className="text-xs font-semibold text-ink/40 mt-1 max-w-[220px] mx-auto">
                Add where your group payouts settle out instantly into cold cash.
              </p>
            </div>
          ) : (
            accountsData?.accounts.map((acc) => (
              <div 
                key={acc.id}
                className={`rounded-2xl border bg-white p-4 flex items-center justify-between gap-3 shadow-[0_4px_20px_rgba(0,0,0,0.02)] transition-all ${
                  acc.isPrimary ? "border-primary-hover bg-primary/5" : "border-slate-100"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!acc.isPrimary) {
                      setPrimaryMutation.mutate(acc.id, {
                        onSuccess: () => toast.success("Primary payout account updated."),
                        onError: (err: Error) => toast.error(err.message ?? "Failed to update primary account.")
                      });
                    }
                  }}
                  className="flex-1 flex items-start gap-3 text-left"
                >
                  <div className="h-10 w-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-ink/60 shrink-0 mt-0.5">
                    <Landmark className="h-5 w-5 stroke-2" />
                  </div>
                  <div className="min-w-0 flex flex-col">
                    <span className="text-sm font-black text-ink truncate uppercase tracking-tight">
                      {acc.accountName}
                    </span>
                    <span className="text-xs font-bold text-ink/50 mt-0.5">
                    {acc.bankName} • ••••{acc.accountNumberLast4}
                    </span>
                    {acc.isPrimary && (
                      <span className="text-[10px] font-black text-secondary tracking-wide bg-secondary/10 px-2 py-0.5 rounded-md mt-1 w-fit border border-secondary/10">
                        PRIMARY PAYOUT
                      </span>
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDeletingId(acc.id);
                    setDeletePin([]);
                    setShowDeleteModal(true);
                  }}
                  className="p-2 text-ink/30 hover:text-danger rounded-xl hover:bg-danger/5 transition-colors"
                >
                  <Trash2 className="h-4 w-4 stroke-2" />
                </button>
              </div>
            ))
          )}

                {mode === "list" && (
                <button
                    type="button"
                    onClick={() => setMode("add_account")}
                    className="mt-6 w-full rounded-2xl bg-primary py-4 font-black text-ink text-sm border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] flex items-center justify-center gap-2"
                >
                    <Plus className="h-4 w-4 stroke-3" /> Add payout account
                </button>
                )}
        </div>
      )}

      {/* =========================================
          MODE 2: TWO-STEP ADD WIZARD
         ========================================= */}
      {mode === "add_account" && (
        <div className="flex flex-col w-full">
          {addStep === "input" ? (
            <div className="flex flex-col gap-5">
              {/* Bank Selector Row */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-black text-ink/60 tracking-wide uppercase">Select Bank</label>
                <div className="flex flex-col gap-2">
  <button
    type="button"
    onClick={() => setShowBankPicker(true)}
    className="w-full h-13 rounded-xl border-2 border-slate-100 bg-white px-4 text-left text-sm font-bold text-ink shadow-sm outline-none focus:border-ink/20 transition-all"
  >
    {selectedBank ? selectedBank.name : "Choose partner institution..."}
  </button>
</div>
              </div>

              {/* Account Number Box */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-black text-ink/60 tracking-wide uppercase">Account Number</label>
                <input
                  type="tel"
                  maxLength={10}
                  pattern="[0-9]*"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="0000000000"
                  className="w-full h-13 rounded-xl border-2 border-slate-100 bg-white px-4 text-base font-black tracking-widest text-ink shadow-sm outline-none focus:border-ink/20 placeholder:tracking-normal placeholder:font-medium transition-all"
                />
              </div>

              {/* Step C: Display Lookup Verification Yield */}
              {lookupMutation.isPending && (
                <div className="flex items-center gap-2 py-3 px-1">
                  <Loader2 className="h-4 w-4 text-secondary animate-spin" />
                  <span className="text-xs font-semibold text-ink/50">Querying clearing house registry...</span>
                </div>
              )}

              {lookupMutation.error && (
                <div className="rounded-xl border border-danger/20 bg-danger/5 p-3.5 text-xs font-bold text-danger leading-relaxed">
                  ❌ Account verification failed. Double-check your numbers.
                </div>
              )}

              {lookupMutation.data && (
                <div className="rounded-2xl border-2 border-success/30 bg-success/5 p-4 flex items-start gap-3 shadow-sm animate-slide-up">
                  <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-success/70 uppercase tracking-wider">Verified Identity Matched</span>
                    <span className="text-sm font-black text-ink uppercase mt-0.5 tracking-tight">
                      {lookupMutation.data.accountName}
                    </span>
                    <span className="text-xs font-medium text-ink/50 mt-1 leading-relaxed">
                      If this isn&apos;t your legal name, edit digits above to avoid matching routes to strangers.
                    </span>
                  </div>
                </div>
              )}

              {/* Step D Actions Button Toggle */}
              {!lookupMutation.data ? (
                <button
                  type="button"
                  disabled={!bankCode || accountNumber.length !== 10 || lookupMutation.isPending}
                  onClick={handleLookup}
                  className="w-full mt-2 rounded-2xl bg-ink py-4 font-black text-white text-sm border-2 border-ink shadow-[0_4px_0px_0px_#6b7280] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#6b7280] disabled:opacity-30 disabled:active:translate-y-0 disabled:shadow-none transition-all"
                >
                  Verify Account
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddStep("verify_pin")}
                  className="w-full mt-2 rounded-2xl bg-primary py-4 font-black text-ink text-sm border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all"
                >
                  Yes, That Is Me ➔
                </button>
              )}
            </div>
          ) : (
            // =========================================
            // SUB-STEP: PIN RE-VERIFICATION PATTERN
            // =========================================
            <div className="flex flex-col items-center w-full">
              <div className="w-12 h-12 bg-secondary/10 border-2 border-ink rounded-xl flex items-center justify-center text-ink mb-4 shadow-[2px_2px_0px_0px_#111827]">
                <ShieldCheck className="h-5 w-5 stroke-[2.5]" />
              </div>

              <div className="text-center w-full px-4 mb-6">
                <h3 className="text-lg font-black text-ink tracking-tight">Authorize Attachment</h3>
                <p className="text-xs font-semibold text-ink/50 mt-1 max-w-[240px] mx-auto leading-relaxed">
                  Enter your 4-digit security PIN to bind this settlement channel permanently to your profile wallet.
                </p>
              </div>

              {/* Dynamic Dot Indicators */}
              <div className="flex items-center justify-center gap-5 mb-8">
                {Array.from({ length: maxLength }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`w-4 h-4 rounded-full border-2 border-ink transition-all ${
                      pin[idx] !== undefined ? "bg-secondary scale-110" : "bg-white"
                    }`}
                  />
                ))}
              </div>



              {/* Premium Numeric Matrix */}
              <div className="w-full grid grid-cols-3 gap-y-4 gap-x-6 px-4 mb-6">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handlePinPress(num)}
                    className="py-3 rounded-xl active:bg-ink/5 text-xl font-black text-ink flex items-center justify-center"
                  >
                    {num}
                  </button>
                ))}
                <div />
                <button
                  type="button"
                  onClick={() => handlePinPress("0")}
                  className="py-3 text-xl font-black text-ink flex items-center justify-center"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handlePinDelete}
                  className="py-3 text-ink/50 flex items-center justify-center"
                >
                  <Delete className="h-5 w-5 stroke-[2.5]" />
                </button>
              </div>

              <button
                type="button"
                disabled={pin.length !== maxLength || createMutation.isPending}
                onClick={handleCommitCreate}
                className="w-full rounded-2xl bg-primary py-4 font-black text-ink text-sm border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-40 disabled:active:translate-y-0 transition-all"
              >
                {createMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Binding Layer...
                  </span>
                ) : (
                  "Confirm & Add Account"
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* =========================================
          MODAL CONTEXT: PIN-GATED DELETION DIALOG
         ========================================= */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-ink/60 z-100 flex items-end justify-center p-5 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-3xl border-2 border-ink p-6 shadow-[0_10px_0px_0px_#111827] animate-slide-up">
            
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-xl bg-danger/10 text-danger border-2 border-danger/20">
                <Trash2 className="h-5 w-5 stroke-[2.5]" />
              </div>
              <h3 className="text-lg font-black text-ink tracking-tight">Remove payout path?</h3>
            </div>

            <p className="text-xs font-semibold text-ink/70 leading-relaxed mb-4">
              Enter your 4-digit transaction security PIN to authorize decoupling this banking settlement channel destination.
            </p>

            {/* Micro Delete Indicators */}
            <div className="flex items-center justify-center gap-4 mb-6">
              {Array.from({ length: maxLength }).map((_, idx) => (
                <div
                  key={idx}
                  className={`w-3.5 h-3.5 rounded-full border-2 border-ink transition-all ${
                    deletePin[idx] !== undefined ? "bg-danger scale-110" : "bg-white"
                  }`}
                />
              ))}
            </div>



            {/* Miniature Input Core */}
            <div className="w-full grid grid-cols-3 gap-y-2 gap-x-4 px-2 mb-6">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handlePinPress(num)}
                  className="py-2 active:bg-ink/5 text-base font-black text-ink flex items-center justify-center"
                >
                  {num}
                </button>
              ))}
              <div />
              <button
                type="button"
                onClick={() => handlePinPress("0")}
                className="py-2 text-base font-black text-ink flex items-center justify-center"
              >
                0
              </button>
              <button
                type="button"
                onClick={handlePinDelete}
                className="py-2 text-ink/40 flex items-center justify-center"
              >
                <Delete className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={deletePin.length !== maxLength || deleteMutation.isPending}
                onClick={handleCommitDelete}
                className="w-full rounded-2xl bg-danger py-3.5 font-bold text-white text-sm border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-40 transition-all"
              >
                {deleteMutation.isPending ? "Severing Channel..." : "Yes, Delete Path"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeletingId(null);
                  setDeletePin([]);
                }}
                className="w-full py-2.5 text-xs font-bold text-ink/40 text-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

{showBankPicker && (
  <div className="fixed inset-0 bg-ink/60 z-100 flex items-end justify-center p-5 backdrop-blur-sm">
    <div className="w-full max-w-sm max-h-[70vh] overflow-y-auto bg-white rounded-3xl border-2 border-ink p-4 shadow-[0_10px_0px_0px_#111827]">
      <h3 className="px-2 pb-3 text-lg font-black text-ink">Choose your bank</h3>
      {banksData?.banks.map((bank) => (
        <button
          key={bank.code}
          type="button"
          onClick={() => {
            setBankCode(bank.code);
            setShowBankPicker(false);
          }}
          className="w-full rounded-xl px-3 py-3 text-left text-sm font-bold text-ink active:bg-slate-50"
        >
          {bank.name}
        </button>
      ))}
    </div>
  </div>
)}

    </div>
  );
}