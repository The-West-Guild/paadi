"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSignupProfile } from "@/features/onboarding/hooks";
import { toast } from "@/features/toast/store";
import { ApiError } from "@/lib/api/error";

export default function NamePage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  // Swap #1: isPending used to be a hardcoded `false`. Now it comes straight
  // off the mutation object — this is the SAME thing phone/page.tsx and
  // otp/page.tsx already do with signupStart.isPending / verifyPhone.isPending.
  // Once a hook is wired, you basically never need your own isPending state again.
  const signupProfile = useSignupProfile();
  const isPending = signupProfile.isPending;

  function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || isPending) return;

    // Swap #2: this used to be a direct router.push("/dashboard") — wrong
    // destination AND skipped the actual API call. Now: fire the mutation,
    // only navigate inside onSuccess. If the call fails (e.g. onboardingToken
    // expired), the user stays on this screen and sees the error instead of
    // sailing through to a screen that doesn't know who they are yet.
    signupProfile.mutate(
      { firstName: firstName.trim(), lastName: lastName.trim() },
      {
        onSuccess: () => router.push("/username"),
        onError: (err: Error) => {
          toast.error(err.message ?? "Failed to save profile. Try again.");
        }
      }
    );
  }

  const isValid = firstName.trim().length >= 2 && lastName.trim().length >= 2;

  // Swap #3: surface a real error message instead of failing silently.
  // signupProfile.error is whatever ApiError the fixture (or later, the
  // real api-client) threw — same pattern as isWrongCode in otp/page.tsx.
  const error = signupProfile.error as ApiError | null;

  // Generate initials for the live profile card preview
  const getInitials = () => {
    const f = firstName.trim().charAt(0).toUpperCase();
    const l = lastName.trim().charAt(0).toUpperCase();
    return `${f}${l}` || "P";
  };

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-6 pt-5 justify-between max-w-sm mx-auto overflow-y-auto">
      
    

      {/* CORE CONTENT FORM */}
      <form onSubmit={handleContinue} className="flex-1 flex flex-col items-center justify-start pt-6 w-full">
        
        {/* Dynamic Screen Messaging */}
        <div className="text-center w-full shrink-0 mb-6">
          <h1 className="text-2xl font-black tracking-tight text-ink leading-tight">
            What should we call you?
          </h1>
          <p className="mt-2 text-xs font-medium text-ink/60 px-4 leading-relaxed">
            Use your real name so your companions recognize you on bill splits.
          </p>
        </div>

        

        {/* INPUT FIELDS STACK */}
        <div className="w-full flex flex-col gap-4 px-1">
          
          {/* First Name Input */}
          <div className="flex flex-col gap-1.5 w-full">
            <label className="text-[11px] font-black uppercase tracking-wider text-ink/50 pl-1">
              First Name
            </label>
            <div className="flex items-center rounded-2xl border-2 border-ink bg-white px-4 py-0.5 shadow-[0_2px_0px_0px_#111827] focus-within:border-primary transition-colors">
              <input
                type="text"
                autoFocus
                placeholder="e.g., Tunde"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={isPending}
                className="w-full bg-transparent py-3 text-sm md:text-base font-bold text-ink outline-none placeholder:text-ink/20"
              />
            </div>
          </div>

          {/* Last Name Input */}
          <div className="flex flex-col gap-1.5 w-full">
            <label className="text-[11px] font-black uppercase tracking-wider text-ink/50 pl-1">
              Last Name
            </label>
            <div className="flex items-center rounded-2xl border-2 border-ink bg-white px-4 py-0.5 shadow-[0_2px_0px_0px_#111827] focus-within:border-primary transition-colors">
              <input
                type="text"
                placeholder="e.g., Adebayo"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={isPending}
                className="w-full bg-transparent py-3 text-sm md:text-base font-bold text-ink outline-none placeholder:text-ink/20"
              />
            </div>
          </div>

          {/* Swap #4: a place to actually show the error. Every wired
              screen needs one of these — copy this block's shape. */}
          {error && (
            <p className="px-1 text-xs font-semibold text-danger">
              {error.message === "phone not verified"
                ? "Something went wrong earlier in signup — please start again."
                : "Couldn't save your name. Please try again."}
            </p>
          )}

        </div>

      </form>

      {/* RESPONSIVE LIVE PREVIEW CARD */}
      <div className="w-full px-1 mb-20 shrink-0">
          <div className="w-full bg-white border-2 border-ink rounded-2xl p-4 shadow-[4px_4px_0px_0px_#111827] flex items-center gap-4 relative overflow-hidden transition-all duration-300">
            {/* Background geometric accent matching neo-brutalist theme */}
            <div className="absolute -right-3 -bottom-3 w-12 h-12 rounded-full bg-primary/10 border-2 border-ink/5 pointer-events-none" />
            
            {/* Live Initial Avatar Ring */}
            <div className="w-12 h-12 rounded-full bg-secondary border-2 border-ink flex items-center justify-center text-white font-black tracking-tighter text-base shadow-[2px_2px_0px_0px_#111827] shrink-0">
              {getInitials()}
            </div>

            {/* Dynamic Label Metadata */}
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-secondary">
                Profile Preview
              </span>
              <h3 className="text-base font-black text-ink truncate leading-tight mt-0.5 min-h-5">
                {firstName || lastName ? `${firstName} ${lastName}` : "Your Name Here"}
              </h3>
              <span className="text-[11px] font-bold text-ink/80 flex items-center gap-1 mt-0.5">
                🤝 Paadi Partner
              </span>
            </div>
          </div>
        </div>

      {/* FOOTER ACTION BUTTON & LEGAL LINKS */}
      <div className="w-full mt-auto pt-4 shrink-0 flex flex-col gap-4">
        
        {/* Main CTA Trigger */}
        <button
          type="button"
          onClick={handleContinue}
          disabled={!isValid || isPending}
          className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-40 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all"
        >
          <span>{isPending ? "Saving profile…" : "Continue"}</span>
          <span className="text-lg">➔</span>
        </button>

        {/* Terms and Privacy Policy Links Block */}
        <p className="text-center text-[11px] font-medium leading-relaxed text-ink/50 px-4">
          By continuing, you agree to Paadi's{" "}
          <button 
            type="button" 
            onClick={() => router.push("/terms")}
            className="font-bold text-ink underline decoration-secondary decoration-2 underline-offset-2 hover:text-secondary transition-colors"
          >
            Terms of Service
          </button>{" "}
          &amp;{" "}
          <button 
            type="button" 
            onClick={() => router.push("/privacy")}
            className="font-bold text-ink underline decoration-secondary decoration-2 underline-offset-2 hover:text-secondary transition-colors"
          >
            Privacy Policy
          </button>.
        </p>
      </div>

    </div>
  );
}