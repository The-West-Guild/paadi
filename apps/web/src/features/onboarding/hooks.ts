import { useMutation, useQuery } from "@tanstack/react-query";
import { fixtureSignupApi } from "@/lib/api/signup";
import { ApiError } from "@/lib/api/error";
import { useSessionStore } from "@/lib/auth/session";
import { useOnboardingStore } from "./store";

/**
 * One mutation per signup step, all following the SAME shape:
 *   1. call signupApi.<method>
 *   2. on success, write the result into the store
 *   3. the PAGE (not this file) decides where to navigate next
 *
 * Swap point: change this one import line when @paadi/api-client ships.
 *   import { signupApi } from "@paadi/api-client";
 * Nothing else in this file changes — every hook below calls "signupApi.x",
 * never "fixtureSignupApi.x" directly, so the rename is contained to one line.
 */
const signupApi = fixtureSignupApi;

// ---- 1. phone entry -> request OTP ----

export function useSignupStart() {
  const setOnboardingToken = useOnboardingStore((s) => s.setOnboardingToken);
  const setPhone = useOnboardingStore((s) => s.setPhone);

  return useMutation({
    mutationFn: (phone: string) => signupApi.signupStart({ phone }),
    onSuccess: (data, phone) => {
      setOnboardingToken(data.onboardingToken);
      setPhone(phone);
    },
  });
}

// ---- 2. OTP verify ----

export function useVerifyPhone() {
  const onboardingToken = useOnboardingStore((s) => s.onboardingToken);
  const setOtpVerified = useOnboardingStore((s) => s.setOtpVerified);

  return useMutation({
    mutationFn: (code: string) => {
      if (!onboardingToken) {
        // mirrors the real API's 400 shape so error handling in the UI
        // is identical whether this trips or the server's check does
        throw new ApiError({ statusCode: 400, message: "invalid onboarding token" });
      }
      return signupApi.signupVerifyPhone({ onboardingToken, code });
    },
    onSuccess: () => setOtpVerified(true),
  });
}

// re-request a code on the same phone — same endpoint as the initial send,
// the OTP screen's "resend" link just calls this again
export function useResendOtp() {
  const phone = useOnboardingStore((s) => s.phone);
  const setOnboardingToken = useOnboardingStore((s) => s.setOnboardingToken);

  return useMutation({
    mutationFn: () => signupApi.signupStart({ phone }),
    onSuccess: (data) => setOnboardingToken(data.onboardingToken),
  });
}

// ---- 3. name entry ----

export function useSignupProfile() {
  const onboardingToken = useOnboardingStore((s) => s.onboardingToken);
  const setName = useOnboardingStore((s) => s.setName);

  return useMutation({
    mutationFn: ({ firstName, lastName }: { firstName: string; lastName: string }) => {
      if (!onboardingToken) {
        throw new ApiError({ statusCode: 400, message: "invalid onboarding token" });
      }
      return signupApi.signupProfile({ onboardingToken, firstName, lastName });
    },
    onSuccess: (_data, vars) => setName(vars.firstName, vars.lastName),
  });
}

// ---- 4. username: availability check + claim ----

// separate from the mutation below on purpose — this one fires on every
// keystroke (debounced in the component), it's a read, not a step commit
export function useUsernameAvailable(handle: string) {
  return useQuery({
    queryKey: ["onboarding", "username-available", handle],
    queryFn: () => signupApi.usernameAvailable(handle),
    enabled: handle.length >= 3, // don't fire for "a", "ad" etc
    staleTime: 0,
    retry: false,
  });
}

export function useSignupUsername() {
  const onboardingToken = useOnboardingStore((s) => s.onboardingToken);
  const setUsername = useOnboardingStore((s) => s.setUsername);

  return useMutation({
    mutationFn: (username: string) => {
      if (!onboardingToken) {
        throw new ApiError({ statusCode: 400, message: "invalid onboarding token" });
      }
      return signupApi.signupUsername({ onboardingToken, username });
    },
    onSuccess: (_data, username) => setUsername(username),
  });
}

// ---- 5. password ----

export function useSignupPassword() {
  const onboardingToken = useOnboardingStore((s) => s.onboardingToken);

  return useMutation({
    // nothing written to the store on success — password is never kept
    // client-side longer than this one request, see store.ts comment
    mutationFn: (password: string) => {
      if (!onboardingToken) {
        throw new ApiError({ statusCode: 400, message: "invalid onboarding token" });
      }
      return signupApi.signupPassword({ onboardingToken, password });
    },
  });
}

// ---- 6. PIN -> this is the call that creates the real account ----

export function useSignupPin() {
  const onboardingToken = useOnboardingStore((s) => s.onboardingToken);
  const setPin = useOnboardingStore((s) => s.setPin);
  const setSession = useSessionStore((s) => s.setSession);

  return useMutation({
    mutationFn: (pin: string) => {
      if (!onboardingToken) {
        throw new ApiError({ statusCode: 400, message: "incomplete signup" });
      }
      return signupApi.signupPin({ onboardingToken, pin });
    },
    onSuccess: (session, pin) => {
      setPin(pin);
      // This is the real swap from before: the AuthSession returned here
      // (accessToken/refreshToken/expiresIn) now actually persists via
      // useSessionStore (lib/auth/session.ts), instead of being logged
      // and discarded. Dashboard and any /me/* call can now read
      // useSessionStore().accessToken to know the user is signed in.
      setSession(session);
    },
  });
}