"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/lib/auth/session";

/**
 * Screen 0 — Splash.
 * Pure router: shows logo/loading briefly, then sends the device to
 * either the dashboard (real, valid session) or onboarding (no session).
 * No logic beyond "check session, then redirect" — that's the rule for
 * every page.tsx in this app, splash included.
 */
export default function SplashPage() {
  const router = useRouter();
  const isAuthenticated = useSessionStore((s) => s.isAuthenticated);

  // zustand's persist middleware reads localStorage on mount, which only
  // happens client-side — this `hydrated` flag avoids redirecting before
  // that read finishes (otherwise we'd briefly see isAuthenticated() as
  // false for an actual logged-in user on every page load).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!hydrated) return;

    if (isAuthenticated()) {
      router.replace("/home");
    } else {
      router.replace("/welcome");
    }
  }, [hydrated, isAuthenticated, router]);

  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-bg">
      <img src="/icon.svg" alt="Paadi" className="h-16 w-16" />
      <p className="mt-4 text-sm text-ink/60">Paadi</p>
    </div>
  );
}