"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from 'next/image';
import { Landmark, Plus, Send, Zap, Users } from "lucide-react"

type Slide = {
  headline: string;
  subtext: string;
  coloredText?: string; // For highlighting words like "WhatsApp" or "real bank account"
};

/** Screens 1-3 — the pitch carousel.*/

const SLIDES: Slide[] = [
  {
    headline: "Splitting money shouldn't mean chasing people on ",
    coloredText: "WhatsApp.",
    subtext: "Collect contributions, track who's paid, and pay out all in one link.",
  },
  {
    headline: "Create a split in seconds",
    subtext: "Set the amount, add your people, and we generate a dedicated account for each person automatically.",
  },
  {
    headline: "Every naira goes into a ",
    coloredText: "real bank account",
    subtext: "Powered by Nomba. Each participant gets their own virtual account nothing pools into one risky wallet.",
  },
];

export default function WelcomePage() {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);

  const isLastSlide = activeIndex === SLIDES.length - 1;
  const slide = SLIDES[activeIndex];

  function handleNext() {
    if (isLastSlide) {
      router.push("/get-started");
      return;
    }
    setActiveIndex((i) => i + 1);
  }

  function handleSkip() {
    router.push("/get-started");
  }

  return (
    <div className="flex h-dvh flex-col bg-bg px-6 pb-8 pt-2 justify-between max-w-md mx-auto">
      
      {/* HEADER SECTION */}
      

      {/* DYNAMIC ILLUSTRATION AREA */}
      <div className="flex flex-1 items-center justify-center py-2 w-full">
        <div className="w-full max-w-[340px] aspect-square flex items-center justify-center">
          
          {/* SCREEN 1: Placeholder/Mock Graphic Container */}
          {activeIndex === 0 && (
            <div className="w-full h-full animate-low-bounce bg-white rounded-3xl border border-ink/5 shadow-[0_8px_30px_rgb(0,0,0,0.06)] p-6 relative flex flex-col items-center justify-center overflow-hidden">
              <div className="w-full h-full rounded-2xl bg-white flex flex-col items-center justify-center text-white/40 text-xs p-4 relative">
                {/* Simulated Chat Bubbles */}
                <span className="absolute top-4 right-4 bg-secondary text-pink-800 text-[11px] font-bold px-3 py-1.5 rounded-full rotate-3 shadow-md">
                  Who's paid for Suya? 🍕
                </span>
                <span className="absolute top-4 left-4 bg-success text-green-900 text-[11px] font-bold px-3 py-1.5 rounded-full -rotate-2 shadow-md flex items-center gap-1">
                  ✓ Sarah paid!
                </span>
                <div className="text-center">
                <Image
      src="/assets/onboardin.jpg"  
      alt="People Sharing Pizza"
      width={700}          
      height={30}         
      priority             
    />
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 2: Create, Share, Collect Process flow */}
          {activeIndex === 1 && (
            <div className="w-full flex flex-col gap-6 items-center">
              {/* Top Workflow Process Row */}
              <div className="flex items-center justify-between w-full relative px-2">
                <div className="absolute left-0 right-0 top-7 h-[2px] border-t-2 border-dashed border-ink/20 z-0" />
                
                <div className="flex flex-col items-center gap-2 z-10">
                  <div className="w-14 h-14 rounded-2xl bg-primary border-2 border-ink shadow-[3px_3px_0px_0px_#111827] flex items-center justify-center font-bold text-xl text-ink"><Plus/></div>
                  <span className="text-[15px] font-black tracking-wider text-ink">CREATE</span>
                </div>
                
                <div className="flex flex-col items-center gap-2 z-10">
                  <div className="w-14 h-14 rounded-2xl bg-secondary border-2 border-ink shadow-[3px_3px_0px_0px_#111827] flex items-center justify-center text-white text-xl"> <Send/> </div>
                  <span className="text-[15px] font-black tracking-wider text-ink">SHARE</span>
                </div>
                
                <div className="flex flex-col items-center gap-2 z-10">
                  <div className="w-14 h-14 rounded-2xl bg-success border-2 border-ink shadow-[3px_3px_0px_0px_#111827] flex items-center justify-center text-white text-xl"> <Landmark /> </div>
                  <span className="text-[15px] font-black tracking-wider text-ink">COLLECT</span>
                </div>
              </div>

              {/* Sub features grid layout */}
              <div className="grid grid-cols-2 gap-3 w-full mt-10">
                <div className="bg-white/40 backdrop-blur-md rounded-2xl p-6 text-center border border-ink/5 flex flex-col gap-1 shadow-sm">
                  <span className="text-lg"> <Users/> </span>
                  <span className="text-sm font-bold text-ink">Unlimited People</span>
                </div>
                <div className="bg-white/40 backdrop-blur-md rounded-2xl p-6 border border-ink/5 flex flex-col gap-1 shadow-sm">
                  <span className="text-md text-secondary"> <Zap/> </span>
                  <span className="text-sm font-bold text-ink">Instant Setup</span>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 3: Trust & Safety UI layout */}
          {activeIndex === 2 && (
            <div className="w-full flex flex-col gap-3">
              {/* Virtual Account Main Card */}
              <div className="w-full bg-white border-2 border-primary rounded-2xl p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)] relative">
                <div className="flex justify-between items-center mb-6">
                  <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-xs"> <Landmark/> </div>
                  <span className="text-[10px] font-bold bg-green-200 text-green-900 px-4 py-2 rounded-full">Secured by Nomba</span>
                </div>
                <p className="text-xs text-ink/50 font-medium">Your Virtual Account</p>
                <p className="text-xl font-bold tracking-widest text-ink mt-1">9022 •••• •••• 4410</p>
              </div>

              {/* Side-by-side Mini Badges */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-2xl p-8 border border-ink/5 shadow-sm flex items-center gap-2">
                  <div className="flex -space-x-2">
                    <div className="w-6 h-6 rounded-full bg-secondary text-[8px] font-bold text-white flex items-center justify-center border border-white">JD</div>
                    <div className="w-6 h-6 rounded-full bg-success text-[8px] font-bold text-white flex items-center justify-center border border-white">SM</div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[12px]  text-ink leading-tight">6 Active</span>
                    <span className="text-[10px] text-ink/40">Participants</span>
                  </div>
                </div>
                <div className="bg-white rounded-2xl p-3 border-2 border-secondary/40 shadow-sm flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center text-pink-500"> <Zap/> </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-ink leading-tight">PHCN Auto-pay</span>
                    <span className="text-[9px] text-secondary font-medium">Settled</span>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* TYPOGRAPHY CONTENT */}
      <div className="text-center px-2 flex flex-col justify-center min-h-[140px]">
        <h1 className="text-[26px] font-black tracking-tight text-ink leading-[1.2]">
          {slide.headline}
          {slide.coloredText && (
            <span className={activeIndex === 0 ? "text-secondary" : "text-yellow-700"}>
              {slide.coloredText}
            </span>
          )}
        </h1>
        <p className="mt-3.5 text-md md:text-base font-medium text-yellow-900 px-2 leading-relaxed">
          {slide.subtext}
        </p>
      </div>

      {/* CAROUSEL CONTROLS & CALL TO ACTION */}
      <div className="mt-8 flex flex-col gap-6">
        
        {/* Dynamic Pagination Bars */}
        <div className="flex justify-center gap-1.5">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              className={`h-1.5 transition-all duration-300 rounded-full ${
                i === activeIndex ? "w-7 bg-ink" : "w-1.5 bg-ink/20"
              }`}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>

        {/* Action Button */}
        <button
          onClick={handleNext}
          className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all"
        >
          <span>{isLastSlide ? "Get started" : "Next"}</span>
          <span className="text-md">➔</span>
        </button>
      </div>

    </div>
  );
}