"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForgotPassword } from "@/features/auth/login-hooks";
import { toast } from "@/features/toast/store";
import { Loader2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const forgotMutation = useForgotPassword();
  const [identifier, setIdentifier] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  

  const isPending = forgotMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) {
      toast.error("Please enter your identifier.");
      return;
    }

    forgotMutation.mutate(
      { identifier },
      {
        onSuccess: (data) => {
          setIsSuccess(true);
          toast.success(data.message ?? "If the account exists, a reset code has been sent.", 3000);
          setTimeout(() => {
            router.push("/reset-password");
          }, 3000);
        },
        onError: (err: any) => {
          toast.error(err.message ?? "Something went wrong. Please try again.");
        },
      }
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-8 pt-5 justify-between">

      {/* CORE FORM AREA */}
      <div className="flex-1 flex flex-col justify-center w-full my-auto max-y-[450px]">
        {/* Header Messaging */}
        <div className="text-center mb-8">
          <h1 className="text-[28px] font-black tracking-tight text-ink leading-tight">
            Forgot password
          </h1>
          <p className="mt-2 text-xs font-semibold text-ink/40">
            Enter your details to receive a 6-digit recovery code
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
              disabled={isPending || isSuccess}
              placeholder="e.g. @tunde or +234..."
              className="w-full bg-white border-2 border-ink rounded-xl px-4 py-3.5 text-sm font-semibold text-ink placeholder:text-ink/30 focus:outline-hidden focus:border-primary shadow-[2px_2px_0px_0px_#111827] disabled:opacity-50 transition-all"
            />
          </div>

          {/* Send Recovery Code CTA */}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-50 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all select-none mt-4"
          >
            {isPending ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Sending code...</span>
              </>
            ) : (
              <>
                <span>Send Code</span>
                <span className="text-lg">➔</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* FOOTER ACTIONS */}
      <div className="w-full mt-auto pt-4 shrink-0 text-center">
        <p className="text-xs font-semibold text-ink/40">
          Remember password?{" "}
          <button
            onClick={() => router.push("/login")}
            className="font-bold text-amber-500 hover:text-primary transition-colors"
          >
            Log in
          </button>
        </p>
      </div>
    </div>
  );
}
