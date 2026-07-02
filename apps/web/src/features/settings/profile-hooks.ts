import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fixtureMeApi } from "@/lib/api/me";
import { ApiError } from "@/lib/api/error";
import { useSessionStore } from "@/lib/auth/session";

/**
 * Profile, PIN, and logout hooks — everything backed by lib/api/me.ts.
 * Sibling files: notifications-hooks.ts (lib/api/notifications.ts),
 * payout-hooks.ts (lib/api/payout.ts). Split by domain so each file's
 * job is obvious at a glance, since the settings feature grew past one
 * file's worth of unrelated concerns.
 *
 * First hooks in the app that need the Bearer accessToken. Every onboarding
 * hook used an onboardingToken passed in the request BODY; these instead
 * read accessToken off useSessionStore and would attach it as an
 * Authorization header once a real apiClient exists. The fixtures here
 * don't actually check the token (see lib/api/me.ts comment) — but the
 * REACT pattern of reading it is what matters to get right now, since
 * every future Bearer-authenticated feature copies this same shape.
 */
const meApi = fixtureMeApi;

// ---- read current user ----

export function useMe() {
  const accessToken = useSessionStore((s) => s.accessToken);

  return useQuery({
    queryKey: ["me"],
    queryFn: () => meApi.getMe(),
    // don't bother firing this query at all if there's no session yet —
    // avoids a guaranteed-to-fail call on, e.g., a logged-out settings
    // route someone navigated to directly
    enabled: Boolean(accessToken),
  });
}

// ---- profile ----

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: {
      displayName?: string;
      avatarUrl?: string;
      firstName?: string;
      lastName?: string;
    }) => meApi.updateProfile(req),
    onSuccess: () => {
      // invalidate rather than manually patch the cache — getMe() will
      // refetch and pick up the change. Simpler and less error-prone than
      // hand-merging the response into the existing ["me"] cache entry.
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useChangeUsername() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (username: string) => meApi.changeUsername({ username }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

// ---- PIN ----

export function useVerifyPin() {
  return useMutation({
    mutationFn: (pin: string) => meApi.verifyPin({ pin }),
  });
}

export function useChangePin() {
  return useMutation({
    mutationFn: ({ currentPin, newPin }: { currentPin: string; newPin: string }) =>
      meApi.changePin({ currentPin, newPin }),
  });
}

// ---- logout ----

export function useLogout() {
  const clearSession = useSessionStore((s) => s.clearSession);

  return useMutation({
    mutationFn: () => meApi.logout(),
    onSuccess: () => {
      // clear the LOCAL session regardless — even if the server call
      // somehow failed, there's no good reason to leave stale tokens
      // sitting in this browser once the user has asked to log out
      clearSession();
    },
  });
}

export function useLogoutAll() {
  const clearSession = useSessionStore((s) => s.clearSession);

  return useMutation({
    mutationFn: () => meApi.logoutAll(),
    onSuccess: () => {
      clearSession();
    },
  });
}