"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSignupStart } from "@/features/onboarding/hooks";
import { ArrowLeft } from "lucide-react";
import { toast } from "@/features/toast/store";
import { ApiError } from "@/lib/api/error";
import Image from 'next/image';

export default function PhonePage() {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const signupStart = useSignupStart();

  const error = signupStart.error as ApiError | null;
  const isInvalidPhone = error?.statusCode === undefined && error?.issues?.some((i) => i.path === "phone");

  function handleContinue() {
    // backend parses as NG E.164 — send the digits, prefix the country code
    // here so the user only ever types the local number
    const fullPhone = `+234${phone.replace(/^0/, "")}`;
    signupStart.mutate(fullPhone, {
      onSuccess: () => router.push("/otp"),
      onError: (err: Error) => {
        toast.error(err.message ?? "Failed to send code. Try again.");
      }
    });
  }

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-8 pt-5 justify-between max-w-md mx-auto">
      
      

      {/* MID SECTION: Illustration & Text */}
      <div className="flex-1 flex flex-col items-center justify-center w-full my-auto">
        
        {/* Phone Mock Card Graphic */}
        <div className="w-full max-w-[240px] aspect-square relative flex items-center justify-center mb-8">
          <div className="w-[85%] h-[85%] bg-white rounded-3xl border border-ink/5 shadow-[0_12px_40px_rgba(0,0,0,0.04)] p-4 relative flex items-center justify-center overflow-visible">
            
            {/* Pink Floating Secure Tag */}
            <div className="absolute -top-3 -right-4 bg-secondary text-white text-[11px] font-black px-4 py-2 rounded-full rotate-2 shadow-md">
              Secure SMS
            </div>

            {/* Inner Phone Graphics View */}
            <div className="w-full h-full rounded-2xl bg-linear-to-b from-yellow-50 to-yellow-100 flex items-center justify-center relative p-4 text-center overflow-hidden">
              <Image
      src="/assets/phone.jpg"  
      alt="People Sharing Pizza"
      width={500}          
      height={500}         
      priority             
    />
            </div>
          </div>
        </div>

        {/* Dynamic Screen Messaging */}
        <div className="text-center px-2">
        <h1 className="text-[26px] font-black tracking-tight text-ink leading-tight">
  What's your number?
</h1>
          <p className="mt-2.5 text-sm font-medium text-yellow-500 px-4 leading-relaxed">
            Join the crew. Let's get your account verified and ready for social splitting.
          </p>
        </div>

        {/* INPUT CONTAINER ZONE */}
        <div className="w-full mt-8">
          <div className="flex items-center rounded-2xl border-2 border-ink bg-white px-4 py-1.5 shadow-[0_2px_0px_0px_#111827]">
            {/* Country Picker Mock */}
            <div className="flex items-center gap-1 pr-3 border-r-2 border-ink/10 h-7 text-sm font-bold text-ink">
              <span>🇳🇬</span>
              <span>+234</span>
              <span className="text-[10px] text-ink/40 ml-0.5">▼</span>
            </div>
            
            {/* Controlled Text Input */}
            <input
              type="tel"
              inputMode="numeric"
              autoFocus
              placeholder="800 000 0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              className="flex-1 bg-transparent py-3 pl-3 text-base md:text-lg font-bold tracking-wider text-ink outline-none placeholder:text-ink/20"
            />
          </div>

          {/* Inline Messaging Status Details */}
          {isInvalidPhone ? (
            <p className="mt-2 text-xs font-bold text-danger flex items-center gap-1 pl-1">
              ⚠️ Enter a valid Nigerian phone number.
            </p>
          ) : (
            <p className="mt-4 text-sm font-bold text-success flex items-center gap-1.5 pl-1">
              <span>🛡️</span> Your privacy is our priority
            </p>
          )}
        </div>

      </div>

      {/* FOOTER CALL TO ACTIONS */}
      <div className="w-full mt-auto flex flex-col gap-5">
        <p className="text-center text-xs font-medium text-ink/50 px-6 leading-normal">
          We'll send a code to verify your phone via <span className="font-bold text-ink/80">SMS</span> or <span className="font-bold text-ink/80">WhatsApp</span>.
        </p>

        <button
          onClick={handleContinue}
          disabled={phone.length < 10 || signupStart.isPending}
          className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-40 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0px_0px_#111827] transition-all"
        >
          <span>{signupStart.isPending ? "Sending code…" : "Continue"}</span>
          <span className="text-lg">➔</span>
        </button>
      </div>

    </div>
  );
}