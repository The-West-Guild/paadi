"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useSessionStore } from "@/lib/auth/session";

const LOADING_INSIGHTS = [
  "Synchronizing group pots...",
  "Calculating split balances...",
  "Securing your payout vaults...",
  "Loading shared collections...",
];

export default function SplashPage() {
  const router = useRouter();
  const isAuthenticated = useSessionStore((s) => s.isAuthenticated);

  const [hydrated, setHydrated] = useState(false);
  const [insightIndex, setInsightIndex] = useState(0);

  // 1. Core hydration handler
  useEffect(() => {
    setHydrated(true);
  }, []);

  // 2. Micro-copy rotation engine to keep users patient and engaged
  useEffect(() => {
    const textInterval = setInterval(() => {
      setInsightIndex((prev) => (prev + 1) % LOADING_INSIGHTS.length);
    }, 1800);

    return () => clearInterval(textInterval);
  }, []);

 // 3. Structural routing gatekeeper (With a 2.2-second intentional delay)
 useEffect(() => {
  if (!hydrated) return;

  // We set a 2200ms (2.2 seconds) timer before triggering the router change
  const routingTimer = setTimeout(() => {
    if (isAuthenticated()) {
      router.replace("/home");
    } else {
      router.replace("/welcome");
    }
  }, 2200);

  // Clean up the timer if the component unmounts before the delay finishes
  return () => clearTimeout(routingTimer);
}, [hydrated, isAuthenticated, router]);

  return (
    <div className="flex h-dvh flex-col items-center justify-between bg-#f9fafb px-6 py-12 font-sans select-none overflow-hidden">
      
      {/* Structural Top Spacer to perfectly balance the layout vertical midpoint */}
      <div className="w-full h-12 shrink-0" />

      {/* CORE BRAND MARK — Premium floating scale container */}
      <div className="flex flex-col items-center justify-center flex-1 animate-[low-bounce_2s_infinite]">
        <div className="relative w-48 h-16 transition-all duration-300 transform scale-102">
          <Image
            src="/assets/logos/Logo + Word 1.png"
            alt="Paadi Wordmark"
            fill
            priority
            sizes="(max-width: 384px) 100vw, 192px"
            className="object-contain"
          />
        </div>
      </div>

      {/* FOOTER AREA — Micro-progress tracks & context insights */}
      <div className="w-full max-w-[240px] mx-auto flex flex-col items-center gap-4 shrink-0">
        
        {/* Sleek, indefinite layout timeline pulse loader track */}
        <div className="w-16 h-[3px] bg-ink/5 border border-ink/5 rounded-full overflow-hidden p-[0.5px]">
          <div className="h-full bg-primary rounded-full w-1/2 animate-[subtle-slide_1.2s_infinite_ease-in-out]" />
        </div>

        {/* Dynamic Context copy view */}
        <div className="h-4 flex items-center justify-center overflow-hidden">
          <p 
            key={insightIndex} 
            className="text-[10px] font-black uppercase tracking-wider text-ink/40 text-center animate-in fade-in slide-in-from-bottom-2 duration-300"
          >
            {LOADING_INSIGHTS[insightIndex]}
          </p>
        </div>

      </div>

      {/* Global Inline Tailwind Custom CSS Injector for Layout Slide Animation */}
      <style jsx global>{`
        @keyframes subtle-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>

    </div>
  );
}