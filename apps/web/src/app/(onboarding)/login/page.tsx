"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLogin } from "@/features/auth/login-hooks";
import { toast } from "@/features/toast/store";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const loginMutation = useLogin();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const isPending = loginMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!identifier.trim() || !password.trim()) {
      toast.error("Please fill in all fields.");
      return;
    }

    loginMutation.mutate(
      { identifier, password },
      {
        onSuccess: () => {
          router.push("/home");
        },
        onError: (err: Error) => {
          toast.error(err.message ?? "Invalid credentials. Please try again.");
        },
      }
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-8 pt-5 justify-between ">
      

      {/* CORE FORM AREA */}
      <div className="flex-1 flex flex-col justify-center w-full my-auto max-y-[450px]">
        {/* Header Messaging */}
        <div className="text-center mb-8">
          <h1 className="text-[28px] font-black tracking-tight text-ink leading-tight">
            Welcome back
          </h1>
          <p className="mt-2 text-xs font-semibold text-ink/40">
            Log in to manage your pots and payouts
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Identifier Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
              Phone, Username or Email
            </label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={isPending}
              placeholder="e.g. @tunde or +234..."
              className="w-full bg-white border-2 border-ink rounded-xl px-4 py-3.5 text-sm font-semibold text-ink placeholder:text-ink/30 focus:outline-hidden focus:border-primary shadow-[2px_2px_0px_0px_#111827] disabled:opacity-50 transition-all"
            />
          </div>

          {/* Password Input */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center px-1">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40">
                Password
              </label>
              <button
                type="button"
                onClick={() => router.push("/forgot-password")}
                className="text-[10px] font-bold text-amber-500 hover:text-primary transition-colors"
              >
                Forgot password?
              </button>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
              placeholder="Enter password"
              className="w-full bg-white border-2 border-ink rounded-xl px-4 py-3.5 text-sm font-semibold text-ink placeholder:text-ink/30 focus:outline-hidden focus:border-primary shadow-[2px_2px_0px_0px_#111827] disabled:opacity-50 transition-all"
            />
          </div>

          {/* Log In CTA */}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-50 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all select-none mt-4"
          >
            {isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Logging in...</span>
              </>
            ) : (
              <>
                <span>Log in</span>
                <span className="text-lg">➔</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* FOOTER ACTIONS */}
      <div className="w-full mt-auto pt-4 shrink-0 text-center">
        <p className="text-xs font-semibold text-ink/40">
          New to Paadi?{" "}
          <button
            onClick={() => router.push("/get-started")}
            className="font-bold text-amber-500 hover:text-primary transition-colors"
          >
            Create an account
          </button>
        </p>
      </div>
    </div>
  );
}
