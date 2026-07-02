# Paadi Pots API — Frontend Reference

Complete, frontend-oriented reference for the Paadi "pot engine" — bill-split pots, their public
pay links, the biller-discovery helpers used while building a `bill_payment` pot, and the inbound
Nomba webhook. Request/response shapes match the Zod DTOs in `packages/contracts/src/dto` exactly
(`pot.dto.ts`, `bill.dto.ts`, `payment.dto.ts`) with enums from `packages/contracts/src/enums.ts`.

For auth, profile, KYC, and payout endpoints see [`AUTH_API.md`](./AUTH_API.md).

## Base URL

| Environment | Base URL |
| --- | --- |
| Local dev | `http://localhost:3001` |
| Swagger UI | `http://localhost:3001/docs` |

There is **no global route prefix** — paths are mounted at the root (e.g. `POST http://localhost:3001/pots`).
The API speaks JSON; always send `Content-Type: application/json`.

## Auth model

| Mode | How it travels | Used by |
| --- | --- | --- |
| **Bearer** (access token) | `Authorization: Bearer <accessToken>` header | every `/pots*` route, every `/bills/*` route |
| **Bearer + Idempotency-Key** | Bearer header **plus** an `Idempotency-Key` header | `POST /pots` only |
| **none** (`@Public`) | No credentials | `GET /pay/:token` (the public pay link) |
| **signature** | Provider HMAC headers over the raw body | `POST /webhooks/nomba` |

- **Access token**: short-lived JWT (TTL 15m), obtained from the auth flow. It carries `sub` (user id);
  every pot is scoped to its creator, so the token's `sub` is the pot owner for all `/pots*` calls.
- **Idempotency-Key**: an arbitrary client-chosen string sent in the `Idempotency-Key` header on
  `POST /pots`. It is **required** — a create without it returns **400**. Replaying the same key with
  the **same** body returns the original pot unchanged; replaying it with a **different** body returns
  **409**. Scope is per-user, so two users may use the same key value independently.
