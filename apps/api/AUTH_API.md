# Paadi Auth API — Frontend Reference

Complete, frontend-oriented reference for the Paadi authentication, profile, KYC, payout, device,
notification, identity, and webhook endpoints. Request/response shapes match the Zod DTOs in
`packages/contracts/src/dto` exactly.

## Base URL

| Environment | Base URL |
| --- | --- |
| Local dev | `http://localhost:3001` |
| Swagger UI | `http://localhost:3001/docs` |

There is **no global route prefix** — paths are mounted at the root (e.g. `POST http://localhost:3001/auth/login`).
The API speaks JSON; always send `Content-Type: application/json`.

## Auth model

Five access modes are used across the surface:

| Mode | How it travels | Used by |
| --- | --- | --- |
| **none** (`@Public`) | No credentials | signup steps, login, refresh, forgot/reset password, public profile, Google sign-in, webhooks |
| **Bearer** (access token) | `Authorization: Bearer <accessToken>` header | every `/me/*`, `/auth/logout*`, `/auth/pin*`, `/transfers/*`, Google link |
| **Bearer** (API key) | `Authorization: Bearer pk_(live\|test)_…` header | machine/agent access to scope-allowlisted routes only (see [API keys](#api-keys)) |
| **onboarding-token** | `onboardingToken` string in the JSON **body** (not a header) | `/auth/signup/{verify-phone,profile,username,password,pin}` |
| **signature** | Provider HMAC header over the raw body | `/webhooks/dojah`, `/webhooks/nomba` |

- **Access token**: short-lived JWT, TTL **15m** (`expiresIn: 900` seconds), `tokenType: "Bearer"`. Carries `sub` (user id), `sid` (session id), `tier`.
- **Refresh token**: opaque string, rotating (reuse is detected and revokes the whole family). Absolute lifetime ~90 days. Exchanged at `POST /auth/refresh`.
- **Onboarding token**: opaque string returned by `POST /auth/signup/start`, TTL **1800s** (30m), stored server-side in Redis. It is **not** a Bearer token — pass it in each signup step's body. Signup routes are `@Public`; the token itself is the proof-of-progress.
- **Signature**: `POST /webhooks/dojah` requires header `x-dojah-signature` = `HMAC-SHA256(rawBody, DOJAH_WEBHOOK_SECRET)` (hex). `POST /webhooks/nomba` currently accepts any caller (guard is a pass-through stub) but is documented as signature-gated.

## Standard error shape

All `HttpException`s serialize to one of these JSON bodies (HTTP status mirrors the `statusCode`):

```jsonc
// Thrown via a string message (most service-level errors)
{ "statusCode": 401, "message": "invalid credentials" }

// Validation failure (ZodValidationPipe) — note: no statusCode key, HTTP status is 400
{ "message": "Validation failed", "issues": [ { "path": "phone", "message": "String must contain at least 7 character(s)" } ] }

// Unhandled 500
{ "statusCode": 500 }
```

So the union the frontend should parse is `{ statusCode?: number; message?: string; issues?: { path: string; message: string }[] }`.

### Common status codes

| Status | Meaning in this API |
| --- | --- |
| **400** | Validation failed (`issues[]` present), or a bad-state error (e.g. `phone not verified`, `incomplete signup`, `no pending email`, `invalid onboarding token`) |
| **401** | Missing/invalid Bearer token, invalid credentials, invalid OTP/PIN, bad refresh, KYC name mismatch, liveness failed. Auth failures are deliberately **uniform** (`invalid credentials`) to avoid account enumeration |
| **403** | Reserved for tier/permission denials |
| **404** | Resource not found (`user not found`, `profile not found`, `payout account not found`) |
| **409** | Conflict — `username taken`, `account already exists`, `email already in use`, `google account already linked to another user`, `handle recently released`, `rename too soon` |
| **429** | OTP **resend cooldown** (`resend too soon`) — fired by the OTP issuer when a code was requested again before the resend window elapsed |

---

## auth — signup

Tag `auth`. All signup routes are `@Public`. `start` mints the onboarding token; every later step echoes it in the body.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/auth/signup/start` | none | `phone: string (min 7, parsed as NG E.164)` | `{ onboardingToken: string, expiresIn: 1800, otpChannel: "sms" }` | 400 invalid phone; 429 resend too soon | `signupStart` |
| POST | `/auth/signup/verify-phone` | onboarding-token | `onboardingToken: string`, `code: string (len 6)` | `{ verified: true }` | 400 invalid onboarding token; 401 invalid code | `signupVerifyPhone` |
| POST | `/auth/signup/profile` | onboarding-token | `onboardingToken: string`, `firstName: string (min 1)`, `lastName: string (min 1)` | `{ ok: true }` | 400 invalid token / phone not verified | `signupProfile` |
| GET | `/auth/username/available?u=<handle>` | none | query `u: string` | `{ available: boolean, normalized: string, reason?: string }` | 400 validation | `usernameAvailable` |
| POST | `/auth/signup/username` | onboarding-token | `onboardingToken: string`, `username: string` | `{ ok: true }` | 400 invalid username / phone not verified; 409 username taken | `signupUsername` |
| POST | `/auth/signup/password` | onboarding-token | `onboardingToken: string`, `password: string (min 8)` | `{ ok: true }` | 400 invalid token / phone not verified | `signupPassword` |
| POST | `/auth/signup/pin` | onboarding-token | `onboardingToken: string`, `pin: string (/^\d{4}$/)` | `AuthSession` → `{ accessToken, refreshToken, expiresIn: 900, tokenType: "Bearer" }` | 400 incomplete signup; 409 account already exists | `signupPin` |

`AuthSession` (shared): `{ accessToken: string, refreshToken: string, expiresIn: number, tokenType: "Bearer" }`.

## auth — session

Tag `auth`.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/auth/login` | none | `identifier: string (min 3 — phone, email, or username)`, `password: string (min 1)`, `deviceId?: string` | `AuthSession & { stepUpRequired: false }` | 401 invalid credentials (uniform) | `login` |
| POST | `/auth/refresh` | none | `refreshToken: string (min 1)` | `AuthSession` (rotated tokens) | 401 invalid refresh / token reuse detected / refresh expired | `refresh` |
| POST | `/auth/logout` | Bearer | _none_ | `{ ok: true }` | 401 missing/invalid token | `logout` |
| POST | `/auth/logout-all` | Bearer | _none_ | `{ ok: true }` | 401 missing/invalid token | `logoutAll` |
| POST | `/auth/forgot-password` | none | `identifier: string (min 3)` | `{ message: "if the account exists, a reset code has been sent" }` (always 200, no enumeration) | 429 resend too soon | `forgotPassword` |
| POST | `/auth/reset-password` | none | `identifier: string (min 3)`, `code: string (len 6)`, `newPassword: string (min 8)` | `{ ok: true }` | 401 invalid reset | `resetPassword` |

## auth — PIN

Tag `auth`. Bearer required.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/auth/pin/verify` | Bearer | `pin: string (/^\d{4}$/)` | `{ ok: true }` | 400 no pin set; 401 invalid pin | `verifyPin` |
| PUT | `/auth/pin` | Bearer | `currentPin: string (/^\d{4}$/)`, `newPin: string (/^\d{4}$/)` | `{ ok: true }` | 400 no pin set; 401 invalid pin | `changePin` |

## auth — Google identity

Tag `auth`.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/auth/google` | none | `idToken: string (min 1)` | `AuthSession` (only when a Google identity already maps to a user) | 401 google email not verified / user not found; 409 account exists (link in settings) / sign-up requires phone | `googleSignIn` |
| POST | `/me/identities/google` | Bearer | `idToken: string (min 1)` | `{ ok: true }` | 401 google email not verified; 409 already linked to another user | `linkGoogle` |

## me — profile

Tag `me`. Bearer required except the public profile lookup.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/me` | Bearer | _none_ | `MeResponse` (see below) | 401; 404 user not found | `getMe` |
| PATCH | `/me/profile` | Bearer | `displayName?: string (min 1)`, `avatarUrl?: string (url)`, `firstName?: string (min 1)`, `lastName?: string (min 1)` | `{ ok: true }` | 400 validation; 401 | `updateProfile` |
| PUT | `/me/username` | Bearer | `username: string` | `{ ok: true }` | 400 invalid username; 401; 409 username taken / handle recently released / rename too soon | `changeUsername` |
| GET | `/profiles/:username` | none | path `username` (a leading `@` is stripped) | `PublicProfileResponse` → `{ username: string, displayName: string\|null, avatarUrl: string\|null }` | 404 profile not found | `getPublicProfile` |

`MeResponse`:

```ts
{
  id: string;
  phoneMasked: string;        // e.g. "+234***6789"
  email: string | null;
  emailVerified: boolean;
  tier: string;               // "TIER_0" | "TIER_1" | "TIER_2"
  kycStatus: string;          // "NONE" | "PENDING" | "VERIFIED" | "FAILED"
  status: string;             // "ACTIVE" | "SUSPENDED" | "DELETED"
  profile: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    firstName: string | null;
    lastName: string | null;
  };
}
```

## me — email verification

Tag `me`. Bearer required.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/me/email/start` | Bearer | `email: string (email)` | `{ expiresIn: 1800 }` | 401; 409 email already in use; 429 resend too soon | `emailStart` |
| POST | `/me/email/verify` | Bearer | `code: string (len 6)` | `{ ok: true, email: string }` | 400 no pending email; 401 invalid code; 409 email already in use | `emailVerify` |

## kyc

Tag `kyc`. Bearer required. Successful BVN + selfie promotes the user to **TIER_1**.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/me/kyc` | Bearer | _none_ | `KycStatusResponse` → `{ kycStatus: string, tier: string, bvnVerified: boolean, bvnVerifiedAt: string\|null (ISO) }` | 401; 404 user not found | `getKycStatus` |
| POST | `/me/kyc/bvn` | Bearer | `bvn: string (/^\d{11}$/)` | `{ status: "pending_liveness" }` | 401 bvn name mismatch | `submitBvn` |
| POST | `/me/kyc/selfie` | Bearer | `image: string (min 1, base64)` | `{ status: "verified", tier: "TIER_1" }` | 400 submit bvn first; 401 liveness failed | `submitSelfie` |

## payout

Tag `payout`. Bearer required. Bank list is the Nomba/transfer bank directory; account creation re-verifies the PIN.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/transfers/banks` | Bearer | _none_ | `BanksResponse` → `{ banks: { code: string, name: string }[] }` | 401 | `listBanks` |
| GET | `/me/payout-accounts` | Bearer | _none_ | `PayoutAccountsResponse` → `{ accounts: PayoutAccount[] }` | 401 | `listPayoutAccounts` |
| POST | `/me/payout-accounts/lookup` | Bearer | `bankCode: string (min 1)`, `accountNumber: string (/^\d{10}$/)` | `{ accountName: string }` | 401; 400 validation | `lookupPayoutAccount` |
| POST | `/me/payout-accounts` | Bearer | `bankCode: string (min 1)`, `accountNumber: string (/^\d{10}$/)`, `pin: string (/^\d{4}$/)` | `PayoutAccount` (see below) | 401 invalid pin; 400 validation | `createPayoutAccount` |
| PUT | `/me/payout-accounts/:id/primary` | Bearer | _none_ (path `id: uuid`) | `{ ok: true }` | 401; 404 payout account not found | `setPrimaryPayoutAccount` |
| DELETE | `/me/payout-accounts/:id` | Bearer | `pin: string (/^\d{4}$/)` (path `id: uuid`) | `{ ok: true }` | 401 invalid pin; 404 payout account not found | `deletePayoutAccount` |

`PayoutAccount`:

```ts
{
  id: string;
  bankCode: string;
  bankName: string;
  accountNumberLast4: string;
  accountName: string;
  nameMatchVerified: boolean;
  isPrimary: boolean;
}
```

## devices

Tag `devices`. Bearer required.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/me/devices` | Bearer | `deviceId: string (min 1)`, `platform: "IOS"\|"ANDROID"\|"WEB"`, `pushToken?: string`, `biometricEnabled?: boolean` | Device row (upserted) | 400 validation; 401 | `registerDevice` |
| PUT | `/me/devices/:id/biometric` | Bearer | `biometricEnabled: boolean` (path `id` = deviceId) | Updated device row | 400 validation; 401 | `setDeviceBiometric` |

## notifications

Tag `notifications`. Bearer required. `event` values are `NEW_CONTRIBUTION`, `POT_SETTLED`, `PAYOUT_ALERT`, `NEW_LOGIN`, `ORGANIZER_REMINDER`, `FRIEND_REQUEST`.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/me/notification-preferences` | Bearer | _none_ | `NotificationPrefsResponse` → `{ preferences: { event: string, channel: "PUSH"\|"SMS"\|"WHATSAPP", enabled: boolean }[] }` | 401 | `getNotificationPreferences` |
| PUT | `/me/notification-preferences` | Bearer | `preferences: { event: string, channel: "PUSH"\|"SMS"\|"WHATSAPP", enabled: boolean }[]` | `NotificationPrefsResponse` (the updated full list) | 400 validation; 401 | `updateNotificationPreferences` |

## webhooks

Tag `webhooks`. `@Public` at the route guard level, gated by provider signatures. Not called by the frontend — listed for completeness.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/webhooks/dojah` | signature (`x-dojah-signature` HMAC-SHA256 hex over raw body) | provider payload `{ reference?, entity?.reference?, status? }` | `{ received: true }` | 401 missing/invalid signature, missing raw body | _n/a_ |
| POST | `/webhooks/nomba` | signature (pass-through stub today) | provider payload (opaque) | `{ received: true }` | _n/a_ | _n/a_ |

## api-keys

Tag `api-keys`. Scoped machine credentials for agents and integrations (e.g. the Paadi MCP server). A key **acts as its owner** (`sub` = owner user id) but only on routes explicitly allowlisted with a scope — everything else (PIN, KYC, devices, payout accounts, sessions, key management itself) is session-only and returns `403 "api key not permitted on this endpoint"`.

**⚠️ The plaintext key is returned once at mint time and never again.** Only its sha256 hash is stored. Store it like a password.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/me/api-keys` | Bearer (session only) | `{ name: string(1-64), scopes: Scope[], expiresAt?: ISO datetime }` | `201` `ApiKeyCreatedDto` incl. one-time `key` | 400 validation/limit/past expiry; 403 called with an API key | `mintApiKey` |
| GET | `/me/api-keys` | Bearer (session only) | _none_ | `{ keys: ApiKeyDto[] }` (prefix + metadata, never the secret) | 403 called with an API key | `listApiKeys` |
| GET | `/me/api-keys/current` | Bearer (**API key only**) | _none_ | `{ id, name, prefix, mode: "live"\|"test", scopes }` | 400 called with a session token | `getCurrentApiKey` |
| DELETE | `/me/api-keys/:id` | Bearer (session only) | _none_ | revoked `ApiKeyDto` | 404 not found / not owned; 403 called with an API key | `revokeApiKey` |

### Scope vocabulary

| Scope | Grants |
| --- | --- |
| `pots:read` | `GET /pots`, `GET /pots/:id`, pot settlement + receipts reads |
| `pots:write` | `POST /pots` (idempotency-key header required), update/delete/cancel, settlement retry |
| `wallet:read` | wallet balance, transactions, statement, withdrawal status |
| `wallet:pay` | `POST /me/wallet/pay` (also requires PIN + idempotency-key) |
| `wallet:withdraw` | `POST /me/wallet/withdraw` (also requires PIN + idempotency-key) |
| `bills:read` | biller providers/plans/customer lookups |
| `profile:read` | `GET /me` |
| `activity:read` | `GET /me/activity`, `GET /pots/:id/activity` |
| `webhooks:manage` | `/developer/webhooks*` registration and delivery reads |

Key lifecycle: keys are minted `pk_test_…` in non-production and `pk_live_…` in production; revocation takes effect immediately; optional `expiresAt` auto-disables a key. Money movement performed with an API key is written to a hash-chained audit trail.

### Rate limiting

All responses carry `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` (seconds). Limits are per principal per 60s window: **120** for session users, **60** per API key, **20** per IP for public routes. Exceeding the limit returns `429 { statusCode: 429, message: "rate limit exceeded" }` with a `Retry-After` header.

---

## Typical flows

### 1. Signup (phone → activated session)

1. `POST /auth/signup/start` `{ phone }` → save `onboardingToken`.
2. `POST /auth/signup/verify-phone` `{ onboardingToken, code }` (dev OTP bypass: `000000`).
3. `POST /auth/signup/profile` `{ onboardingToken, firstName, lastName }`.
4. `GET /auth/username/available?u=<handle>` → check, then `POST /auth/signup/username` `{ onboardingToken, username }`.
5. `POST /auth/signup/password` `{ onboardingToken, password }`.
6. `POST /auth/signup/pin` `{ onboardingToken, pin }` → returns `AuthSession`. Store `accessToken` + `refreshToken`. User is now **TIER_0**.

### 2. Login + token refresh

1. `POST /auth/login` `{ identifier, password }` → `AuthSession & { stepUpRequired }`. `identifier` may be phone, email, or username.
2. Use `Authorization: Bearer <accessToken>` on protected calls.
3. When the access token nears expiry (15m), `POST /auth/refresh` `{ refreshToken }` → new pair. Replace both tokens (refresh rotates).
4. `POST /auth/logout` ends the current session; `POST /auth/logout-all` revokes every session for the user.

### 3. KYC to Tier 1

1. `GET /me/kyc` → current `{ kycStatus, tier }`.
2. `POST /me/kyc/bvn` `{ bvn }` → `{ status: "pending_liveness" }` (name on BVN must match the profile).
3. `POST /me/kyc/selfie` `{ image }` → `{ status: "verified", tier: "TIER_1" }`. (Async Dojah completion can also arrive via `POST /webhooks/dojah`.)

### 4. Add a payout account

1. `GET /transfers/banks` → pick a `{ code, name }`.
2. `POST /me/payout-accounts/lookup` `{ bankCode, accountNumber }` → confirm `{ accountName }`.
3. `POST /me/payout-accounts` `{ bankCode, accountNumber, pin }` → returns the new `PayoutAccount` (first one becomes primary).
4. Optionally `PUT /me/payout-accounts/:id/primary` to change the default, or `DELETE /me/payout-accounts/:id` `{ pin }` to remove one.
