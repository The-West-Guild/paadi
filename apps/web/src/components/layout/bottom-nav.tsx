"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Layers, Activity, CircleUser, Plus } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/home",     label: "Home",     icon: Home },
  { href: "/pots",     label: "Pots",     icon: Layers },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/profile",  label: "Profile",  icon: CircleUser },
];

const leftItems = NAV_ITEMS.slice(0, 2);
const rightItems = NAV_ITEMS.slice(2);

export function BottomNav() {
  const pathname = usePathname();

  const renderNavLink = (item: NavItem) => {
    const isActive = pathname.startsWith(item.href);
    const Icon = item.icon;

    return (
      <Link
        key={item.href}
        href={item.href}
        className="flex flex-1 flex-col items-center justify-center gap-1 h-full select-none active:scale-95 transition-transform"
      >
        <Icon
          className={`h-5 w-5 transition-colors ${
            isActive ? "text-yellow-600 stroke-[2.5]" : "text-ink/35 stroke-2"
          }`}
        />
        <span
          className={`text-[10px] font-semibold tracking-wide transition-colors ${
            isActive ? "text-yellow-600" : "text-ink/35"
          }`}
        >
          {item.label}
        </span>
      </Link>
    );
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-5 pb-6 pointer-events-none max-w-sm mx-auto">

      {/* Floating pill container */}
      <nav className="relative w-full h-16 flex items-center justify-around rounded-2xl border border-ink/10 bg-white/85 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.08)] px-2 pointer-events-auto">

        {leftItems.map(renderNavLink)}

        {/* Center — Create Pot, lifted higher */}
        <div className="relative flex flex-col items-center justify-center h-full px-2 shrink-0">
          <Link
            href="/pots/create"
            aria-label="Create new pot"
            className="flex h-13 w-13 -translate-y-6  items-center justify-center rounded-2xl bg-primary shadow-[0_12px_28px_rgba(255,210,0,0.5)] active:-translate-y-5 active:shadow-[0_6px_16px_rgba(255,210,0,0.35)] transition-all select-none group"
          >
            <Plus className="h-6 w-6 text-ink stroke-3 group-hover:rotate-90 transition-transform duration-200" />
          </Link>
          
        </div>

        {rightItems.map(renderNavLink)}

      </nav>
    </div>
  );
}