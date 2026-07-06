"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useResendOtp, useVerifyPhone } from "@/features/onboarding/hooks";
import { toast } from "@/features/toast/store";
import { ApiError } from "@/lib/api/error";
import { AlarmClock } from "lucide-react";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 45;

export default function OtpPage() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const verifyPhone = useVerifyPhone();
  const resendOtp = useResendOtp();

  // Countdown timer
  useEffect(() => {
    if (cooldown === 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const code = digits.join("");

  // Auto-submit code when complete
  useEffect(() => {
    if (code.length === CODE_LENGTH && !verifyPhone.isPending) {
      verifyPhone.mutate(code, {
        onSuccess: () => router.push("/name"),
        onError: (err: Error) => {
          toast.error(err.message ?? "Invalid verification code.");
        }
      });
    }
  }, [code, router]);

  function handleChange(index: number, value: string) {
    const sanitizedValue = value.replace(/\D/g, "");
    if (!sanitizedValue) {
      const next = [...digits];
      next[index] = "";
      setDigits(next);
      return;
    }

    const targetDigit = sanitizedValue.slice(-1);
    const next = [...digits];
    next[index] = targetDigit;
    setDigits(next);

    if (index < CODE_LENGTH - 1) {
      setTimeout(() => {
        inputRefs.current[index + 1]?.focus();
      }, 10);
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (!digits[index] && index > 0) {
        const next = [...digits];
        next[index - 1] = "";
        setDigits(next);
        inputRefs.current[index - 1]?.focus();
      } else {
        const next = [...digits];
        next[index] = "";
        setDigits(next);
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!pastedData) return;

    const next = Array(CODE_LENGTH).fill("");
    for (let i = 0; i < pastedData.length; i++) {
      next[i] = pastedData[i];
    }
    setDigits(next);

    const focusIndex = Math.min(pastedData.length, CODE_LENGTH - 1);
    inputRefs.current[focusIndex]?.focus();
  }

  function handleResend(e: React.MouseEvent) {
    // 1. DEBUG LINE: Check your browser developer console to see if this fires!
    console.log("Resend button actively clicked. Cooldown state:", cooldown);
    
    e.preventDefault();
    e.stopPropagation();

    if (cooldown > 0 || resendOtp.isPending) {
      console.log("Resend blocked: cooldown active or request pending.");
      return;
    }

    resendOtp.mutate(undefined, {
      onSuccess: () => {
        console.log("Resend mutation successful.");
        toast.success("Verification code resent.");
        setCooldown(RESEND_COOLDOWN_S);
        setDigits(Array(CODE_LENGTH).fill(""));
        setTimeout(() => inputRefs.current[0]?.focus(), 50);
      },
      onError: (err: Error) => {
        toast.error(err.message ?? "Failed to resend code.");
      }
    });
  }

  const error = verifyPhone.error as ApiError | null;
  const isWrongCode = error?.statusCode === 401;
  const resendError = resendOtp.error as ApiError | null;
  const isResendThrottled = resendError?.statusCode === 429;

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-4 pb-6 pt-5 justify-between max-w-sm mx-auto overflow-y-auto">
      
     

      {/* CORE CONTENT BLOCK */}
      <div className="flex-1 flex flex-col items-center justify-start pt-6 w-full">
        <div className="text-center w-full shrink-0">
          <h1 className="text-2xl font-black tracking-tight text-ink leading-tight">Enter the code</h1>
          <p className="mt-2 text-xs font-medium text-ink/60 px-2 leading-relaxed">
            We sent a 6-digit verification code via SMS. Enter it below.
          </p>
        </div>

        {/* INPUT CELLS BOXES GRID - REDUCED SIZE FOR ACCURATE SCREEN FIT */}
        <div className="mt-8 flex justify-center gap-1.5 w-full max-w-full px-2" onPaste={handlePaste}>
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={verifyPhone.isPending}
              className={`h-12 w-10 sm:h-14 sm:w-12 max-w-[46px] flex-1 rounded-xl border-2 text-center text-lg font-black text-ink shadow-[0_2px_0px_0px_#111827] transition-all bg-white outline-none focus:border-primary ${
                isWrongCode ? "border-danger bg-red-50/30" : "border-ink"
              }`}
            />
          ))}
        </div>

        {/* ERROR MESSAGES CONTAINER */}
        <div className="w-full px-2 mt-4 shrink-0">
          {isWrongCode && (
            <p className="text-[11px] font-bold text-danger text-center bg-red-50 py-2 rounded-xl border border-danger/20">
              ⚠️ That code didn't work. Check it and try again.
            </p>
          )}
          {isResendThrottled && (
            <p className="text-[11px] font-bold text-danger text-center bg-red-50 py-2 rounded-xl border border-danger/20">
              ⏳ Please wait a moment before requesting another SMS.
            </p>
          )}
        </div>

        {/* RESEND LINK TRACKER CONTAINER */}
        <div className="mt-10 flex flex-col items-center justify-center gap-2.5 w-full relative z-30 shrink-0">
          <p className="text-center text-[11px] font-bold text-ink/40 tracking-wide uppercase">
            Didn't get a code?
          </p>
          
          <div className="relative">
            {cooldown > 0 ? (
              <div className="flex items-center gap-2 rounded-full bg-white border-2 border-ink px-4 py-1.5 text-xs font-black text-ink/60 shadow-[2px_2px_0px_0px_#111827]">
                <AlarmClock className="h-3.5 w-3.5 text-secondary" />
                <span>
                  {String(Math.floor(cooldown / 60)).padStart(2, "0")}:
                  {String(cooldown % 60).padStart(2, "0")}
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleResend}
                disabled={resendOtp.isPending}
                className="cursor-pointer relative rounded-full bg-primary border-2 border-ink px-6 py-2 text-xs font-black text-ink shadow-[2px_2px_0px_0px_#111827] active:translate-y-px active:shadow-[1px_1px_0px_0px_#111827] disabled:opacity-40 transition-all select-none"
                style={{ pointerEvents: 'auto' }}
              >
                {resendOtp.isPending ? "Resending…" : "Resend code"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* FOOTER FIXED PRIVACY COMPONENT */}
      <div className="w-full pt-4 shrink-0 relative z-10">
        <div className="relative flex items-start gap-3 overflow-hidden rounded-xl border-2 border-ink bg-pink-100 p-3.5 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-white border-2 border-ink text-xs font-bold">
            ✓
          </div>
          <div className="flex flex-col">
            <h4 className="text-xs font-black tracking-tight text-ink">Encrypted &amp; Secure</h4>
            <p className="text-[10px] font-semibold text-ink/60 mt-0.5 leading-tight">
              We use bank-grade encryption to protect your account setup.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}