import {
  ActivityFeedResponse,
  ApiKeyCreatedDto,
  ApiKeyCurrentDto,
  ApiKeyDto,
  ApiKeysResponse,
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
  MintApiKeyInput,
  NotificationPrefsResponse,
  PayFromWalletInput,
  PayView,
  PayoutAccountsResponse,
  PayoutLookupInput,
  PayoutLookupResponse,
  PinVerifyInput,
  PotActivityResponse,
  PotDetail,
  PotSettlementResponse,
  PublicProfileResponse,
  ReceiptResponse,
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
  UsernameAvailableResponse,
  VirtualAccountResponse,
  WalletBalanceResponse,
  WalletStatementResponse,
  WithdrawInput,
  WithdrawalView,
} from "@paadi/contracts";

export interface PaadiClientOptions {
  baseUrl: string;
  token?: string;
}

/** Mirrors the documented error response union exactly. */
export type ApiErrorBody = {
  statusCode?: number;
  message?: string;
  issues?: { path: string; message: string }[];
};

export class PaadiApiError extends Error {
  statusCode?: number;
  issues?: { path: string; message: string }[];

  constructor(body: ApiErrorBody, httpStatus: number) {
    super(body.message ?? "request failed");
    this.statusCode = body.statusCode ?? httpStatus;
    this.issues = body.issues;
  }
}

export class PaadiClient {
  constructor(private readonly options: PaadiClientOptions) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

