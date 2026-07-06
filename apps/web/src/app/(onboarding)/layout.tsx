"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// The exact sequence of your 8 onboarding pages
const ONBOARDING_STEPS = [
  "get-started",
  "phone",
  "otp",
  "name",
  "username",
  "password",
  "pin",
  "biometric",
];

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Extract the last segment of the path (e.g., "/onboarding/phone" -> "phone")
  const currentSegment = pathname.split("/").filter(Boolean).pop() || "";
  
  // Find where the user is in the 8-step array (defaults to 0 if not matched)
  const currentStepIndex = ONBOARDING_STEPS.indexOf(currentSegment);
  const isTrackingStep = currentStepIndex !== -1;
  const displayStep = currentStepIndex !== -1 ? currentStepIndex + 1 : 1;
  const totalSteps = ONBOARDING_STEPS.length;

  // Don't show a back arrow on the very first screen ("get-started")
  const showBackButton = !isTrackingStep || displayStep > 1;

  return (
    <div className="scrollbar-none flex h-dvh flex-col bg-linear-to-br from-white via-white to-#f472b6/5  justify-between max-w-sm mx-auto overflow-y-auto font-sans">
      
      {/* UNIFIED ONBOARDING HEADER */}
      <div className="flex items-center justify-between w-full p-2  shrink-0 select-none relative">
        
        {/* Left Slot: Back Button */}
        <div className="w-11 h-11 flex items-center justify-start z-10">
          {showBackButton ? (
            <button
              type="button"
              onClick={() => router.back()}
              className="h-11 w-11 flex items-center justify-center border border-ink
              /10 rounded-xl bg-white text-ink
               shadow-xs active:scale-95 transition-all"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
            </button>
          ) : (
            <div className="w-11 h-11" />
          )}
        </div>

        {/* Center Slot: Brand Accent */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-2xl font-black tracking-tight text-ink
           uppercase">
            Paa<span className="text-primary">di</span>
          </span>
        </div>

        {/* Right Slot: Dynamic Step Badge */}
        <div className="z-10 flex items-center justify-end pr-2">
          {isTrackingStep ? (
            <span className="text-[10px] font-black text-white/50 bg-secondary/5 border border-ink/5 px-2.5 py-1 rounded-full uppercase tracking-wider">
              Step {displayStep}/{totalSteps}
            </span>
          ) : (
            /* Structural placeholder layout box when matching excluded pages */
            <div className="w-11 h-11" />
          )}
        </div>
      </div>

      {/* INDIVIDUAL PAGE CONTENT */}
      <div className="flex-1 flex flex-col justify-start w-full mt-6 overflow-y-auto scrollbar-none">
      {children}
    </div>

    </div>
  );
}