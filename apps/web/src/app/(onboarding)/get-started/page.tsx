"use client";

import { useRouter } from "next/navigation";
import { Users } from "lucide-react"
import Image from 'next/image';

export default function GetStartedPage() {
  const router = useRouter();

  function handleGetStarted() {
    // Navigate to phone number collection or registration step
    router.push("/phone"); 
  }

  function handleLogin() {
    router.push("/login");
  }

  return (
    <div className="no-scrolbar flex h-dvh flex-col bg-bg px-6 pb-8 pt-5 justify-between mx-auto">

      {/* ILLUSTRATION COMPOSITION AREA */}
      <div className="flex flex-1 items-center justify-center py-4 w-full">
        <div className="w-full max-w-[320px] aspect-square relative flex items-center justify-center">
          
          {/* Main Rounded Frame */}
          <div className="w-[90%] h-[90%] bg-white rounded-3xl border border-ink/5 shadow-[0_12px_40px_rgba(0,0,0,0.04)] p-4 relative flex items-center justify-center overflow-visible">
            
            {/* Contextual Floating Badge 1: Top Left Split Details */}
            <div className="absolute rotate-350 top-6 -left-10 bg-white border border-ink/10 rounded-2xl p-2 shadow-[0_8px_24px_rgba(0,0,0,0.06)] flex items-center gap-3 z-20 animate-fade-in">
              <div className="w-12 h-12 rounded-full bg-pink-100 text-secondary flex items-center justify-center text-sm font-bold">
                <Users />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-ink leading-tight">Dinner Split</span>
                <span className="text-[11px] font-bold text-success mt-0.5">₦32,500.00</span>
              </div>
            </div>

            {/* Central Vector / Mock Team Area */}
            <div className="w-full h-full rounded-2xl bg-linear-to-tr from-amber-50/40 to-pink-50/20 flex flex-col items-center justify-center border border-dashed border-ink/10 relative p-3 text-center">
            <Image
      src="/assets/get.jpg"  
      alt="People Sharing Pizza"
      width={200}          
      height={100}         
      priority             
    />
            </div>

            {/* Contextual Floating Badge 2: Bottom Right Success State */}
            <div className="absolute rotate-5 -bottom-2 -right-2 bg-primary border-2 border-ink rounded-full py-2 px-4 shadow-[3px_3px_0px_0px_#111827] flex items-center gap-1.5 z-20">
              <span className="bg-ink text-primary text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">✓</span>
              <span className="text-[11px] font-bold tracking-tight text-ink">Paid in full</span>
            </div>

          </div>

        </div>
      </div>

      {/* TYPOGRAPHY INBOUND CALLOUT */}
      <div className="text-center px-2 flex flex-col justify-center mb-4">
        <h1 className="text-[28px] font-bold tracking-tight text-ink leading-tight">
          Let's set up your <br /> first split
        </h1>
        <p className="mt-3.5 text-md font-medium text-yellow-700 px-4 leading-relaxed">
          Join 50k+ people splitting bills, rent, and goals without the awkward "pay me back" texts.
        </p>
      </div>

      {/* DUAL-ACTION CTA BUTTON STACK */}
      <div className="flex flex-col gap-3.5 w-full">
        
        {/* Primary CTA Action */}
        <button
          onClick={handleGetStarted}
          className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all"
        >
          <span>Get started</span>
          <span className="text-lg">➔</span>
        </button>

        {/* Secondary Bordered Alternative */}
        <button
          onClick={handleLogin}
          className="w-full rounded-2xl bg-transparent py-4 px-4 font-bold text-ink text-base flex items-center justify-center border-2 border-ink hover:bg-ink/5 transition-colors"
        >
          I already have an account
        </button>

      </div>

    </div>
  );
}