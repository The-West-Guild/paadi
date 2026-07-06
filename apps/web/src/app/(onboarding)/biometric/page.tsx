"use client";

import { useRouter } from "next/navigation";
import { Fingerprint, Loader2 } from "lucide-react";
import { useRegisterDevice } from "@/features/onboarding/hooks";
import { useOnboardingStore } from "@/features/onboarding/store";
import { toast } from "@/features/toast/store";

export default function BiometricPage() {
  const router = useRouter();
  const registerDevice = useRegisterDevice();
  const setBiometricEnabled = useOnboardingStore((s) => s.setBiometricEnabled);
  const isAuthenticating = registerDevice.isPending;

  function getOrCreateDeviceId() {
    if (typeof window === "undefined") return "web_ssr_placeholder";
    let deviceId = localStorage.getItem("paadi:device_id");
    if (!deviceId) {
      deviceId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem("paadi:device_id", deviceId);
    }
    return deviceId;
  }

  function handleBiometricAuth() {
    const deviceId = getOrCreateDeviceId();
    registerDevice.mutate(
      { deviceId, biometricEnabled: true },
      {
        onSuccess: () => {
          setBiometricEnabled(true);
          router.push("/ready");
        },
        onError: (err: Error) => {
          // If native web credentials fail or server fails, still let the user proceed
          toast.warning(err.message ?? "Biometric setup skipped.");
          setBiometricEnabled(true);
          router.push("/ready");
        }
      }
    );
  }

  function handleSkip() {
    const deviceId = getOrCreateDeviceId();
    registerDevice.mutate(
      { deviceId, biometricEnabled: false },
      {
        onSuccess: () => {
          setBiometricEnabled(false);
          router.push("/ready");
        },
        onError: (err: Error) => {
          toast.warning(err.message ?? "Registration skipped.");
          setBiometricEnabled(false);
          router.push("/ready");
        }
      }
    );
  }


  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-8 pt-5 justify-between max-w-sm mx-auto overflow-y-auto">
      
      

      {/* CORE FRAME DISPLAY */}
      <div className="flex-1 flex flex-col items-center justify-center w-full my-auto max-y-[400px]">
        
        {/* Soft-Brutalist Biometric Activation Target */}
        <button
          type="button"
          onClick={handleBiometricAuth}
          disabled={isAuthenticating}
          className="w-24 h-24 bg-white border-2 border-ink rounded-[28px] flex items-center justify-center text-ink shadow-[4px_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[2px_2px_0px_0px_#111827] transition-all mb-8 relative group"
        >
          {isAuthenticating ? (
            <Loader2 className="h-10 w-10 text-secondary animate-spin" />
          ) : (
            <Fingerprint className="h-12 w-12 text-ink group-hover:scale-105 transition-transform" />
          )}
        </button>

        {/* Messaging Headers */}
        <div className="w-full text-center shrink-0">
          <h1 className="text-[26px] font-black tracking-tight text-ink leading-tight">
            Enable biometrics
          </h1>
          <p className="mt-2 text-xs font-medium text-ink/60 px-6 leading-relaxed">
            Use Face ID or Touch ID for frictionless entry, quick approvals, and instant balance unlocks.
          </p>
        </div>

      </div>

      {/* FOOTER ACTION STACK */}
      <div className="w-full mt-auto pt-4 shrink-0 flex flex-col gap-3">
        <button
          type="button"
          onClick={handleBiometricAuth}
          disabled={isAuthenticating}
          className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-40 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all select-none"
        >
          <span>Enable Biometrics</span>
        </button>

        <button
          type="button"
          onClick={handleSkip}
          disabled={isAuthenticating}
          className="w-full py-3 text-xs font-bold text-ink/50 hover:text-ink transition-colors text-center"
        >
          Skip for now
        </button>
      </div>

    </div>
  );
}