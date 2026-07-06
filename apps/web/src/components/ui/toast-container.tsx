"use client";

import { useToastStore, Toast } from "@/features/toast/store";
import { useEffect, useState } from "react";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();
  
  // To avoid hydration mismatch errors on first render with Zustand
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="fixed top-4 left-0 right-0 z-50 flex flex-col items-center gap-2 pointer-events-none px-4">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [isClosing, setIsClosing] = useState(false);

  // Allow animations to play out before actually unmounting
  const handleDismiss = () => {
    setIsClosing(true);
    setTimeout(onDismiss, 300); // match duration of slide-out animation
  };

  const typeConfig = {
    success: {
      bg: "bg-success text-white",
      icon: <CheckCircle2 className="w-5 h-5 shrink-0" />,
    },
    error: {
      bg: "bg-danger text-white",
      icon: <AlertCircle className="w-5 h-5 shrink-0" />,
    },
    warning: {
      bg: "bg-warning text-ink",
      icon: <AlertTriangle className="w-5 h-5 shrink-0" />,
    },
    info: {
      bg: "bg-ink text-white",
      icon: <Info className="w-5 h-5 shrink-0" />,
    },
  };

  const config = typeConfig[toast.type];

  return (
    <div
      className={`
        pointer-events-auto flex items-center justify-between w-full max-w-sm p-4 rounded-xl shadow-lg
        transition-all duration-300 ease-out transform
        ${config.bg}
        ${isClosing ? "opacity-0 -translate-y-4" : "animate-in slide-in-from-top-4 fade-in duration-300"}
      `}
      role="alert"
    >
      <div className="flex items-center gap-3">
        {config.icon}
        <p className="text-sm font-medium leading-snug">{toast.message}</p>
      </div>
      <button
        onClick={handleDismiss}
        className="ml-4 p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-black/10 transition-colors focus:outline-none"
        aria-label="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
