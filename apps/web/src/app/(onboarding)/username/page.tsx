"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUsernameAvailable, useSignupUsername } from "@/features/onboarding/hooks";
import { toast } from "@/features/toast/store";
import { ApiError } from "@/lib/api/error";
import { Loader2 } from "lucide-react";

export default function UsernamePage() {
  const router = useRouter();
  const [username, setUsername] = useState("");

  const [debouncedUsername, setDebouncedUsername] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedUsername(username), 400);
    return () => clearTimeout(timer);
  }, [username]);

  const availability = useUsernameAvailable(debouncedUsername);
  const isChecking = availability.isFetching;
  const isAvailable = availability.data?.available ?? null;
  const signupUsername = useSignupUsername();
  const isPending = signupUsername.isPending;

  function handleInputChange(value: string) {
    const sanitized = value
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9_]/g, "");
    setUsername(sanitized);
  }
 
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (username.length < 3 || isChecking || isAvailable === false || isPending) return;
 
    signupUsername.mutate(username, {
      onSuccess: () => router.push("/password"),
      onError: (err: Error) => {
        toast.error(err.message ?? "Failed to claim handle.");
      }
    });
  }
 
  const error = signupUsername.error as ApiError | null;
  const isTaken = error?.statusCode === 409;

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-6 pt-5 justify-between max-w-sm mx-auto overflow-y-auto">
      
      
 
      {/* MAIN FORM BODY */}
      <form onSubmit={handleSubmit} className="flex-1 flex flex-col items-start justify-start pt-6 w-full">
        
        {/* Main Brand Action Hub Icon (Kept strong for structural anchor) */}
        <div className="w-14 h-14 bg-primary border-2 border-ink rounded-2xl flex items-center justify-center text-2xl font-black text-ink mb-6 shadow-[2px_2px_0px_0px_#111827]">
          @
        </div>
 
        {/* Messaging Headers */}
        <div className="w-full text-left shrink-0 mb-6">
          <h1 className="text-[26px] font-black tracking-tight text-ink leading-tight">
            Claim your handle
          </h1>
          <p className="mt-2 text-xs font-medium text-ink/60 pr-4 leading-relaxed">
            Your @username is how friends find and add you to pots.
          </p>
        </div>
 
        {/* INPUT CONTAINER WITH SOFT FLOATING TOOLTIP */}
        <div className="w-full mb-6 relative">
          
          {/* Toned Down Tooltip Pill */}
          <div className="mb-2.5 flex items-center min-h-[28px]">
            {isAvailable === false ? (
              <div className="bg-danger text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-sm animate-shake">
                Already taken! 😭
              </div>
            ) : (
              <div className="bg-pink-400 text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-sm">
                {isAvailable === true ? "Looking good! ✨" : "Make it catchy! 🚀"}
              </div>
            )}
          </div>
 
          {/* Primary Interactive Input Box (Retained crisp shadow for usability) */}
          <div className="w-full flex items-center rounded-2xl border-2 border-ink bg-white px-4 py-1 shadow-[0_2px_0px_0px_#111827] focus-within:border-secondary transition-colors relative">
            <span className="text-base font-black text-ink/40 mr-0.5 select-none">@</span>
            <input
              type="text"
              autoFocus
              placeholder="username"
              value={username}
              onChange={(e) => handleInputChange(e.target.value)}
              disabled={isPending}
              className="w-full bg-transparent py-3 text-sm md:text-base font-bold text-ink outline-none placeholder:text-ink/20 lowercase"
            />
            {isChecking && (
              <div className="absolute right-4">
                <Loader2 className="h-4 w-4 text-ink/40 animate-spin" />
              </div>
            )}
          </div>
 
          {/* Real submit error — different from "already taken" shown above,
              this is for the rare case the username passed the live check
              but got claimed by someone else a split-second before you hit submit */}
          {isTaken && (
            <p className="mt-2 px-1 text-xs font-semibold text-danger">
              That username was just taken — try another.
            </p>
          )}
        </div>
 
        {/* THE CLEANED & SOFTENED PREVIEW CARD */}
        <div className="w-full shrink-0">
          <div className="w-full bg-secondary/20 border border-secondary rounded-2xl p-4 shadow-xl flex flex-col gap-4">
            
            {/* Soft Meta Header */}
            <div className="flex items-center gap-2 text-[10px] font-extrabold text-ink/40 tracking-wider uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500 inline-block" />
              Preview
            </div>
 
            {/* Profile User Info Group */}
            <div className="flex items-center gap-3">
              {/* Softened Profile Ring */}
              <div className="w-12 h-12 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-xl overflow-hidden shrink-0">
                <span>👦🏼</span>
              </div>
              <div className="flex flex-col min-w-0">
                <h3 className="text-base font-black text-ink leading-tight">Alex Rivera</h3>
                <span className="text-xs font-semibold text-ink/40 mt-0.5 truncate">
                  @{username || "username"}
                </span>
              </div>
            </div>
 
            {/* Minimal Subdued Divider */}
            <div className="w-full h-1px bg-slate-100" />
 
            {/* Premium, Non-Brutalist Avatar Stack Row */}
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center -space-x-1.5 overflow-hidden">
                <div className="w-6.5 h-6.5 rounded-full bg-amber-200 border-2 border-white flex items-center justify-center text-[9px] font-bold text-amber-900 select-none">JD</div>
                <div className="w-6.5 h-6.5 rounded-full bg-pink-200 border-2 border-white flex items-center justify-center text-[9px] font-bold text-pink-900 select-none">SK</div>
                <div className="w-6.5 h-6.5 rounded-full bg-emerald-400 border-2 border-white flex items-center justify-center text-[9px] font-bold text-white select-none">+3</div>
              </div>
              <span className="text-xs font-medium text-ink/60">Joined 12 Pots</span>
            </div>
 
          </div>
        </div>
 
      </form>
 
      {/* FOOTER CALL TO ACTION */}
      <div className="w-full mt-auto pt-4 shrink-0 flex flex-col gap-4 items-center">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={username.length < 3 || isChecking || isAvailable === false || isPending}
          className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-40 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all select-none"
        >
          {isPending ? "Claiming…" : "Set Username"}
        </button>
 
        <p className="text-center text-[11px] font-medium leading-relaxed text-ink/40 px-2 max-w-[280px]">
          By claiming this handle, you agree to our{" "}
          <span className="text-ink/60 font-bold hover:underline cursor-pointer">Community Guidelines</span> and{" "}
          <span className="text-ink/60 font-bold hover:underline cursor-pointer">Terms of Service</span>.
        </p>
      </div>
 
    </div>
  );
}