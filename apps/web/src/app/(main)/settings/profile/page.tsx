"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMe, useUpdateProfile, useChangeUsername } from "@/features/settings/profile-hooks"; // Adjust path if needed
import { ChevronLeft, Loader2, User, AtSign, CheckCircle2 } from "lucide-react";
import { toast } from "@/features/toast/store";
import { ApiError } from "@/lib/api/error";

export default function ProfileSettingsPage() {
  const router = useRouter();
  const AVATARS = Array.from({ length: 8 }, (_, i) => `/assets/avatars/avatar-${i + 1}.png`);
  // Core Queries & Mutations
  const { data, isPending: isLoadingUser } = useMe();
  const updateProfileMutation = useUpdateProfile();
  const changeUsernameMutation = useChangeUsername();

  // Unified Form Local States
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");

  const [avatarUrl, setAvatarUrl] = useState("");
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  // Sync server data to local form inputs on initial query mount
  useEffect(() => {
    if (data?.profile) {
      setDisplayName(data.profile.displayName ?? "");
      setUsername(data.profile.username ?? "");
      setAvatarUrl(data.profile.avatarUrl ?? "");
    }
  }, [data]);

  // Combined tracking state for loading overlays
  const isSaving = updateProfileMutation.isPending || changeUsernameMutation.isPending;

  // Determine if user has actually touched inputs compared to server data cache
  const isDirty =
  displayName !== (data?.profile?.displayName ?? "") ||
  username !== (data?.profile?.username ?? "") ||
  avatarUrl !== (data?.profile?.avatarUrl ?? "");

  async function handleSaveChanges(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      toast.error("Username handle cannot be empty.");
      return;
    }

    const mutationQueue: Promise<unknown>[] = [];

    // Queue 1: Trigger profile metadata adjustments if dirty
    if (
        displayName !== (data?.profile?.displayName ?? "") ||
        avatarUrl !== (data?.profile?.avatarUrl ?? "")
      ) {
        mutationQueue.push(
          updateProfileMutation.mutateAsync({
            ...(displayName !== (data?.profile?.displayName ?? "") && {
              displayName: displayName.trim(),
            }),
            ...(avatarUrl !== (data?.profile?.avatarUrl ?? "") && {
              avatarUrl,
            }),
          })
        );
      }

    // Queue 2: Trigger handle alterations if dirty
    if (username !== (data?.profile?.username ?? "")) {
      mutationQueue.push(
        changeUsernameMutation.mutateAsync(username.trim().toLowerCase())
      );
    }

    try {
      // Coordinate parallel mutation resolution paths cleanly
      await Promise.all(mutationQueue);
      toast.success("Profile updated successfully!");
    } catch (err) {
        const apiErr = err as ApiError | null;
        if (apiErr?.statusCode === 409) {
          toast.error("That username is already taken. Try another.");
        } else {
          toast.error(apiErr?.message ?? "Failed to save changes. Please try again.");
        }
  }}

  return (
    <div className="w-full flex flex-col">
      {/* HEADER BAR */}
      <div className="flex items-center gap-2 mb-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-1.5 rounded-lg hover:bg-ink/5 text-ink/60 transition-colors mr-1"
        >
          <ChevronLeft className="h-5 w-5 stroke-[2.5]" />
        </button>
        <h1 className="text-2xl font-black text-ink tracking-tight">Edit Profile</h1>
      </div>

      {/* LOADING BOUNDS OVERLAY */}
      {isLoadingUser ? (
        <div className="flex flex-col items-center justify-center py-24 gap-2">
          <Loader2 className="h-5 w-5 text-secondary animate-spin" />
          <p className="text-xs font-semibold text-ink/40">Fetching profile details...</p>
        </div>
      ) : (
        <form onSubmit={handleSaveChanges} className="flex flex-col gap-5">
          


          {/* AVATAR PICKER TRIGGER */}
<div className="flex items-center gap-4 p-1">
<button
  type="button"
  onClick={() => setShowAvatarPicker(true)}
  className="relative h-16 w-16 shrink-0"
>
  {/* Background circle — sits behind */}
  <div className="absolute inset-0 rounded-full bg-primary border-2 border-ink shadow-[2px_2px_0px_0px_#111827]" />

  {avatarUrl ? (
    <img
      src={avatarUrl}
      alt="Your avatar"
      className="absolute inset-0.5 w-[calc(100%+1px)] h-[calc(100%+1px)] object-contain drop-shadow-md z-10"
    />
  ) : (
    <span className="absolute inset-0 flex items-center justify-center text-xl font-black text-ink z-10">
      {(displayName?.[0] ?? username?.[0] ?? "P").toUpperCase()}
    </span>
  )}

  <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white text-[10px] font-black border border-white z-20">
    ✎
  </span>
</button>
  <div className="flex flex-col gap-0.5">
    <span className="text-xs font-black text-ink/40 uppercase tracking-wide">Account Tier</span>
    <span className="text-sm font-black text-secondary uppercase tracking-tight">
      {data?.tier?.replace("_", " ") ?? "Standard"}
    </span>
  </div>
</div>

          {/* INPUT FIELDS STACK */}
          <div className="flex flex-col gap-4 mt-2">
            
            {/* Display Name Input Block */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-black text-ink/60 tracking-wide uppercase">Display Name</label>
              <div className="relative w-full">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-ink/30">
                  <User className="h-4 w-4 stroke-[2.5]" />
                </div>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Mudiaga"
                  className="w-full h-13 rounded-xl border-2 border-slate-100 bg-white pl-11 pr-4 text-sm font-bold text-ink shadow-sm outline-none focus:border-ink/20 transition-all placeholder:font-medium placeholder:text-ink/30"
                />
              </div>
            </div>

            {/* Username Handle Input Block */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-black text-ink/60 tracking-wide uppercase">Paadi Handle</label>
              <div className="relative w-full">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-ink/30">
                  <AtSign className="h-4 w-4 stroke-[2.5]" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                  placeholder="username"
                  className="w-full h-13 rounded-xl border-2 border-slate-100 bg-white pl-11 pr-4 text-sm font-black text-ink shadow-sm outline-none focus:border-ink/20 transition-all placeholder:font-medium placeholder:text-ink/30 lowercase"
                />
              </div>
              <p className="text-[10px] font-semibold text-ink/40 px-1 leading-relaxed">
                Handles can only contain alphanumeric characters and underscores. Editing this changes your global payment routing address.
              </p>
            </div>

          </div>

          {/* ACTION SUBMIT CONTAINER */}
          <div className="mt-4 pt-2">
            <button
              type="submit"
              disabled={!isDirty || isSaving}
              className="w-full rounded-2xl bg-primary py-4 font-black text-ink text-sm border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] disabled:opacity-40 disabled:active:translate-y-0 disabled:shadow-[0_4px_0px_0px_#111827] transition-all select-none"
            >
              {isSaving ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Committing mutations...
                </span>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>

        </form>
      )}

      {/* AVATAR PICKER SHEET */}
{showAvatarPicker && (
  <div className="fixed inset-0 bg-ink/60 z-100 flex items-end justify-center p-3 backdrop-blur-sm">
    <div className="w-full max-w-sm bg-white rounded-3xl border-2 border-ink p-6 shadow-[0_10px_0px_0px_#111827]">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-black text-ink">Pick your avatar</h3>
        <button
          type="button"
          onClick={() => setShowAvatarPicker(false)}
          className="text-xs font-bold text-ink/40"
        >
          Done
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {AVATARS.map((src) => (
          <button
            key={src}
            type="button"
            onClick={() => {
              setAvatarUrl(src);
              setShowAvatarPicker(false);
            }}
            className={`relative rounded-full overflow-hidden border-4 transition-all ${
                avatarUrl === src
                  ? "border-success shadow-[2px_2px_0px_0px_#111827]"
                  : "border-transparent"
              }`}
          >
            <img src={src} alt="" className="w-full aspect-square object-cover z-30" />
            {avatarUrl === src && (
              <div className="absolute inset-0 flex items-center justify-center ">
                
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  </div>
)}
    </div>
  );
}