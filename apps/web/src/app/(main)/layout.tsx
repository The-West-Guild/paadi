"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/lib/auth/session";
import { BottomNav } from "@/components/layout/bottom-nav";
import { AppHeader } from "@/components/layout/app-header";
import { Loader2 } from "lucide-react";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const isAuthenticated = useSessionStore((s) => s.isAuthenticated);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => { setHydrated(true); }, []);

  useEffect(() => {
    if (hydrated && !isAuthenticated()) {
      router.replace("/welcome");
    }
  }, [hydrated, isAuthenticated, router]);

  if (!hydrated) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 text-primary animate-spin stroke-[2.5]" />
          <span className="text-xs font-bold text-ink/40 tracking-wider uppercase">
            Loading Paadi...
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated()) return null;

  return (
    <div className="relative h-dvh w-full bg-linear-to-br from-bg via-bg to-secondary/5 overflow-hidden">
      <main className="relative h-full w-full max-w-sm mx-auto flex flex-col bg-transparent">

        {/* HEADER — fixed top chrome */}
        <div className="shrink-0">
          <AppHeader />
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="flex-1 w-full overflow-y-auto px-5 pb-24 scrollbar-none">
          {children}
        </div>

        <BottomNav />

      </main>
    </div>
  );
}