"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Lock, LogOut, ShieldAlert, Delete, Loader2, CheckCircle2 } from "lucide-react";
import { useChangePin, useLogout, useLogoutAll, useVerifyPin } from "@/features/settings/profile-hooks";
import { toast } from "@/features/toast/store";
import { ApiError } from "@/lib/api/error";

type ChangePinStep = "menu" | "current" | "new" | "confirm" | "success";

export default function SecurityPage() {
  const router = useRouter();
  
  // UI State for managing the multi-step PIN change flow
  const [pinStep, setPinStep] = useState<ChangePinStep>("menu");
  const [currentPin, setCurrentPin] = useState<string[]>([]);
  const [newPin, setNewPin] = useState<string[]>([]);
  const [confirmPin, setConfirmPin] = useState<string[]>([]);
  const [flowError, setFlowError] = useState<string | null>(null);

  const changePin = useChangePin();
  const logout = useLogout();
  const logoutAll = useLogoutAll(); 
  const verifyPin = useVerifyPin();
  const error = changePin.error as ApiError | null;

  
  const maxLength = 4;
  const isPending = changePin.isPending || logout.isPending || logoutAll.isPending; // changePin.isPending || logout.isPending

  function submitPinChange() {
    changePin.mutate(
      { currentPin: currentPin.join(""), newPin: newPin.join("") },
      {
        onSuccess: () => {
          toast.success("PIN updated successfully!");
          setPinStep("success");
        },
        onError: () => {
          // wrong current PIN -> send them back to re-enter it
          toast.error("Incorrect PIN. Please try again.");
          setCurrentPin([]);
          setPinStep("current");
        },
      }
    );
  }

  // Keypad interaction handler reused from onboarding
  function handleKeyPress(num: string) {
    if (pinStep === "current" && currentPin.length < maxLength) {
      setCurrentPin((prev) => [...prev, num]);
    } else if (pinStep === "new" && newPin.length < maxLength) {
      setNewPin((prev) => [...prev, num]);
    } else if (pinStep === "confirm" && confirmPin.length < maxLength) {
      setConfirmPin((prev) => [...prev, num]);
    }
  }

  function handleDelete() {
    if (pinStep === "current") {
      setCurrentPin((prev) => prev.slice(0, -1));
    } else if (pinStep === "new") {
      setNewPin((prev) => prev.slice(0, -1));
    } else if (pinStep === "confirm") {
      setConfirmPin((prev) => prev.slice(0, -1));
    }
  }

  // Multi-step flow controller
  function advancePinStep() {
    setFlowError(null); 
    if (pinStep === "current" && currentPin.length === maxLength) {
        verifyPin.mutate(currentPin.join(""), {
            onSuccess: () => setPinStep("new"),
            onError: () => {
                toast.error("That PIN didn't match. Try again.");
                setCurrentPin([]);
                setFlowError("That PIN didn't match. Try again.");
              },
          });
          return;
    } else if (pinStep === "new" && newPin.length === maxLength) {
      // Basic validation: ensure new PIN isn't the same as current
      if (newPin.join("") === currentPin.join("")) {
        setFlowError("PINs don't match. Try setting your new PIN again.");
        setNewPin([]);
        return;
      }
      setPinStep("confirm");
    } else if (pinStep === "confirm" && confirmPin.length === maxLength) {
      // Basic validation: ensure confirmation matches
      if (confirmPin.join("") !== newPin.join("")) {
        setFlowError("Pin Not Confimred. Set again");
        setNewPin([]);
        setConfirmPin([]);
        setPinStep("new"); // Loop back to 'new' state on mismatch
        return;
      }
      submitPinChange();
    }
  }

  // Modal State for Logout Everywhere Confirmation
  const [showLogoutAllModal, setShowLogoutAllModal] = useState(false);

  // Logout Handlers - connect hooks here
  function handleLogoutThisDevice() {
    logout.mutate(undefined, {
      onSuccess: () => router.push("/welcome"),
      onError: (err: Error) => {
        toast.error(err.message ?? "Logout failed. Please try again.");
      }
    });
  }

  function handleLogoutEverywhere() {
    logoutAll.mutate(undefined, {
      onSuccess: () => {
        setShowLogoutAllModal(false);
        router.push("/welcome");
      },
      onError: (err: Error) => {
        toast.error(err.message ?? "Logout failed. Please try again.");
      }
    });
  }

  // Reusable component for the PIN entry visualization
  const PinIndicators = ({ pinArray }: { pinArray: string[] }) => (
    <div className="flex items-center justify-center gap-5 mb-10 mt-6 select-none">
      {Array.from({ length: maxLength }).map((_, idx) => {
        const hasDigit = pinArray[idx] !== undefined;
        return (
          <div
            key={idx}
            className={`w-5 h-5 rounded-full border-2 border-ink transition-all duration-150 ${
              hasDigit 
                ? "bg-secondary scale-110 shadow-[1px_1px_0px_0px_#111827]" 
                : "bg-white"
            }`}
          />
        );
      })}
    </div>
  );

 

  // Reusable numeric keypad component
  const NumericKeypad = () => (
    <div className="w-full grid grid-cols-3 gap-y-4 gap-x-6 px-4 mb-10 select-none">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
        <button
          key={num}
          type="button"
          onClick={() => handleKeyPress(num)}
          className="py-3.5 rounded-xl border border-transparent active:border-ink/20 active:bg-ink/5 text-xl font-black text-ink transition-all flex items-center justify-center"
        >
          {num}
        </button>
      ))}
      <div className="w-full" /> {/* Grid spacer */}
      <button
        type="button"
        onClick={() => handleKeyPress("0")}
        className="py-3.5 rounded-xl border border-transparent active:border-ink/20 active:bg-ink/5 text-xl font-black text-ink transition-all flex items-center justify-center"
      >
        0
      </button>
      <button
        type="button"
        onClick={handleDelete}
        className="py-3.5 rounded-xl text-ink/50 hover:text-ink transition-colors flex items-center justify-center"
      >
        <Delete className="h-5 w-5 stroke-[2.5]" />
      </button>
    </div>
  );

  return (
    <div className="w-full flex flex-col">
      {/* HEADER BAR - Conditional back action based on PIN flow state */}
      {/* <div className="flex items-center gap-2 mb-6">
        <button
          type="button"
          onClick={() => pinStep === "menu" ? router.back() : setPinStep("menu")}
          className="p-1.5 rounded-lg hover:bg-ink/5 text-ink/60 transition-colors mr-1"
        >
          <ChevronLeft className="h-5 w-5 stroke-[2.5]" />
        </button>
        <h1 className="text-2xl font-black text-ink tracking-tight">Security</h1>
      </div> */}

      {/* --- RENDER LOGIC BASED ON PIN CHANGE STEP --- */}

      {pinStep === "menu" && (
        <div className="flex flex-col gap-6">
          {/* Card 1: PIN Management */}
          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex items-start gap-4">
            <div className="w-12 h-12 bg-primary/20 border-2 border-ink rounded-xl flex items-center justify-center text-ink shrink-0 shadow-[2px_2px_0px_0px_#111827]">
              <Lock className="h-6 w-6 stroke-2" />
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <h2 className="text-base font-black text-ink leading-tight">Transaction PIN</h2>
              <p className="text-xs font-semibold text-ink/50 leading-relaxed">
                Required for transfers, withdrawals, and setting locks.
              </p>
              <button 
                type="button"
                onClick={() => {
                    setCurrentPin([]); setNewPin([]); setConfirmPin([]);
                    setFlowError(null); // also reset here
                    setPinStep("current");
                  }}
                className="mt-2 text-xs font-black text-secondary hover:text-secondary/80 text-left"
              >
                Change PIN →
              </button>
            </div>
          </div>

          {/* Card 2: Logout Actions (Toned down brutalism) */}
          <div className="rounded-2xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.02)] overflow-hidden">
            <button
              type="button"
              onClick={handleLogoutThisDevice}
              disabled={isPending}
              className="w-full flex items-center gap-3.5 px-5 py-4.5 text-left border-b border-slate-100 active:bg-slate-50/60 transition-colors"
            >
              <LogOut className="h-5 w-5 text-ink/60 stroke-[2.25]" />
              <span className="flex-1 font-bold text-sm text-ink/80">Log out this device</span>
            </button>
            <button
              type="button"
              onClick={() => setShowLogoutAllModal(true)}
              disabled={isPending}
              className="w-full flex items-center gap-3.5 px-5 py-4.5 text-left text-danger active:bg-danger/5 transition-colors"
            >
              <ShieldAlert className="h-5 w-5 text-danger stroke-[2.25]" />
              <span className="flex-1 font-bold text-sm">Log out everywhere</span>
            </button>
          </div>
        </div>
      )}

      {/* --- PIN CHANGE FLOW STATES --- */}

      {pinStep !== "menu" && pinStep !== "success" && (
        <div className="flex flex-col items-center flex-1 w-full">
          {/* Flow Header Icon */}
          <div className="w-14 h-14 bg-primary border-2 border-ink rounded-2xl flex items-center justify-center text-2xl font-black text-ink mb-6 mt-4 shadow-[2px_2px_0px_0px_#111827]">
            🔢
          </div>

          {/* Dynamic Messaging */}
          <div className="w-full text-center shrink-0 px-4">
            <h1 className="text-xl font-black tracking-tight text-ink leading-tight">
              {pinStep === "current" && "Verify your identity"}
              {pinStep === "new" && "Set new PIN"}
              {pinStep === "confirm" && "Confirm new PIN"}
            </h1>
            <p className="mt-2 text-xs font-medium text-ink/60 leading-relaxed max-w-[260px] mx-auto">
              {pinStep === "current" && "Enter your current 4-digit Transaction PIN to proceed."}
              {pinStep === "new" && "Create a new 4-digit code. Avoid obvious sequences."}
              {pinStep === "confirm" && "Re-enter the new PIN to confirm it's correct."}
            </p>
          </div>

          {/* Indicators & Keypad */}
          {pinStep === "current" && <PinIndicators pinArray={currentPin} />}
{pinStep === "new" && <PinIndicators pinArray={newPin} />}
{pinStep === "confirm" && <PinIndicators pinArray={confirmPin} />}

          {flowError && (
  <p className="mb-4 text-center text-xs font-semibold text-danger">
    {flowError}
  </p>
)}

          

          <div className="flex-1" /> {/* Spacer to push keypad down */}
          <NumericKeypad />

          {/* Continue Button (Soft Brutalist Action style) */}
          <button
            type="button"
            onClick={advancePinStep}
            // Check if full PIN entered for current step
            disabled={isPending || (
              (pinStep === "current" && currentPin.length !== maxLength) ||
              (pinStep === "new" && newPin.length !== maxLength) ||
              (pinStep === "confirm" && confirmPin.length !== maxLength)
            )}
            className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-40 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all select-none"
          >
            {isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Updating PIN...</span>
              </>
            ) : (
              <span>Continue</span>
            )}
            {!isPending && <span className="text-lg">➔</span>}
          </button>
        </div>
      )}

      {/* SUCCESS STATE --- Reuses Tier Ready style */}
      {pinStep === "success" && (
        <div className="flex-1 flex flex-col items-center justify-center w-full my-auto mt-10">
          <div className="w-16 h-16 bg-success/10 border-2 border-success rounded-[24px] flex items-center justify-center text-success mb-6 shadow-[2px_2px_0px_0px_#10B981]">
            <CheckCircle2 className="h-8 w-8 stroke-[2.5]" />
          </div>
          <div className="w-full text-center shrink-0 mb-6 px-6">
            <h1 className="text-xl font-black tracking-tight text-ink leading-tight">
              PIN Updated!
            </h1>
            <p className="mt-2 text-xs font-medium text-ink/60 leading-relaxed">
              Your Transaction PIN has been securely changed. Please use the new code for future authorizations.
            </p>
          </div>
          <button 
            type="button" 
            onClick={() => setPinStep("menu")}
            className="text-sm font-bold text-secondary"
          >
            Go back
          </button>
        </div>
      )}


      {/* --- CONFIRMATION MODAL: Logout Everywhere --- */}
      {showLogoutAllModal && (
        <div className="fixed inset-0 bg-ink/60 z-100 flex items-end justify-center p-5 backdrop-blur-sm">
          {/* Modal Card - Soft Brutalist style */}
          <div className="w-full max-w-sm bg-white rounded-3xl border-2 border-ink p-6 shadow-[0_10px_0px_0px_#111827] animate-slide-up">
            
            {/* Destructive Warning Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-danger/10 text-danger border-2 border-danger/20">
                <ShieldAlert className="h-6 w-6 stroke-[2.5]" />
              </div>
              <h3 className="text-lg font-black text-ink tracking-tight">Revoke all sessions?</h3>
            </div>

            <p className="text-xs font-semibold text-ink/70 leading-relaxed mb-6">
              This will log you out of **every device** currently connected to your Paadi account, including this one. You will need to enter your password and PIN again to reconnect.
            </p>

            {/* Action Buttons Stack */}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleLogoutEverywhere}
                disabled={isPending}
                className="w-full rounded-2xl bg-danger py-3.5 px-4 font-bold text-white text-sm flex items-center justify-center border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all select-none"
              >
                {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Yes, log me out everywhere"}
              </button>
              <button
                type="button"
                onClick={() => setShowLogoutAllModal(false)}
                disabled={isPending}
                className="w-full py-3 text-xs font-bold text-ink/50 hover:text-ink transition-colors text-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}