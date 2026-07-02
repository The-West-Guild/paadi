import { BottomNav } from "@/components/layout/bottom-nav"; // Adjust this import path based on where you saved BottomNav

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative h-dvh w-full bg-linear-to-br from-bg via-bg to-secondary/5 overflow-hidden">
      
      {/* GLOBAL VIEWPORT CONTAINER */}
      <main className="relative h-full w-full max-w-sm mx-auto flex flex-col bg-transparent">
        
        {/* SCROLLABLE SCENE LAYER */}
        {/* pb-24 ensures that long lists or dashboard elements can be scrolled fully into view without getting trapped behind the floating nav capsule */}
        <div className="flex-1 w-full overflow-y-auto px-6 pt-6 pb-24 scrollbar-none">
          {children}
        </div>

        {/* PREMIUM FLOATING NAVIGATION BAR */}
        <BottomNav />
        
      </main>
    </div>
  );
}