    // Parse body regardless — error bodies are JSON too
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new PaadiApiError(body as ApiErrorBody, response.status);
    }

    return body as T;
  }

  // ─── pots ────────────────────────────────────────────────────────────────

  createPot(input: CreatePotInput, idempotencyKey: string): Promise<PotDetail> {
    return this.request("/pots", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "idempotency-key": idempotencyKey },
    });
  }

  listPots(query?: {
    cursor?: string;
    limit?: number;
    status?: string;
  }): Promise<ListPotsResponse> {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(query ?? {}).filter(([, v]) => v !== undefined)
      ) as Record<string, string>
    ).toString();
    return this.request(`/pots${qs ? `?${qs}` : ""}`);
  }

  getPot(id: string): Promise<PotDetail> {
    return this.request(`/pots/${id}`);
  }

  updatePot(id: string, input: UpdatePotInput): Promise<PotDetail> {
    return this.request(`/pots/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deletePot(id: string): Promise<{ ok: boolean }> {
    return this.request(`/pots/${id}`, { method: "DELETE" });
  }

  cancelPot(id: string): Promise<PotDetail> {
    return this.request(`/pots/${id}/cancel`, { method: "POST" });
  }

  // ─── settlement ───────────────────────────────────────────────────────────

  getPotSettlement(id: string): Promise<PotSettlementResponse> {
    return this.request(`/pots/${id}/settlement`);
  }

  retryPotSettlement(id: string): Promise<PotDetail> {
    return this.request(`/pots/${id}/settle/retry`, { method: "POST" });
  }

  // ─── activity ─────────────────────────────────────────────────────────────

  getActivity(query?: {
    cursor?: string;
    limit?: number;
    from?: string;
    to?: string;
  }): Promise<ActivityFeedResponse> {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(query ?? {}).filter(([, v]) => v !== undefined)
      ) as Record<string, string>
    ).toString();
    return this.request(`/me/activity${qs ? `?${qs}` : ""}`);
  }

  getPotActivity(
    id: string,
    query?: { cursor?: string; limit?: number }
  ): Promise<PotActivityResponse> {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(query ?? {}).filter(([, v]) => v !== undefined)
      ) as Record<string, string>
    ).toString();
    return this.request(`/pots/${id}/activity${qs ? `?${qs}` : ""}`);
  }

  // ─── wallet ───────────────────────────────────────────────────────────────

  getWallet(): Promise<WalletBalanceResponse> {
    return this.request("/me/wallet");
  }

  getWalletTransactions(query?: {
    cursor?: string;
    limit?: number;
    direction?: "credit" | "debit";
    from?: string;
    to?: string;
  }): Promise<WalletStatementResponse> {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(query ?? {}).filter(([, v]) => v !== undefined)
      ) as Record<string, string>
    ).toString();
    return this.request(`/me/wallet/transactions${qs ? `?${qs}` : ""}`);
  }

  getStatement(query?: {
    cursor?: string;
    limit?: number;
    direction?: "credit" | "debit";
    from?: string;
    to?: string;
  }): Promise<WalletStatementResponse> {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(query ?? {}).filter(([, v]) => v !== undefined)
      ) as Record<string, string>
    ).toString();
    return this.request(`/me/statement${qs ? `?${qs}` : ""}`);
  }

  /** Settles a pot split from the wallet balance. Requires an idempotency key — reuse the same key to safely retry. */
  payFromWallet(
    input: PayFromWalletInput,
    idempotencyKey: string
  ): Promise<PotDetail> {
    return this.request("/me/wallet/pay", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "idempotency-key": idempotencyKey },
    });
  }

  /** Withdraws wallet funds to a bank account. Requires an idempotency key — reuse the same key to safely retry. */
  withdraw(
    input: WithdrawInput,
    idempotencyKey: string
  ): Promise<WithdrawalView> {
    return this.request("/me/wallet/withdraw", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "idempotency-key": idempotencyKey },
    });
  }

  getWithdrawal(id: string): Promise<WithdrawalView> {
    return this.request(`/me/wallet/withdrawals/${id}`);
  }

  // ─── api keys ─────────────────────────────────────────────────────────────

  /** Mints a new API key. Session auth only — the plaintext key is returned once and never again. */
  mintApiKey(input: MintApiKeyInput): Promise<ApiKeyCreatedDto> {
    return this.request("/me/api-keys", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listApiKeys(): Promise<ApiKeysResponse> {
    return this.request("/me/api-keys");
  }

  revokeApiKey(id: string): Promise<ApiKeyDto> {
    return this.request(`/me/api-keys/${id}`, { method: "DELETE" });
  }

  /** Returns the identity and scopes of the API key making this call. API-key auth only. */
  getCurrentApiKey(): Promise<ApiKeyCurrentDto> {
    return this.request("/me/api-keys/current");
  }

  // ─── virtual account ──────────────────────────────────────────────────────

  getVirtualAccount(): Promise<VirtualAccountResponse> {
    return this.request("/me/virtual-account");
  }

  createVirtualAccount(): Promise<VirtualAccountResponse> {
    return this.request("/me/virtual-account", { method: "POST", body: "{}" });
  }

  // ─── receipts ─────────────────────────────────────────────────────────────

  getPaymentReceipt(id: string): Promise<ReceiptResponse> {
    return this.request(`/receipts/payment/${id}`);
  }

  getSettlementReceipt(id: string): Promise<ReceiptResponse> {
    return this.request(`/receipts/settlement/${id}`);
  }

  // ─── pay (public) ─────────────────────────────────────────────────────────

  getPayerView(token: string): Promise<PayView> {
    return this.request(`/pay/${token}`);
  }

  // ─── bills ────────────────────────────────────────────────────────────────

  /** Lists electricity disco providers. Path: GET /bills/electricity/providers */
  listElectricityProviders(): Promise<BillerOption[]> {
    return this.request("/bills/electricity/providers");
  }

  /** @deprecated Use listElectricityProviders() — old path /discos does not exist on the server. */
  listElectricityDiscos(): Promise<BillerOption[]> {
    return this.listElectricityProviders();
  }

  /** Lists cable TV providers (DStv, GOtv, StarTimes). Path: GET /bills/cable/providers */
  listCableProviders(): Promise<BillerOption[]> {
    return this.request("/bills/cable/providers");
  }

  /** Lists cable plans for a given provider. Path: GET /bills/cable/plans?cableTvType=... */
  listCablePlans(cableTvType: string): Promise<BillerOption[]> {
    return this.request(
      `/bills/cable/plans?${new URLSearchParams({ cableTvType }).toString()}`
    );
  }

  /** @deprecated Use listCablePlans() — old path /products does not exist on the server. */
  listCableProducts(cableTvType: string): Promise<BillerOption[]> {
    return this.listCablePlans(cableTvType);
  }

  lookupElectricityCustomer(query: {
    disco: string;
    customerId: string;
    meterType: string;
  }): Promise<BillerCustomer> {
    const qs = new URLSearchParams(query as Record<string, string>).toString();
    return this.request(`/bills/electricity/lookup?${qs}`);
  }

  lookupCableCustomer(query: CableLookupQuery): Promise<BillerCustomer> {
    const qs = new URLSearchParams(query as Record<string, string>).toString();
    return this.request(`/bills/cable/lookup?${qs}`);
  }

  // ─── auth — signup ────────────────────────────────────────────────────────

  signupStart(input: SignupStartInput): Promise<SignupStartResponse> {
    return this.request("/auth/signup/start", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  signupVerifyPhone(input: SignupVerifyPhoneInput): Promise<{ verified: true }> {
    return this.request("/auth/signup/verify-phone", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  signupProfile(input: SignupProfileInput): Promise<{ ok: true }> {
    return this.request("/auth/signup/profile", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  signupUsername(input: SignupUsernameInput): Promise<{ ok: true }> {
    return this.request("/auth/signup/username", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  signupPassword(input: SignupPasswordInput): Promise<{ ok: true }> {
    return this.request("/auth/signup/password", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  signupPin(input: SignupPinInput): Promise<AuthSession> {
    return this.request("/auth/signup/pin", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  usernameAvailable(username: string): Promise<UsernameAvailableResponse> {
    return this.request(
      `/auth/username/available?u=${encodeURIComponent(username)}`
    );
  }

  // ─── auth — session ───────────────────────────────────────────────────────

  login(input: LoginInput): Promise<LoginResponse> {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  refresh(input: RefreshInput): Promise<AuthSession> {
    return this.request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  logout(): Promise<{ ok: true }> {
    return this.request("/auth/logout", { method: "POST" });
  }

  logoutAll(): Promise<{ ok: true }> {
    return this.request("/auth/logout-all", { method: "POST" });
  }

  forgotPassword(input: ForgotPasswordInput): Promise<{ message: string }> {
    return this.request("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  resetPassword(input: ResetPasswordInput): Promise<{ ok: true }> {
    return this.request("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // ─── auth — PIN ───────────────────────────────────────────────────────────

  verifyPin(input: PinVerifyInput): Promise<{ ok: true }> {
    return this.request("/auth/pin/verify", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  changePin(input: ChangePinInput): Promise<{ ok: true }> {
    return this.request("/auth/pin", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  // ─── auth — Google ────────────────────────────────────────────────────────

  googleSignIn(input: GoogleSignInInput): Promise<LoginResponse> {
    return this.request("/auth/google", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  linkGoogle(input: LinkGoogleInput): Promise<{ ok: true }> {
    return this.request("/me/identities/google", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // ─── me — profile ─────────────────────────────────────────────────────────

  getMe(): Promise<MeResponse> {
    return this.request("/me");
  }

  updateProfile(input: UpdateProfileInput): Promise<{ ok: true }> {
    return this.request("/me/profile", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  changeUsername(input: ChangeUsernameInput): Promise<{ ok: true }> {
    return this.request("/me/username", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  getPublicProfile(username: string): Promise<PublicProfileResponse> {
    return this.request(`/profiles/${encodeURIComponent(username)}`);
  }

  // ─── me — email ───────────────────────────────────────────────────────────

  emailStart(input: EmailStartInput): Promise<{ expiresIn: number }> {
    return this.request("/me/email/start", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  emailVerify(input: EmailVerifyInput): Promise<{ ok: true; email: string }> {
    return this.request("/me/email/verify", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // ─── kyc ─────────────────────────────────────────────────────────────────

  getKyc(): Promise<KycStatusResponse> {
    return this.request("/me/kyc");
  }

  submitKycBvn(input: KycBvnInput): Promise<{ status: "pending_liveness" }> {
    return this.request("/me/kyc/bvn", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  submitKycSelfie(
    input: KycSelfieInput
  ): Promise<{ status: "verified"; tier: "TIER_1" }> {
    return this.request("/me/kyc/selfie", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // ─── payout accounts ──────────────────────────────────────────────────────

  getBanks(): Promise<BanksResponse> {
    return this.request("/transfers/banks");
  }

  getPayoutAccounts(): Promise<PayoutAccountsResponse> {
    return this.request("/me/payout-accounts");
  }

  createPayoutAccount(
    input: CreatePayoutAccountInput
  ): Promise<PayoutAccountsResponse> {
    return this.request("/me/payout-accounts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  lookupPayoutAccount(input: PayoutLookupInput): Promise<PayoutLookupResponse> {
    return this.request("/me/payout-accounts/lookup", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  setPrimaryPayoutAccount(id: string): Promise<{ ok: true }> {
    return this.request(`/me/payout-accounts/${id}/primary`, {
      method: "PUT",
    });
  }

  deletePayoutAccount(
    id: string,
    input: DeletePayoutAccountInput
  ): Promise<{ ok: true }> {
    return this.request(`/me/payout-accounts/${id}`, {
      method: "DELETE",
      body: JSON.stringify(input),
    });
  }

  // ─── devices ─────────────────────────────────────────────────────────────

  registerDevice(input: RegisterDeviceInput): Promise<void> {
    return this.request("/me/devices", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  setDeviceBiometric(id: string, input: DeviceBiometricInput): Promise<void> {
    return this.request(`/me/devices/${id}/biometric`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  // ─── notifications ────────────────────────────────────────────────────────

  getNotificationPreferences(): Promise<NotificationPrefsResponse> {
    return this.request("/me/notification-preferences");
  }

  updateNotificationPreferences(
    input: UpdateNotificationPrefsInput
  ): Promise<NotificationPrefsResponse> {
    return this.request("/me/notification-preferences", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }
}

export function createClient(options: PaadiClientOptions): PaadiClient {
  return new PaadiClient(options);
}
