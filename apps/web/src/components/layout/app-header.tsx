"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Bell, Settings2,  } from "lucide-react";
import { useHeaderStore } from "@/lib/header/store";

const ROOT_TABS = ["/home", "/pots", "/activity", "/profile"];

type HeaderAction = {
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  onPress?: () => void;
};

const ROOT_TAB_ACTIONS: Record<string, HeaderAction | null> = {
  "/home": { icon: Bell, href: "/activity" },
  "/pots": null,
  "/activity": null,
  "/profile": { icon: Settings2, href: "/settings" },
};

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const storeAction = useHeaderStore((s) => s.action);

  const isRootTab = ROOT_TABS.some((tab) => pathname === tab);
  
  // Cleanly extract the action object based on routing context
  const rightSlot: HeaderAction | null = isRootTab
    ? (ROOT_TAB_ACTIONS[pathname] ?? null)
    : (storeAction ?? null);

  const screenTitle = deriveTitle(pathname);

  return (
    <div className="flex items-center justify-between w-full p-4 shrink-0 select-none">
      
      {/* LEFT SLOT — Conditional back navigation */}
      <div className="w-11 h-11 flex items-center justify-start">
        {!isRootTab ? (
          <button
            type="button"
            onClick={() => router.back()}
            className="h-11 w-11 flex items-center justify-center border border-ink/10 rounded-xl bg-white text-ink shadow-xs active:scale-95 transition-all"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
          </button>
        ) : (
          /* Empty placeholder tracking layout width when no back button exists */
          <div className="w-11 h-11" />
        )}
      </div>

      {/* CENTER SLOT — Static Branding vs. Dynamic Title Navigation */}
      <div className="flex-1 flex items-center justify-center text-center px-2">
        {isRootTab ? (
          <span className="text-lg font-black tracking-tight text-ink">
            Paa<span className="text-primary">di</span>
          </span>
        ) : (
          <h1 className="text-xs font-black tracking-tight text-ink uppercase">
            {screenTitle}
          </h1>
        )}
      </div>

      {/* RIGHT SLOT — Contextual Actions Frame */}
      <div className="w-11 h-11 flex items-center justify-end">
        {rightSlot ? (
          (() => {
            const Icon = rightSlot.icon;
            const iconClassName = "h-5 w-5 stroke-[2.5]";
            const sharedButtonStyles = "h-11 w-11 flex items-center justify-center border border-ink/10 rounded-xl bg-white text-ink shadow-xs active:scale-95 transition-all";

            if (rightSlot.href) {
              return (
                <Link href={rightSlot.href} className={sharedButtonStyles}>
                  <Icon className={iconClassName} />
                </Link>
              );
            }

            if (rightSlot.onPress) {
              return (
                <button type="button" onClick={rightSlot.onPress} className={sharedButtonStyles}>
                  <Icon className={iconClassName} />
                </button>
              );
            }

            return <div className="w-11 h-11" />;
          })()
        ) : (
          /* Structural placeholder box matching left slots perfectly when empty */
          <div className="w-11 h-11" />
        )}
      </div>

    </div>
  );
}

function deriveTitle(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return "Paadi";

  const titleMap: Record<string, string> = {
    "create": "Create Pot",
    "edit": "Edit Pot",
    "verify": "Verify Identity",
    "settings": "Settings",
    "activity": "Activity",
    "profile": "Profile",
  };

  const last = segments[segments.length - 1];
  const first = segments[0];

  if (last && titleMap[last]) return titleMap[last];
  if (first && titleMap[first]) return titleMap[first];

  if (first === "pots" && segments.length > 1) return "Pot Overview";
  if (first === "pay") return "Pay Your Share";

  return (last ?? "Paadi")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}