import {
  AuthSession,
  BanksResponse,
  BillerCustomer,
  BillerOption,
  CableLookupQuery,
  ChangePinInput,
  ChangeUsernameInput,
  CreatePayoutAccountInput,
  CreatePotInput,
  DeletePayoutAccountInput,
  ElectricityLookupQuery,
  DeviceBiometricInput,
  EmailStartInput,
  EmailVerifyInput,
  ForgotPasswordInput,
  GoogleSignInInput,
  KycBvnInput,
  KycSelfieInput,
  KycStatusResponse,
  LinkGoogleInput,
  ListPotsResponse,
  LoginInput,
  LoginResponse,
  MeResponse,
  NotificationPrefsResponse,
  PayView,
  PayoutAccountsResponse,
  PayoutLookupInput,
  PayoutLookupResponse,
  PinVerifyInput,
  PotDetail,
  PublicProfileResponse,
  RefreshInput,
  RegisterDeviceInput,
  ResetPasswordInput,
  SignupPasswordInput,
  SignupPinInput,
  SignupProfileInput,
  SignupStartInput,
  SignupStartResponse,
  SignupUsernameInput,
  SignupVerifyPhoneInput,
  UpdateNotificationPrefsInput,
  UpdatePotInput,
  UpdateProfileInput,
  UsernameAvailableResponse
} from "@paadi/contracts";

export interface PaadiClientOptions {
  baseUrl: string;
  token?: string;
}

