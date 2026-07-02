import { ApiError } from "./error";

/**
 * Contract for the "me" and PIN/devices tags. Unlike everything in
 * signup.ts, every one of these is Bearer-authenticated — the caller
 * (hooks.ts) is responsible for having a valid accessToken from
 * useSessionStore before calling any of these. None of these fixtures
 * check the token themselves (a real apiClient would attach it via an
 * Authorization header automatically); they exist to prove the shape.
 */

// ---- /me ----

export type MeResponse = {
  id: string;
  phoneMasked: string;
  email: string | null;
  emailVerified: boolean;
  tier: "TIER_0" | "TIER_1" | "TIER_2";
  kycStatus: "NONE" | "PENDING" | "VERIFIED" | "FAILED";
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  profile: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    firstName: string | null;
    lastName: string | null;
  };
};

// ---- /me/profile ----

export type UpdateProfileRequest = {
  displayName?: string;
  avatarUrl?: string;
  firstName?: string;
  lastName?: string;
};
export type UpdateProfileResponse = { ok: true };

// ---- /me/username ----

export type ChangeUsernameRequest = { username: string };
export type ChangeUsernameResponse = { ok: true };

// ---- /auth/pin ----

export type VerifyPinRequest = { pin: string };
export type VerifyPinResponse = { ok: true };

export type ChangePinRequest = { currentPin: string; newPin: string };
export type ChangePinResponse = { ok: true };

// ---- /me/devices ----

export type RegisterDeviceRequest = {
  deviceId: string;
  platform: "IOS" | "ANDROID" | "WEB";
  pushToken?: string;
  biometricEnabled?: boolean;
};
export type DeviceResponse = {
  id: string;
  deviceId: string;
  platform: "IOS" | "ANDROID" | "WEB";
  biometricEnabled: boolean;
};

export type SetDeviceBiometricRequest = { biometricEnabled: boolean };

// ---- /auth/logout, /auth/logout-all ----

export type OkResponse = { ok: true };

// ---- the contract ----

export type MeApi = {
  getMe: () => Promise<MeResponse>;
  updateProfile: (req: UpdateProfileRequest) => Promise<UpdateProfileResponse>;
  changeUsername: (req: ChangeUsernameRequest) => Promise<ChangeUsernameResponse>;
  verifyPin: (req: VerifyPinRequest) => Promise<VerifyPinResponse>;
  changePin: (req: ChangePinRequest) => Promise<ChangePinResponse>;
  registerDevice: (req: RegisterDeviceRequest) => Promise<DeviceResponse>;
  setDeviceBiometric: (
    deviceId: string,
    req: SetDeviceBiometricRequest
  ) => Promise<DeviceResponse>;
  logout: () => Promise<OkResponse>;
  logoutAll: () => Promise<OkResponse>;
};

// ---- fixture implementation ----
// TEMPORARY — delete once @paadi/api-client ships a real MeApi.

const FAKE_LATENCY_MS = 400;
function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), FAKE_LATENCY_MS));
}

// fake current-user record, mutated in place as the fixtures below run —
// stands in for the row Prisma would actually update
let fakeMe: MeResponse = {
  id: "fake_user_1",
  phoneMasked: "+234***6789",
  email: null,
  emailVerified: false,
  tier: "TIER_0",
  kycStatus: "NONE",
  status: "ACTIVE",
  profile: {
    username: "tunde_a",
    displayName: null,
    avatarUrl: null,
    firstName: "Tunde",
    lastName: "Adebayo",
  },
};

// the PIN set during signup isn't available here (it's intentionally
// never persisted outside the moment it was set, per onboarding/store.ts) —
// fixture assumes "0000" as the known current PIN for local testing
let fakeCurrentPin = "0000";

export const fixtureMeApi: MeApi = {
  async getMe() {
    return delay(fakeMe);
  },

  async updateProfile(req) {
    fakeMe = {
      ...fakeMe,
      profile: {
        ...fakeMe.profile,
        ...(req.displayName !== undefined && { displayName: req.displayName }),
        ...(req.avatarUrl !== undefined && { avatarUrl: req.avatarUrl }),
        ...(req.firstName !== undefined && { firstName: req.firstName }),
        ...(req.lastName !== undefined && { lastName: req.lastName }),
      },
    };
    return delay({ ok: true as const });
  },

  async changeUsername({ username }) {
    if (username.toLowerCase() === "admin") {
      throw new ApiError({ statusCode: 409, message: "username taken" });
    }
    fakeMe = { ...fakeMe, profile: { ...fakeMe.profile, username } };
    return delay({ ok: true as const });
  },

  async verifyPin({ pin }) {
    if (pin !== fakeCurrentPin) {
      throw new ApiError({ statusCode: 401, message: "invalid pin" });
    }
    return delay({ ok: true as const });
  },

  async changePin({ currentPin, newPin }) {
    if (currentPin !== fakeCurrentPin) {
      throw new ApiError({ statusCode: 401, message: "invalid pin" });
    }
    fakeCurrentPin = newPin;
    return delay({ ok: true as const });
  },

  async registerDevice(req) {
    return delay({
      id: `device_${Math.random().toString(36).slice(2)}`,
      deviceId: req.deviceId,
      platform: req.platform,
      biometricEnabled: req.biometricEnabled ?? false,
    });
  },

  async setDeviceBiometric(deviceId, { biometricEnabled }) {
    return delay({
      id: deviceId,
      deviceId,
      platform: "WEB" as const,
      biometricEnabled,
    });
  },

  async logout() {
    return delay({ ok: true as const });
  },

  async logoutAll() {
    return delay({ ok: true as const });
  },
};