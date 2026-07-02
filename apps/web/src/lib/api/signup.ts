import { ApiError } from "./error";

/**
 * This file IS the contract — every type and method name here is copied
 * directly from the "Paadi Auth API — Frontend Reference" doc, including
 * the exact api-client method names ("signupStart", "signupVerifyPhone",
 * etc). When @paadi/api-client ships, the real client will implement
 * this exact same shape, so the swap is: delete the fixture object below,
 * import the real one, done. hooks.ts never changes.
 */

// ---- request/response types, copied from the reference table ----

export type SignupStartRequest = { phone: string };
export type SignupStartResponse = {
  onboardingToken: string;
  expiresIn: 1800;
  otpChannel: "sms";
};

export type SignupVerifyPhoneRequest = {
  onboardingToken: string;
  code: string; // len 6
};
export type SignupVerifyPhoneResponse = { verified: true };

export type SignupProfileRequest = {
  onboardingToken: string;
  firstName: string;
  lastName: string;
};
export type SignupProfileResponse = { ok: true };

export type UsernameAvailableResponse = {
  available: boolean;
  normalized: string;
  reason?: string;
};

export type SignupUsernameRequest = {
  onboardingToken: string;
  username: string;
};
export type SignupUsernameResponse = { ok: true };

export type SignupPasswordRequest = {
  onboardingToken: string;
  password: string; // min 8
};
export type SignupPasswordResponse = { ok: true };

export type SignupPinRequest = {
  onboardingToken: string;
  pin: string; // /^\d{4}$/
};

/** Returned by the PIN step — this is the moment the user becomes a real, authenticated account. */
export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // 900s for access token
  tokenType: "Bearer";
};

// ---- the contract itself ----

export type SignupApi = {
  signupStart: (req: SignupStartRequest) => Promise<SignupStartResponse>;
  signupVerifyPhone: (
    req: SignupVerifyPhoneRequest
  ) => Promise<SignupVerifyPhoneResponse>;
  signupProfile: (req: SignupProfileRequest) => Promise<SignupProfileResponse>;
  usernameAvailable: (handle: string) => Promise<UsernameAvailableResponse>;
  signupUsername: (
    req: SignupUsernameRequest
  ) => Promise<SignupUsernameResponse>;
  signupPassword: (
    req: SignupPasswordRequest
  ) => Promise<SignupPasswordResponse>;
  signupPin: (req: SignupPinRequest) => Promise<AuthSession>;
};

// ---- fixture implementation ----
// TEMPORARY — delete this object (and the helpers below it) once
// @paadi/api-client exports a real SignupApi. Everything above this
// comment is the permanent contract and should NOT need to change then.

const FAKE_LATENCY_MS = 500;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), FAKE_LATENCY_MS));
}

// in-memory store standing in for Redis' signup:{onboardingToken} session
const fakeOnboardingSessions = new Map<
  string,
  { phone: string; phoneVerified: boolean }
>();

const TEST_OTP = "000000"; // mirrors the documented dev OTP bypass
const RESERVED_USERNAMES = new Set([
  "admin",
  "support",
  "nomba",
  "paadi",
  "pay",
  "pot",
]);
const takenUsernames = new Set(["ada", "john"]); // pretend these exist already

export const fixtureSignupApi: SignupApi = {
  async signupStart({ phone }) {
    if (phone.replace(/\D/g, "").length < 7) {
      throw new ApiError({
        message: "Validation failed",
        issues: [{ path: "phone", message: "String must contain at least 7 character(s)" }],
      });
    }
    const onboardingToken = `fake_${Math.random().toString(36).slice(2)}`;
    fakeOnboardingSessions.set(onboardingToken, { phone, phoneVerified: false });
    return delay({ onboardingToken, expiresIn: 1800, otpChannel: "sms" });
  },

  async signupVerifyPhone({ onboardingToken, code }) {
    const session = fakeOnboardingSessions.get(onboardingToken);
    if (!session) {
      throw new ApiError({ statusCode: 400, message: "invalid onboarding token" });
    }
    if (code !== TEST_OTP) {
      throw new ApiError({ statusCode: 401, message: "invalid code" });
    }
    session.phoneVerified = true;
    return delay({ verified: true as const });
  },

  async signupProfile({ onboardingToken, firstName, lastName }) {
    const session = fakeOnboardingSessions.get(onboardingToken);
    if (!session?.phoneVerified) {
      throw new ApiError({ statusCode: 400, message: "phone not verified" });
    }
    if (!firstName || !lastName) {
      throw new ApiError({
        message: "Validation failed",
        issues: [{ path: "firstName", message: "String must contain at least 1 character(s)" }],
      });
    }
    return delay({ ok: true as const });
  },

  async usernameAvailable(handle) {
    const normalized = handle.toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9_.]{3,30}$/.test(normalized)) {
      return delay({
        available: false,
        normalized,
        reason: "must be 3-30 characters: letters, numbers, underscore, period",
      });
    }
    if (RESERVED_USERNAMES.has(normalized)) {
      return delay({ available: false, normalized, reason: "reserved" });
    }
    if (takenUsernames.has(normalized)) {
      return delay({ available: false, normalized, reason: "taken" });
    }
    return delay({ available: true, normalized });
  },

  async signupUsername({ onboardingToken, username }) {
    const session = fakeOnboardingSessions.get(onboardingToken);
    if (!session?.phoneVerified) {
      throw new ApiError({ statusCode: 400, message: "phone not verified" });
    }
    const normalized = username.toLowerCase().replace(/^@/, "");
    if (takenUsernames.has(normalized)) {
      throw new ApiError({ statusCode: 409, message: "username taken" });
    }
    return delay({ ok: true as const });
  },

  async signupPassword({ onboardingToken, password }) {
    const session = fakeOnboardingSessions.get(onboardingToken);
    if (!session?.phoneVerified) {
      throw new ApiError({ statusCode: 400, message: "phone not verified" });
    }
    if (password.length < 8) {
      throw new ApiError({
        message: "Validation failed",
        issues: [{ path: "password", message: "String must contain at least 8 character(s)" }],
      });
    }
    return delay({ ok: true as const });
  },

  async signupPin({ onboardingToken, pin }) {
    const session = fakeOnboardingSessions.get(onboardingToken);
    if (!session) {
      throw new ApiError({ statusCode: 400, message: "incomplete signup" });
    }
    if (!/^\d{4}$/.test(pin)) {
      throw new ApiError({
        message: "Validation failed",
        issues: [{ path: "pin", message: "Invalid" }],
      });
    }
    fakeOnboardingSessions.delete(onboardingToken);
    return delay({
      accessToken: `fake_access_${Math.random().toString(36).slice(2)}`,
      refreshToken: `fake_refresh_${Math.random().toString(36).slice(2)}`,
      expiresIn: 900,
      tokenType: "Bearer" as const,
    });
  },
};