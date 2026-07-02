import { create } from "zustand";

/**
 * Single store for the entire signup wizard (screens 5-10: phone through
 * biometric). Holds the server-side onboardingToken once /auth/signup/start
 * returns it — every later API call needs that token in its body, so it
 * lives here alongside the form fields, not just the fields themselves.
 *
 * Decision: accumulate fields in the store as the user types, but each
 * step's "Continue" button fires its OWN mutation immediately (signupProfile,
 * signupUsername, signupPassword...) rather than batching everything into
 * one final submit. This matches the real backend: each step is a live
 * request against a Redis-backed session that can fail independently
 * (username taken, password too short) — the user needs to know THAT screen
 * failed, not find out at the very end.
 *
 * The only fields persisted purely client-side with no matching server call
 * yet are pin/biometricEnabled until the PIN step (which sends both
 * username+password's confirmation already happened, and bundles pin).
 */

type OnboardingStep =
  | "phone"
  | "otp"
  | "name"
  | "username"
  | "password"
  | "pin"
  | "biometric"
  | "ready";

type OnboardingState = {
  step: OnboardingStep;

  // set once by signupStart, required on every subsequent call
  onboardingToken: string | null;

  phone: string;
  otpVerified: boolean;
  firstName: string;
  lastName: string;
  username: string;
  // password is intentionally NOT stored after the signupPassword call
  // succeeds — no reason to keep it sitting in client memory longer than
  // the single request that needs it.
  pin: string;
  biometricEnabled: boolean;

  setStep: (step: OnboardingStep) => void;
  setOnboardingToken: (token: string) => void;
  setPhone: (phone: string) => void;
  setOtpVerified: (verified: boolean) => void;
  setName: (firstName: string, lastName: string) => void;
  setUsername: (username: string) => void;
  setPin: (pin: string) => void;
  setBiometricEnabled: (enabled: boolean) => void;
  reset: () => void;
};

const initialState = {
  step: "phone" as OnboardingStep,
  onboardingToken: null as string | null,
  phone: "",
  otpVerified: false,
  firstName: "",
  lastName: "",
  username: "",
  pin: "",
  biometricEnabled: false,
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...initialState,
  setStep: (step) => set({ step }),
  setOnboardingToken: (onboardingToken) => set({ onboardingToken }),
  setPhone: (phone) => set({ phone }),
  setOtpVerified: (otpVerified) => set({ otpVerified }),
  setName: (firstName, lastName) => set({ firstName, lastName }),
  setUsername: (username) => set({ username }),
  setPin: (pin) => set({ pin }),
  setBiometricEnabled: (biometricEnabled) => set({ biometricEnabled }),
  reset: () => set(initialState),
}));