- **Signature** (`POST /webhooks/nomba`): see [webhooks](#webhooks). The frontend never calls this route.

## Money, amounts & enums

- **All monetary amounts are integer kobo** (₦1 = 100 kobo). Fields ending in `Kobo`
  (`totalKobo`, `amountKobo`, `shareKobo`, `paidKobo`, `collectedKobo`, `targetKobo`) are always
  whole numbers — never decimals, never naira. Format for display by dividing by 100.
- **Statuses and most enums are lowercase strings** in responses (`"open"`, `"bill_payment"`,
  `"partially_paid"`). The one exception is **`meterType`, which is UPPERCASE** (`"PREPAID"` /
  `"POSTPAID"`) on both the request and the response.
- Timestamps (`deadlineAt`, `createdAt`, `paidAt`) are ISO-8601 strings (e.g. `"2026-07-15T23:59:59.000Z"`).

Enum reference (the literal values the API accepts / returns):

```ts
settlementType : "bill_payment" | "bank_payout" | "wallet"   // "wallet" is rejected (400) today
completionRule : "progressive"  | "all_or_nothing"
splitMode      : "weight"       | "amount" | "percent"        // default "weight"
attributionMode: "checkout_link"| "virtual_account"          // default "checkout_link"; "virtual_account" rejected (400)
billerCategory : "electricity"  | "cable"
meterType      : "PREPAID"      | "POSTPAID"                  // UPPERCASE
potStatus      : "draft" | "open" | "funded" | "settling" | "settled" | "expired" | "cancelled" | "refunding" | "refunded"
shareStatus    : "pending" | "partially_paid" | "paid" | "overpaid" | "expired" | "refunded"
```

## Standard error shape

All `HttpException`s serialize to one of these JSON bodies (HTTP status mirrors the `statusCode`):

```jsonc
// Thrown via a string message (most service-level errors)
{ "statusCode": 409, "message": "pot has payments, cannot edit" }

// Validation failure (ZodValidationPipe) — note: no statusCode key, HTTP status is 400
{ "message": "Validation failed", "issues": [ { "path": "splits", "message": "split amounts must sum to totalKobo" } ] }

// Unhandled 500
{ "statusCode": 500 }
```

So the union the frontend should parse is `{ statusCode?: number; message?: string; issues?: { path: string; message: string }[] }`.

### Common status codes

| Status | Meaning across the pot engine |
| --- | --- |
| **400** | Validation failed (`issues[]` present); missing `Idempotency-Key` header; `settlementType: "wallet"`; `attributionMode: "virtual_account"`; deadline in the past; `bank_payout` with no payout account on file; `totalKobo` too small to split; pot not editable in its current status; invalid cancel transition; unsupported biller category |
| **401** | Missing/invalid Bearer token (all `/pots*` and `/bills/*`); missing/invalid webhook signature |
| **403** | The chosen payout account is not name-verified (`bank_payout` pots) |
| **404** | `pot not found` (also returned when the pot exists but belongs to another user), `pay link not found`, `payout account not found` |
| **409** | Idempotency key reused with a different payload; pot creation already in progress; `pot has payments` (on edit/delete); pot cannot be deleted in its current status |
| **502** | `checkout provider unavailable` — the Nomba checkout-order call failed while finalizing a create |

---

## pots

Tag `pots`. **Bearer required** on every route. All routes are scoped to the authenticated creator —
a pot owned by another user is indistinguishable from a missing one (both return **404 `pot not found`**).

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/pots` | Bearer + `Idempotency-Key` | `createPotSchema` (see below) | `PotDetail` (**201**) | 400 missing key / validation / unsupported settlement-or-attribution / bad deadline / small total; 403 payout not name-verified; 404 payout account not found; 409 key reuse / in progress; 502 checkout unavailable | `createPot(input, idempotencyKey)` |
| GET | `/pots` | Bearer | _none_ (query: `cursor?`, `limit?`, `status?`) | `ListPotsResponse` | 401 | `listPots(query?)` |
| GET | `/pots/:id` | Bearer (owner) | _none_ (path `id: uuid`) | `PotDetail` | 401; 404 pot not found | `getPot(id)` |
| PATCH | `/pots/:id` | Bearer (owner) | `updatePotSchema` (title/description/deadline) | `PotDetail` | 400 validation / not editable in status; 404 pot not found; 409 pot has payments | `updatePot(id, input)` |
| DELETE | `/pots/:id` | Bearer (owner) | _none_ (path `id: uuid`) | `{ ok: true }` | 401; 404 pot not found; 409 has payments / not deletable in status | `deletePot(id)` |
| POST | `/pots/:id/cancel` | Bearer (owner) | _none_ (path `id: uuid`) | `PotDetail` | 401; 404 pot not found; 400 invalid transition | `cancelPot(id)` |

### `createPotSchema` (request body for `POST /pots`)

| Field | Type / rule | Required | Notes |
| --- | --- | --- | --- |
| `title` | string, 3–120 chars | yes | |
| `description` | string, ≤ 500 chars | no | |
| `totalKobo` | integer > 0 | yes | The full amount to collect, in kobo. |
| `settlementType` | `"bill_payment"` \| `"bank_payout"` \| `"wallet"` | yes | `"wallet"` settles the collected funds into the pot creator's Paadi wallet. |
| `completionRule` | `"progressive"` \| `"all_or_nothing"` | yes | |
| `splitMode` | `"weight"` \| `"amount"` \| `"percent"` | no (default `"weight"`) | Drives the per-split validation below. |
| `attributionMode` | `"checkout_link"` \| `"virtual_account"` | no (default `"checkout_link"`) | `"virtual_account"` is **rejected with 400** (`virtual account attribution is not yet supported`). Not echoed in `PotDetail`. |
| `deadlineAt` | ISO-8601 datetime string | no | Must be in the **future** or you get 400 `deadline must be in the future`. If omitted, the server defaults it to **now + 7 days**. |
| `billerCategory` | `"electricity"` \| `"cable"` | required iff `settlementType="bill_payment"` | |
| `billerProductCode` | string, 1–64 chars | required iff `settlementType="bill_payment"` | The provider/plan code from the bills discovery endpoints. |
| `billerCustomerId` | string, 1–64 chars | required iff `settlementType="bill_payment"` | Meter / smartcard / account number. |
| `meterType` | `"PREPAID"` \| `"POSTPAID"` | required iff `billerCategory="electricity"` | |
| `payoutAccountId` | uuid | no | Only meaningful for `bank_payout`. If omitted on a `bank_payout` pot, your **primary** payout account is used; if you have none, 400 `no payout account on file`. The account must be name-verified or you get 403. Not echoed in `PotDetail`. |
| `splits` | array of `SplitInput`, **2–50 items** | yes | See split rules. |

`SplitInput`:

```ts
{
  label: string;        // 1–80 chars
  weight?: number;      // > 0      — used in "weight" mode
  amountKobo?: number;  // int > 0  — used in "amount" mode
  percent?: number;     // > 0, ≤ 100 — used in "percent" mode
}
```

**Per-mode split validation** (enforced by `createPotSchema.superRefine`; failures are 400 with
`path: ["splits"]`):

| `splitMode` | each split MUST set | each split MUST NOT set | cross-check |
| --- | --- | --- | --- |
| `weight` (default) | `weight` (> 0) | `amountKobo`, `percent` | — |
| `amount` | `amountKobo` (int > 0) | `weight`, `percent` | Σ `amountKobo` **must equal** `totalKobo` |
| `percent` | `percent` (> 0, ≤ 100) | `weight`, `amountKobo` | Σ `percent` **must equal** `100` |

Additional service-level guard: even in `weight`/`percent` mode the computed integer shares must each be
≥ 1 kobo — a `totalKobo` too small to divide across all participants returns 400
`totalKobo too small to split across N participants`.

**What create actually does:** on success the pot is persisted, a Nomba checkout order is created for
**each** split (populating its `payToken` + `checkoutUrl`), and the pot is moved from `draft` to `open`.
So the **201** response already has `status: "open"` and every split has a usable `checkoutUrl`. Because
this is wrapped in idempotency, retrying the same `Idempotency-Key`+body is safe.

#### Example — create an electricity bill-split pot (weight mode)

Request:

```jsonc
// POST /pots
// Authorization: Bearer <accessToken>
// Idempotency-Key: 7c1f3a9e-pot-create-01
{
  "title": "December NEPA bill",
  "description": "Prepaid units for the flat",
  "totalKobo": 5000000,                       // ₦50,000.00
  "settlementType": "bill_payment",
  "completionRule": "all_or_nothing",
  "splitMode": "weight",
  "deadlineAt": "2026-07-15T23:59:59.000Z",
  "billerCategory": "electricity",
  "billerProductCode": "ikeja-electric",
  "billerCustomerId": "45010101010",
  "meterType": "PREPAID",
  "splits": [
    { "label": "Tunde", "weight": 1 },
    { "label": "Ada",   "weight": 1 },
    { "label": "Chidi", "weight": 2 }
  ]
}
```

Response `201` (`PotDetail`):

```json
{
  "id": "0b3e7d2c-9a41-4f8e-bb10-2a6e0b9f1c34",
  "title": "December NEPA bill",
  "description": "Prepaid units for the flat",
  "totalKobo": 5000000,
  "settlementType": "bill_payment",
  "completionRule": "all_or_nothing",
  "status": "open",
  "billerCategory": "electricity",
  "billerProductCode": "ikeja-electric",
  "billerCustomerId": "45010101010",
  "meterType": "PREPAID",
  "deadlineAt": "2026-07-15T23:59:59.000Z",
  "createdAt": "2026-06-29T10:30:00.000Z",
  "progress": { "collectedKobo": 0, "targetKobo": 5000000, "paidCount": 0, "splitCount": 3 },
  "splits": [
    { "id": "b1a0…", "label": "Tunde", "shareKobo": 1250000, "paidKobo": 0, "status": "pending", "payToken": "pt_8Kd2…", "checkoutUrl": "https://checkout.nomba.com/pt_8Kd2…", "paidAt": null },
    { "id": "b1a1…", "label": "Ada",   "shareKobo": 1250000, "paidKobo": 0, "status": "pending", "payToken": "pt_9Lf3…", "checkoutUrl": "https://checkout.nomba.com/pt_9Lf3…", "paidAt": null },
    { "id": "b1a2…", "label": "Chidi", "shareKobo": 2500000, "paidKobo": 0, "status": "pending", "payToken": "pt_0Mh4…", "checkoutUrl": "https://checkout.nomba.com/pt_0Mh4…", "paidAt": null }
  ]
}
```

#### Example — bank-payout pot, amount mode

```jsonc
// POST /pots   (Idempotency-Key + Bearer)
{
  "title": "Group gift for Bisi",
  "totalKobo": 3000000,                        // ₦30,000.00
  "settlementType": "bank_payout",
  "completionRule": "progressive",
  "splitMode": "amount",
  "payoutAccountId": "f2c9…",                  // optional; omit to use your primary account
  "splits": [
    { "label": "Me",   "amountKobo": 1000000 },
    { "label": "Sam",  "amountKobo": 1000000 },
    { "label": "Lola", "amountKobo": 1000000 } // Σ amountKobo === totalKobo (required)
  ]
}
```

### `GET /pots` — list query

| Query param | Type / rule | Default | Notes |
| --- | --- | --- | --- |
| `cursor` | uuid | — | Pass back the previous response's `nextCursor` to page forward. |
| `limit` | integer 1–50 (coerced from string) | `20` | |
| `status` | any `potStatus` value | — | Filter to one status. |

Response (`ListPotsResponse`):

```ts
{
  items: PotSummary[];
  nextCursor: string | null;   // uuid; null when there are no more pages
}
```

`PotSummary` (note: a **flat** progress shape — no nested `progress` object and no `splits[]`, unlike
`PotDetail`):

```ts
{
  id: string;                  // uuid
  title: string;
  status: PotStatus;
  totalKobo: number;           // int
  collectedKobo: number;       // int
  splitCount: number;          // int
  paidCount: number;           // int
  deadlineAt: string | null;   // ISO-8601
  createdAt: string;           // ISO-8601
}
```

### `PATCH /pots/:id` — `updatePotSchema`

Only three fields are editable, and **at least one** must be present (else 400):

```ts
{
  title?: string;        // 3–120 chars
  description?: string;  // ≤ 500 chars
  deadlineAt?: string;   // ISO-8601 datetime
}
```

Editing is only allowed while the pot is `draft`/`open` **and** has zero payments:
- 409 `pot has payments, cannot edit` if any money has been collected.
- 400 `pot not editable in status <status>` if the pot has moved past `draft`/`open`.

Returns the full updated `PotDetail`.

### `DELETE /pots/:id`

Hard-deletes a pot, allowed **only while `draft`/`open` with zero payments**:
- 409 `pot has payments, cancel instead` if any payment exists.
- 409 `pot cannot be deleted in status <status>` once past `draft`/`open`.

Returns `{ "ok": true }`. (Once a pot has activity, use cancel instead.)

### `POST /pots/:id/cancel`

Cancels the pot via the state machine (`assertPoolTransition(status, "cancelled")`). If the current
status cannot transition to `cancelled`, returns **400** with the transition error message. Returns the
updated `PotDetail` (with `status: "cancelled"`).

### Shapes returned by the pot endpoints

`PotDetail` (returned by create, get-one, patch, cancel):

```ts
{
  id: string;                       // uuid
  title: string;
  description: string | null;
  totalKobo: number;                // int
  settlementType: SettlementType;
  completionRule: CompletionRule;
  status: PotStatus;
  billerCategory: BillerCategory | null;
  billerProductCode: string | null;
  billerCustomerId: string | null;
  meterType: MeterType | null;      // UPPERCASE
  deadlineAt: string | null;        // ISO-8601
  createdAt: string;                // ISO-8601
  progress: PotProgress;
  splits: SplitDetail[];
}
```

> Note: `attributionMode` and `payoutAccountId` are **input-only** — they are accepted by `createPotSchema`
> but are **not** part of `PotDetail`. Don't expect them back on the response.

`PotProgress`:

```ts
{
  collectedKobo: number;   // int — total paid so far
  targetKobo: number;      // int — equals the pot's totalKobo
  paidCount: number;       // int — splits fully paid
  splitCount: number;      // int — total splits
}
```

`SplitDetail`:

```ts
{
  id: string;                  // uuid
  label: string;
  shareKobo: number;           // int — this participant's share
  paidKobo: number;            // int — amount paid against this split
  status: ShareStatus;         // "pending" | "partially_paid" | "paid" | "overpaid" | "expired" | "refunded"
  payToken: string;            // opaque token for the public pay link (GET /pay/:token)
  checkoutUrl: string | null;  // hosted Nomba checkout URL for this split
  paidAt: string | null;       // ISO-8601 when fully paid
}
```

---

## bills

Tag `bills`. **Bearer required.** Helpers for building a `bill_payment` pot: discover providers, list
cable plans, and verify a customer/meter before you call `POST /pots`. The `:category` path segment is
`electricity` or `cable`; any other value returns **400 `unsupported biller category: <category>`**.

| Method | Path | Auth | Query params | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/bills/:category/providers` | Bearer | _none_ | `BillerOption[]` | 401; 400 bad category | `listElectricityDiscos()` ⚠️ |
| GET | `/bills/:category/plans` | Bearer | `cableTvType: string` (the provider code) | `BillerOption[]` | 401; 400 bad category / missing query | `listCableProducts(cableTvType)` ⚠️ |
| GET | `/bills/:category/lookup` | Bearer | electricity: `disco`, `customerId`, `meterType`; cable: `cableTvType`, `customerId` | `BillerCustomer` | 401; 400 bad category / validation | `lookupElectricityCustomer(q)` / `lookupCableCustomer(q)` |

Behaviour by category:

- **`/bills/electricity/providers`** → the list of discos (each `{ code, name }`).
- **`/bills/cable/providers`** → a fixed list: `dstv` (DStv), `gotv` (GOtv), `startimes` (StarTimes).
- **`/bills/cable/plans?cableTvType=<code>`** → the bouquets for that cable provider (each
  `{ code, name, amountKobo }`). The query param is named **`cableTvType`** but semantically it is the
  cable **provider code** (e.g. `dstv`).
- **`/bills/electricity/plans`** → electricity has no plans; this returns `[]` (an empty array) even
  though `cableTvType` is still required by validation. Electricity pricing is free-form, not plan-based.
- **`/bills/electricity/lookup?disco=<code>&customerId=<meter>&meterType=PREPAID`** → `{ customerName }`.
- **`/bills/cable/lookup?cableTvType=<code>&customerId=<smartcard>`** → `{ customerName }`.

`BillerOption` (providers and plans):

```ts
{
  code: string;
  name: string;
  amountKobo?: number;   // int; present for fixed-price plans (cable bouquets), omitted for discos
}
```

`BillerCustomer` (lookup):

```ts
{ customerName: string }
```

> ⚠️ **api-client path mismatch — flag for FE.** The typed client in `packages/api-client/src/client.ts`
> is **stale** for two of these:
> - `listElectricityDiscos()` calls `GET /bills/electricity/discos`, but the server route is
>   `GET /bills/electricity/providers`. (`/discos` does not exist.)
> - `listCableProducts(cableTvType)` calls `GET /bills/cable/products?...`, but the server route is
>   `GET /bills/cable/plans?...`. (`/products` does not exist.)
>
> `lookupElectricityCustomer` and `lookupCableCustomer` are correct. There is **no** client method for
> `GET /bills/cable/providers` or `GET /bills/electricity/plans`. Call the real paths above directly
> until the client is regenerated.

---

## pay

Tag `pay`. **Public — no auth.** This is the page a contributor lands on from a share link. It is keyed
by the split's opaque `payToken` (from `SplitDetail.payToken`) and deliberately exposes **no PII beyond
the organizer's display name and handle** — no phone, email, other participants, or amounts owed by
anyone else.

| Method | Path | Auth | Request | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/pay/:token` | none (`@Public`) | path `token: string` (min 1) | `PayView` | 404 `pay link not found` | `getPayerView(token)` |

> There is **no** `POST /pay/:token/execute` (or any other write) endpoint. Paying happens off-API via
> the hosted `checkoutUrl` returned in this view; the result flows back through the Nomba webhook.

`PayView`:

```ts
{
  potTitle: string;
  organizerName: string;        // organizer display name — the only identity exposed
  organizerHandle: string;      // organizer @handle
  splitLabel: string;           // this contributor's label, e.g. "Chidi"
  shareKobo: number;            // int — what this contributor owes
  paidKobo: number;             // int — what they've paid so far
  shareStatus: ShareStatus;     // "pending" | "partially_paid" | "paid" | "overpaid" | "expired" | "refunded"
  potStatus: PotStatus;
  progress: PotProgress;        // same shape as the pot's progress (overall collection)
  checkoutUrl: string | null;   // hosted checkout link to send the contributor to
}
```

Example response `200`:

```json
{
  "potTitle": "December NEPA bill",
  "organizerName": "Tunde A.",
  "organizerHandle": "tundea",
  "splitLabel": "Chidi",
  "shareKobo": 2500000,
  "paidKobo": 0,
  "shareStatus": "pending",
  "potStatus": "open",
  "progress": { "collectedKobo": 0, "targetKobo": 5000000, "paidCount": 0, "splitCount": 3 },
  "checkoutUrl": "https://checkout.nomba.com/pt_0Mh4…"
}
```

---

## webhooks

Tag `webhooks`. `@Public` at the route-guard level, gated by a provider HMAC signature.
**The frontend does not call this — it is provider → server.** Listed for completeness.

| Method | Path | Auth | Request body | Success response | Errors | api-client method |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/webhooks/nomba` | signature (`nomba-signature` + `nomba-timestamp` headers) | Nomba event payload (opaque) | `{ "received": true }` | 401 missing/invalid signature, signing key not configured, missing raw body; 400 `unidentifiable webhook` | _n/a_ |

**Signature model** (`NombaSignatureGuard`): the caller must send two headers — `nomba-signature` and
`nomba-timestamp`; either missing → 401. The guard recomputes the signature as
`HMAC-SHA256(signingString, NOMBA_WEBHOOK_SIGNING_KEY)` encoded as **base64**, then compares it to the
`nomba-signature` header case-insensitively. The `signingString` is **9 fields joined by `:`** in this
order:

```
event_type : requestId : data.merchant.userId : data.merchant.walletId
: data.transaction.transactionId : data.transaction.type : data.transaction.time
: responseCode : nomba-timestamp
```

Each missing field contributes an empty string; a literal `responseCode` of `"null"` is also treated as
empty. After a valid signature, the controller derives a provider event id
(`requestId ?? data.transaction.transactionId`); if neither is present it returns **400 `unidentifiable
webhook`**. Events are idempotent — a duplicate event id is accepted and returns `{ "received": true }`
without reprocessing.

---

## Typical flows

### 1. Create a bill-split pot and share it

1. (For a `bill_payment` pot) discover the biller:
   - `GET /bills/electricity/providers` → pick a disco `{ code }`, **or**
     `GET /bills/cable/providers` then `GET /bills/cable/plans?cableTvType=<code>` → pick a plan `{ code }`.
   - `GET /bills/<category>/lookup?…` → confirm `{ customerName }` for the meter/smartcard.
2. `POST /pots` with the `Idempotency-Key` header and the `createPotSchema` body (set `billerCategory`,
   `billerProductCode`, `billerCustomerId`, and `meterType` for electricity). Response is **201**
   `PotDetail` with `status: "open"` and a `payToken` + `checkoutUrl` per split.
3. For each `split`, share its pay link — `https://<frontend>/pay/<payToken>` — with that contributor.

### 2. Render a contributor's pay page

1. `GET /pay/:token` (public) → `PayView`. Show `organizerName`/`organizerHandle`, `splitLabel`,
   `shareKobo`, `shareStatus`, and overall `progress`.
2. Send the contributor to `checkoutUrl` to pay. Payment confirmation arrives server-side via
   `POST /webhooks/nomba`; the frontend re-fetches `GET /pay/:token` (or the organizer re-fetches
   `GET /pots/:id`) to see updated `paidKobo` / `status` / `progress`.

### 3. Track and manage a pot (organizer)

1. `GET /pots?status=open&limit=20` → paginate with `nextCursor`.
2. `GET /pots/:id` → full `PotDetail` incl. per-split progress.
3. While still `draft`/`open` with no payments: `PATCH /pots/:id` to edit title/description/deadline, or
   `DELETE /pots/:id` to remove it.
4. Otherwise `POST /pots/:id/cancel` to cancel an active pot.
