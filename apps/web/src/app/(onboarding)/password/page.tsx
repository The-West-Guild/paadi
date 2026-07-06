"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { useSignupPassword } from "@/features/onboarding/hooks";
import { toast } from "@/features/toast/store";
import { ApiError } from "@/lib/api/error";

export default function PasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const signupPassword = useSignupPassword()

  const isPending = signupPassword.isPending;

  // Real-time strength checks
  const hasMinLength = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const hasLetter = /[a-zA-Z]/.test(password);
  const isValid = hasMinLength && hasNumber && hasLetter;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || isPending) return;

    signupPassword.mutate(password, {
      onSuccess: () => router.push("/pin"),
      onError: (err: Error) => {
        toast.error(
          err.message === "phone not verified"
            ? "Something went wrong earlier in signup — please start again."
            : "Couldn't save your password. Please try again."
        );
      }
    });
  }

  const error = signupPassword.error as ApiError | null;

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-8 pt-5 justify-between max-w-sm mx-auto overflow-y-auto">
      
     

      {/* MAIN FORM BODY */}
      <form onSubmit={handleSubmit} className="flex-1 flex flex-col items-start justify-start pt-6 w-full">
        
        {/* Security Hub Anchor Icon */}
        <div className="w-14 h-14 bg-primary border-2 border-ink rounded-2xl flex items-center justify-center text-2xl font-black text-ink mb-6 shadow-[2px_2px_0px_0px_#111827]">
          🔐
        </div>

        {/* Messaging Headers */}
        <div className="w-full text-left shrink-0 mb-6">
          <h1 className="text-[26px] font-black tracking-tight text-ink leading-tight">
            Secure your account
          </h1>
          <p className="mt-2 text-xs font-medium text-ink/60 pr-4 leading-relaxed">
            Create a strong password to lock down your wallet balances and split logs.
          </p>
        </div>

        {/* INTERACTIVE PASSWORD INPUT FIELD */}
        <div className="w-full mb-6 flex flex-col gap-1.5 relative">
          <label className="text-[11px] font-black uppercase tracking-wider text-ink/50 pl-1">
            Password
          </label>
          <div className="flex items-center rounded-2xl border-2 border-ink bg-white px-4 py-0.5 shadow-[0_2px_0px_0px_#111827] focus-within:border-secondary transition-colors relative">
            <input
              type={showPassword ? "text" : "password"}
              autoFocus
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
              className="w-full bg-transparent py-3.5 pr-8 text-sm md:text-base font-bold tracking-wide text-ink outline-none placeholder:text-ink/20"
            />
            
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 text-ink/40 hover:text-ink/80 transition-colors p-1"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* REQUIREMENTS TRACKER CARD (Softened Subdued Layout) */}
        <div className="w-full bg-white border border-slate-100 rounded-2xl p-4 shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex flex-col gap-2.5">
          <span className="text-[10px] font-extrabold text-ink/40 tracking-wider uppercase mb-1 block">
            Password Rules
          </span>

          {/* Metric 1 */}
          <div className="flex items-center gap-2.5 text-xs">
            <div className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors ${
              hasMinLength ? "bg-success/10 border-success text-success" : "bg-slate-50 border-slate-200 text-slate-300"
            }`}>
              {hasMinLength ? <Check className="h-2.5 w-2.5 stroke-3" /> : <X className="h-2.5 w-2.5" />}
            </div>
            <span className={`font-semibold ${hasMinLength ? "text-ink/80" : "text-ink/40"}`}>
              At least 8 characters long
            </span>
          </div>

          {/* Metric 2 */}
          <div className="flex items-center gap-2.5 text-xs">
            <div className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors ${
              hasLetter ? "bg-success/10 border-success text-success" : "bg-slate-50 border-slate-200 text-slate-300"
            }`}>
              {hasLetter ? <Check className="h-2.5 w-2.5 stroke-3" /> : <X className="h-2.5 w-2.5" />}
            </div>
            <span className={`font-semibold ${hasLetter ? "text-ink/80" : "text-ink/40"}`}>
              Contains letters (A-Z)
            </span>
          </div>

          {/* Metric 3 */}
          <div className="flex items-center gap-2.5 text-xs">
            <div className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors ${
              hasNumber ? "bg-success/10 border-success text-success" : "bg-slate-50 border-slate-200 text-slate-300"
            }`}>
              {hasNumber ? <Check className="h-2.5 w-2.5 stroke-3" /> : <X className="h-2.5 w-2.5" />}
            </div>
            <span className={`font-semibold ${hasNumber ? "text-ink/80" : "text-ink/40"}`}>
              Contains numbers (0-9)
            </span>
          </div>
        </div>

      </form>

      {/* FOOTER ACTION BUTTON */}
      <div className="w-full mt-auto pt-4 shrink-0">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isValid || isPending}
          className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-40 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all select-none"
        >
          <span>Continue</span>
          <span className="text-lg">➔</span>
        </button>
      </div>

    </div>
  );
}