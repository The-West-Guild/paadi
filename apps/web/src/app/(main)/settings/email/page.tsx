"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useEmailStart, useEmailVerify } from "@/features/settings/profile-hooks";
import { toast } from "@/features/toast/store";
import { Loader2, Mail, CheckCircle } from "lucide-react";

export default function EmailSettingsPage() {
  const router = useRouter();
  const emailStartMutation = useEmailStart();
  const emailVerifyMutation = useEmailVerify();

  const [step, setStep] = useState<"enter_email" | "verify_code">("enter_email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);

  const isPending = emailStartMutation.isPending || emailVerifyMutation.isPending;

  function handleStart(e: React.FormEvent) {
    e.preventDefault();

    if (!email.trim() || !email.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }

    emailStartMutation.mutate(email, {
      onSuccess: () => {
        setStep("verify_code");
        toast.success("Verification code sent to your email.");
      },
      onError: (err: Error) => {
        toast.error(err.message ?? "Failed to initiate email verification.");
      },
    });
  }

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();

    if (code.length !== 6) {
      toast.error("Verification code must be exactly 6 digits.");
      return;
    }

    emailVerifyMutation.mutate(code, {
      onSuccess: () => {
        setIsSuccess(true);
        toast.success("Email successfully verified!");
        setTimeout(() => {
          router.push("/settings/profile");
        }, 2000);
      },
      onError: (err: Error) => {
        toast.error(err.message ?? "Verification failed. Check the code and try again.");
      },
    });
  }

  return (
    <div className="w-full flex flex-col">
      {/* HEADER */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (step === "verify_code") {
              setStep("enter_email");
            } else {
              router.back();
            }
          }}
          className="text-xl font-bold p-1 text-ink/75 hover:text-ink transition-colors"
        >
          ←
        </button>
        <h1 className="text-2xl font-black text-ink tracking-tight">Email Settings</h1>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
        {step === "enter_email" ? (
          <form onSubmit={handleStart} className="flex flex-col gap-4">
            <div className="flex flex-col items-center text-center py-2 shrink-0">
              <div className="h-12 w-12 rounded-full bg-primary/10 border border-ink/5 text-primary flex items-center justify-center mb-3">
                <Mail className="h-6 w-6 text-ink" />
              </div>
              <h2 className="font-black text-ink text-base leading-tight">Verify Email Address</h2>
              <p className="mt-1.5 text-xs text-ink/40 max-w-[240px] leading-relaxed">
                Add and verify an email address to secure your account and receive split receipts.
              </p>
            </div>

            <div className="flex flex-col gap-1.5 mt-2">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isPending}
                placeholder="you@example.com"
                className="w-full bg-white border-2 border-ink rounded-xl px-4 py-3.5 text-sm font-semibold text-ink placeholder:text-ink/30 focus:outline-hidden focus:border-primary shadow-[2px_2px_0px_0px_#111827] disabled:opacity-50 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-50 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all select-none mt-2"
            >
              {isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <span>Continue</span>
                  <span className="text-lg">➔</span>
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="flex flex-col gap-4">
            <div className="flex flex-col items-center text-center py-2 shrink-0">
              <div className="h-12 w-12 rounded-full bg-primary/10 border border-ink/5 text-primary flex items-center justify-center mb-3">
                <CheckCircle className="h-6 w-6 text-ink" />
              </div>
              <h2 className="font-black text-ink text-base leading-tight">Enter verification code</h2>
              <p className="mt-1.5 text-xs text-ink/40 max-w-[240px] leading-relaxed">
                We sent a 6-digit code to <span className="font-bold text-ink">{email}</span>. Enter it below to verify.
              </p>
            </div>

            <div className="flex flex-col gap-1.5 mt-2">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1 text-center">
                Verification Code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                disabled={isPending || isSuccess}
                placeholder="000000"
                className="w-full bg-white border-2 border-ink rounded-xl px-4 py-3.5 text-sm font-semibold text-ink placeholder:text-ink/30 text-center tracking-widest focus:outline-hidden focus:border-primary shadow-[2px_2px_0px_0px_#111827] disabled:opacity-50 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={isPending || isSuccess}
              className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-50 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all select-none mt-2"
            >
              {isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <span>Verify Email</span>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