export class PaadiClient {
  constructor(private readonly options: PaadiClientOptions) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
        ...(init?.headers ?? {})
      }
    });
    return response.json() as Promise<T>;
  }

  createPot(input: CreatePotInput, idempotencyKey: string): Promise<PotDetail> {
    return this.request("/pots", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "idempotency-key": idempotencyKey }
    });
  }

  listPots(query?: { cursor?: string; limit?: number; status?: string }): Promise<ListPotsResponse> {
    const qs = new URLSearchParams(query as Record<string, string>).toString();
    return this.request(`/pots${qs ? `?${qs}` : ""}`);
  }

  getPot(id: string): Promise<PotDetail> {
    return this.request(`/pots/${id}`);
  }

  updatePot(id: string, input: UpdatePotInput): Promise<PotDetail> {
    return this.request(`/pots/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  }

  deletePot(id: string): Promise<{ ok: boolean }> {
    return this.request(`/pots/${id}`, { method: "DELETE" });
  }

  cancelPot(id: string): Promise<PotDetail> {
    return this.request(`/pots/${id}/cancel`, { method: "POST" });
  }

  getPayerView(token: string): Promise<PayView> {
    return this.request(`/pay/${token}`);
  }

  listElectricityDiscos(): Promise<BillerOption[]> {
    return this.request("/bills/electricity/providers");
  }

  lookupElectricityCustomer(query: ElectricityLookupQuery): Promise<BillerCustomer> {
    const qs = new URLSearchParams(query as Record<string, string>).toString();
    return this.request(`/bills/electricity/lookup?${qs}`);
  }

  listCableProducts(cableTvType: string): Promise<BillerOption[]> {
    return this.request(`/bills/cable/plans?${new URLSearchParams({ cableTvType }).toString()}`);
  }

  lookupCableCustomer(query: CableLookupQuery): Promise<BillerCustomer> {
    const qs = new URLSearchParams(query as Record<string, string>).toString();
    return this.request(`/bills/cable/lookup?${qs}`);
  }

  signupStart(input: SignupStartInput): Promise<SignupStartResponse> {
    return this.request("/auth/signup/start", { method: "POST", body: JSON.stringify(input) });
  }

  signupVerifyPhone(input: SignupVerifyPhoneInput): Promise<void> {
    return this.request("/auth/signup/verify-phone", { method: "POST", body: JSON.stringify(input) });
  }

  signupProfile(input: SignupProfileInput): Promise<void> {
    return this.request("/auth/signup/profile", { method: "POST", body: JSON.stringify(input) });
  }

  signupUsername(input: SignupUsernameInput): Promise<void> {
    return this.request("/auth/signup/username", { method: "POST", body: JSON.stringify(input) });
  }

  signupPassword(input: SignupPasswordInput): Promise<void> {
    return this.request("/auth/signup/password", { method: "POST", body: JSON.stringify(input) });
  }

  signupPin(input: SignupPinInput): Promise<AuthSession> {
    return this.request("/auth/signup/pin", { method: "POST", body: JSON.stringify(input) });
  }

  usernameAvailable(username: string): Promise<UsernameAvailableResponse> {
    return this.request(`/auth/username/available?u=${encodeURIComponent(username)}`);
  }

  login(input: LoginInput): Promise<LoginResponse> {
    return this.request("/auth/login", { method: "POST", body: JSON.stringify(input) });
  }

  refresh(input: RefreshInput): Promise<AuthSession> {
    return this.request("/auth/refresh", { method: "POST", body: JSON.stringify(input) });
  }

  logout(): Promise<void> {
    return this.request("/auth/logout", { method: "POST" });
  }

  logoutAll(): Promise<void> {
    return this.request("/auth/logout-all", { method: "POST" });
  }

  forgotPassword(input: ForgotPasswordInput): Promise<void> {
    return this.request("/auth/forgot-password", { method: "POST", body: JSON.stringify(input) });
  }

  resetPassword(input: ResetPasswordInput): Promise<void> {
    return this.request("/auth/reset-password", { method: "POST", body: JSON.stringify(input) });
  }

  verifyPin(input: PinVerifyInput): Promise<void> {
    return this.request("/auth/pin/verify", { method: "POST", body: JSON.stringify(input) });
  }

  changePin(input: ChangePinInput): Promise<void> {
    return this.request("/auth/pin", { method: "PUT", body: JSON.stringify(input) });
  }

  getMe(): Promise<MeResponse> {
    return this.request("/me");
  }

  updateProfile(input: UpdateProfileInput): Promise<MeResponse> {
    return this.request("/me/profile", { method: "PATCH", body: JSON.stringify(input) });
  }

  changeUsername(input: ChangeUsernameInput): Promise<MeResponse> {
    return this.request("/me/username", { method: "PUT", body: JSON.stringify(input) });
  }

  getPublicProfile(username: string): Promise<PublicProfileResponse> {
    return this.request(`/profiles/${encodeURIComponent(username)}`);
  }

  emailStart(input: EmailStartInput): Promise<void> {
    return this.request("/me/email/start", { method: "POST", body: JSON.stringify(input) });
  }

  emailVerify(input: EmailVerifyInput): Promise<void> {
    return this.request("/me/email/verify", { method: "POST", body: JSON.stringify(input) });
  }

  getKyc(): Promise<KycStatusResponse> {
    return this.request("/me/kyc");
  }

  submitKycBvn(input: KycBvnInput): Promise<KycStatusResponse> {
    return this.request("/me/kyc/bvn", { method: "POST", body: JSON.stringify(input) });
  }

  submitKycSelfie(input: KycSelfieInput): Promise<KycStatusResponse> {
    return this.request("/me/kyc/selfie", { method: "POST", body: JSON.stringify(input) });
  }

  getBanks(): Promise<BanksResponse> {
    return this.request("/transfers/banks");
  }

  getPayoutAccounts(): Promise<PayoutAccountsResponse> {
    return this.request("/me/payout-accounts");
  }

  createPayoutAccount(input: CreatePayoutAccountInput): Promise<PayoutAccountsResponse> {
    return this.request("/me/payout-accounts", { method: "POST", body: JSON.stringify(input) });
  }

  lookupPayoutAccount(input: PayoutLookupInput): Promise<PayoutLookupResponse> {
    return this.request("/me/payout-accounts/lookup", { method: "POST", body: JSON.stringify(input) });
  }

  setPrimaryPayoutAccount(id: string): Promise<PayoutAccountsResponse> {
    return this.request(`/me/payout-accounts/${id}/primary`, { method: "PUT" });
  }

  deletePayoutAccount(id: string, input: DeletePayoutAccountInput): Promise<PayoutAccountsResponse> {
    return this.request(`/me/payout-accounts/${id}`, { method: "DELETE", body: JSON.stringify(input) });
  }

  registerDevice(input: RegisterDeviceInput): Promise<void> {
    return this.request("/me/devices", { method: "POST", body: JSON.stringify(input) });
  }

  setDeviceBiometric(id: string, input: DeviceBiometricInput): Promise<void> {
    return this.request(`/me/devices/${id}/biometric`, { method: "PUT", body: JSON.stringify(input) });
  }

  getNotificationPreferences(): Promise<NotificationPrefsResponse> {
    return this.request("/me/notification-preferences");
  }

  updateNotificationPreferences(input: UpdateNotificationPrefsInput): Promise<NotificationPrefsResponse> {
    return this.request("/me/notification-preferences", { method: "PUT", body: JSON.stringify(input) });
  }

  googleSignIn(input: GoogleSignInInput): Promise<LoginResponse> {
    return this.request("/auth/google", { method: "POST", body: JSON.stringify(input) });
  }

  linkGoogle(input: LinkGoogleInput): Promise<void> {
    return this.request("/me/identities/google", { method: "POST", body: JSON.stringify(input) });
  }
}

export function createClient(options: PaadiClientOptions): PaadiClient {
  return new PaadiClient(options);
}
