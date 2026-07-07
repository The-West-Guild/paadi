"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Delete } from "lucide-react";
import { useSignupPin } from "@/features/onboarding/hooks";
import { toast } from "@/features/toast/store";
import { ApiError } from "@/lib/api/error";

export default function PinSetupPage() {
  const router = useRouter();
  const [pin, setPin] = useState<string[]>([]);
  const maxLength = 4;
  const signupPin = useSignupPin();
  const isPending = signupPin.isPending;
  const error = signupPin.error as ApiError | null;   // ← move it here

  function handleKeyPress(num: string) {
    if (pin.length < maxLength) {
      setPin((prev) => [...prev, num]);
    }
  }

  function handleDelete() {
    setPin((prev) => prev.slice(0, -1));
  }

  function handleSubmit() {
    if (pin.length !== maxLength || isPending) return;

    signupPin.mutate(pin.join(""), {
      onSuccess: () => router.push("/biometric"),
      onError: (err: Error & { statusCode?: number }) => {
        toast.error(
          err.statusCode === 401
            ? "That doesn't look right. Try a different PIN."
            : "Couldn't set your PIN. Please try again."
        );
      }
    });

    
  }

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-8 pt-5 justify-between max-w-sm mx-auto overflow-y-auto select-none">


      {/* CORE DISPLAY HUB */}
      <div className="flex-1 flex flex-col items-center justify-center w-full max-y-[380px] my-auto">
        
        {/* Security Pad Frame Icon */}
        <div className="w-14 h-14 bg-primary border-2 border-ink rounded-2xl flex items-center justify-center text-2xl font-black text-ink mb-6 shadow-[2px_2px_0px_0px_#111827]">
          🔢
        </div>

        {/* Messaging Headers */}
        <div className="w-full text-center shrink-0 mb-8">
          <h1 className="text-[26px] font-black tracking-tight text-ink leading-tight">
            Create a secure PIN
          </h1>
          <p className="mt-2 text-xs font-medium text-ink/60 px-4 leading-relaxed">
            This code protects fast transfers and wallet lock status updates.
          </p>
        </div>

        {/* DYNAMIC CODE INDICATORS ROWS */}
        <div className="flex items-center justify-center gap-5 mb-12">
          {Array.from({ length: maxLength }).map((_, idx) => {
            const hasDigit = pin[idx] !== undefined;
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

        

        {/* TOUCH INTERACTION GRID MATRIX */}
        <div className="w-full grid grid-cols-3 gap-y-4 gap-x-6 px-4">
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
          
          {/* Empty Space filler for matrix grid geometry layout */}
          <div className="w-full" />
          
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
            disabled={pin.length === 0}
            className="py-3.5 rounded-xl text-ink/50 hover:text-ink disabled:opacity-20 transition-colors flex items-center justify-center"
          >
            <Delete className="h-5 w-5 stroke-[2.5]" />
          </button>
        </div>
          
      </div>

      {/* FOOTER CALL TO ACTION */}
      <div className="w-full mt-auto pt-4 shrink-0">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pin.length !== maxLength || isPending}
          className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-40 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all select-none"
        >
          <span>Lock Code & Continue</span>
          <span className="text-lg">➔</span>
        </button>
      </div>

    </div>
  );
}