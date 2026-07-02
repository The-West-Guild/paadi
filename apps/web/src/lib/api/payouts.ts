import { ApiError } from "./error";

/**
 * Contract for the "payout" tag. Bearer-authenticated. Two of these
 * calls (create, delete) require `pin` in the body — the backend
 * re-verifies the PIN as part of the same request, there's no separate
 * "verify then act" step like security/page.tsx's PIN change flow.
 * That means the error UI for these needs to handle "401 invalid pin"
 * directly on the create/delete mutation itself, not via a pre-check.
 */

export type Bank = { code: string; name: string };
export type BanksResponse = { banks: Bank[] };

export type PayoutAccount = {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumberLast4: string;
  accountName: string;
  nameMatchVerified: boolean;
  isPrimary: boolean;
};
export type PayoutAccountsResponse = { accounts: PayoutAccount[] };

export type LookupPayoutAccountRequest = {
  bankCode: string;
  accountNumber: string; // /^\d{10}$/
};
export type LookupPayoutAccountResponse = { accountName: string };

export type CreatePayoutAccountRequest = {
  bankCode: string;
  accountNumber: string;
  pin: string; // /^\d{4}$/ — re-verified server-side on this exact call
};

export type DeletePayoutAccountRequest = { pin: string };

export type PayoutApi = {
  listBanks: () => Promise<BanksResponse>;
  listPayoutAccounts: () => Promise<PayoutAccountsResponse>;
  lookupPayoutAccount: (
    req: LookupPayoutAccountRequest
  ) => Promise<LookupPayoutAccountResponse>;
  createPayoutAccount: (req: CreatePayoutAccountRequest) => Promise<PayoutAccount>;
  setPrimaryPayoutAccount: (id: string) => Promise<{ ok: true }>;
  deletePayoutAccount: (
    id: string,
    req: DeletePayoutAccountRequest
  ) => Promise<{ ok: true }>;
};

// ---- fixture implementation ----
// TEMPORARY — delete once @paadi/api-client ships a real PayoutApi.

const FAKE_LATENCY_MS = 500;
function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), FAKE_LATENCY_MS));
}

// Small, realistic-looking subset — Nomba's real bank list is much longer,
// this is just enough to build and test the picker UI against.
const FAKE_BANKS: Bank[] = [
  { code: "044", name: "Access Bank" },
  { code: "058", name: "GTBank" },
  { code: "057", name: "Zenith Bank" },
  { code: "033", name: "UBA" },
  { code: "070", name: "Fidelity Bank" },
  { code: "999991", name: "Opay" },
  { code: "999992", name: "PalmPay" },
];

// same fixed test PIN used in lib/api/me.ts — keep these in sync while
// both are fixtures; a real account obviously has exactly one true PIN
const FAKE_CURRENT_PIN = "0000";

let fakeAccounts: PayoutAccount[] = [];

export const fixturePayoutApi: PayoutApi = {
  async listBanks() {
    return delay({ banks: FAKE_BANKS });
  },

  async listPayoutAccounts() {
    return delay({ accounts: fakeAccounts });
  },

  async lookupPayoutAccount({ bankCode, accountNumber }) {
    if (!/^\d{10}$/.test(accountNumber)) {
      throw new ApiError({
        message: "Validation failed",
        issues: [{ path: "accountNumber", message: "must be exactly 10 digits" }],
      });
    }
    const bank = FAKE_BANKS.find((b) => b.code === bankCode);
    if (!bank) {
      throw new ApiError({
        message: "Validation failed",
        issues: [{ path: "bankCode", message: "unknown bank" }],
      });
    }
    // fake a plausible-looking resolved account name
    return delay({ accountName: "ADEBAYO TUNDE O." });
  },

  async createPayoutAccount({ bankCode, accountNumber, pin }) {
    if (pin !== FAKE_CURRENT_PIN) {
      throw new ApiError({ statusCode: 401, message: "invalid pin" });
    }
    const bank = FAKE_BANKS.find((b) => b.code === bankCode);
    if (!bank) {
      throw new ApiError({
        message: "Validation failed",
        issues: [{ path: "bankCode", message: "unknown bank" }],
      });
    }
    const account: PayoutAccount = {
      id: `payout_${Math.random().toString(36).slice(2)}`,
      bankCode,
      bankName: bank.name,
      accountNumberLast4: accountNumber.slice(-4),
      accountName: "ADEBAYO TUNDE O.",
      nameMatchVerified: true,
      // first account created becomes primary automatically, per the doc
      isPrimary: fakeAccounts.length === 0,
    };
    fakeAccounts = [...fakeAccounts, account];
    return delay(account);
  },

  async setPrimaryPayoutAccount(id) {
    const exists = fakeAccounts.some((a) => a.id === id);
    if (!exists) {
      throw new ApiError({ statusCode: 404, message: "payout account not found" });
    }
    fakeAccounts = fakeAccounts.map((a) => ({ ...a, isPrimary: a.id === id }));
    return delay({ ok: true as const });
  },

  async deletePayoutAccount(id, { pin }) {
    if (pin !== FAKE_CURRENT_PIN) {
      throw new ApiError({ statusCode: 401, message: "invalid pin" });
    }
    const exists = fakeAccounts.some((a) => a.id === id);
    if (!exists) {
      throw new ApiError({ statusCode: 404, message: "payout account not found" });
    }
    fakeAccounts = fakeAccounts.filter((a) => a.id !== id);
    return delay({ ok: true as const });
  },
};