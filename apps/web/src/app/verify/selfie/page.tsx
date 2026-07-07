"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSubmitSelfie } from "@/features/kyc/hooks";
import { toast } from "@/features/toast/store";
import { Loader2, Camera } from "lucide-react";

export default function KycSelfiePage() {
  const router = useRouter();
  const submitSelfieMutation = useSubmitSelfie();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);

  const isPending = submitSelfieMutation.isPending;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size (< 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be smaller than 5MB.");
      return;
    }

    // Set preview URL
    const preview = URL.createObjectURL(file);
    setPreviewUrl(preview);

    // Convert to clean base64
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const cleanBase64 = base64String.replace(/^data:image\/[a-z]+;base64,/, "");
      setBase64Image(cleanBase64);
    };
    reader.readAsDataURL(file);
  }

  function handleTriggerCapture() {
    fileInputRef.current?.click();
  }

  function handleSubmit() {
    if (!base64Image) {
      toast.error("Please take a selfie first.");
      return;
    }

    submitSelfieMutation.mutate(base64Image, {
      onSuccess: () => {
        router.push("/verify/pending");
      },
      onError: (err: Error) => {
        toast.error(err.message ?? "Liveness check failed. Ensure your face is clearly visible and matches the BVN record.");
      },
    });
  }

  return (
    <div className="flex h-dvh flex-col bg-linear-to-br from-bg via-bg to-secondary/10 px-6 pb-8 pt-5 justify-between max-w-sm mx-auto overflow-y-auto">
      {/* HEADER */}
      <div className="flex items-center justify-between w-full relative shrink-0">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-xl font-bold p-2 text-ink/70 hover:text-ink transition-colors z-30"
        >
          ←
        </button>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xl font-black tracking-tight text-ink">Verification</span>
        </div>
        <div className="w-10" />
      </div>

      {/* CORE DISPLAY */}
      <div className="flex-1 flex flex-col justify-center items-center w-full my-auto max-y-[450px]">
        
        {/* Hidden File Input using Native Camera Capture */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*"
          capture="user"
          className="hidden"
        />


        {/* Capture Frame Target */}
        <button
          type="button"
          onClick={handleTriggerCapture}
          disabled={isPending}
          className="w-48 h-48 rounded-full border-4 border-dashed border-ink/20 hover:border-primary/50 bg-white flex items-center justify-center overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.03)] cursor-pointer relative group transition-all"
        >
          {previewUrl ? (
            <img src={previewUrl} alt="Selfie preview" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-ink/40 group-hover:text-primary transition-colors">
              <Camera className="h-10 w-10 stroke-[1.5]" />
              <span className="text-[10px] font-extrabold uppercase tracking-wider">Tap to Capture</span>
            </div>
          )}
          
          {isPending && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-xs flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
            </div>
          )}
        </button>

        {/* Guidance text */}
        <div className="text-center mt-6 shrink-0">
          <h1 className="text-xl font-black tracking-tight text-ink">
            Liveness Check
          </h1>
          <p className="mt-2 text-xs font-semibold text-ink/40 px-6 leading-relaxed">
            Please look directly into the camera in a well-lit room. Ensure your face is not covered by glasses or caps.
          </p>
        </div>

      </div>

      {/* FOOTER ACTIONS */}
      <div className="w-full mt-auto pt-4 shrink-0 flex flex-col gap-3">
        {previewUrl ? (
          <div className="flex flex-col gap-2 w-full">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-50 transition-all select-none"
            >
              <span>Submit Selfie</span>
              <span className="text-lg">➔</span>
            </button>
            <button
              type="button"
              onClick={handleTriggerCapture}
              disabled={isPending}
              className="w-full py-3 text-xs font-bold text-ink/50 hover:text-ink transition-colors text-center"
            >
              Retake photo
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleTriggerCapture}
            className="w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all select-none"
          >
            <span>Open Camera</span>
            <span className="text-lg">➔</span>
          </button>
        )}
      </div>
    </div>
  );
}
