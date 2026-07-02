import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fixturePayoutApi } from "@/lib/api/payouts";

/**
 * Sibling to profile-hooks.ts and notifications-hooks.ts — split by domain.
 * Backed by lib/api/payout.ts.
 *
 * createPayoutAccount and deletePayoutAccount both take a `pin` and the
 * backend re-verifies it on that exact call — unlike security/page.tsx's
 * flow, there's no separate "verify, then act" step here. Screens built
 * on useCreatePayoutAccount / useDeletePayoutAccount need to read
 * error.statusCode === 401 directly off THESE mutations to show "wrong
 * PIN," not borrow useVerifyPin from profile-hooks.ts.
 */
const payoutApi = fixturePayoutApi;

export function useBanks() {
  return useQuery({
    queryKey: ["settings", "banks"],
    queryFn: () => payoutApi.listBanks(),
    staleTime: Infinity, // bank list essentially never changes mid-session
  });
}

export function usePayoutAccounts() {
  return useQuery({
    queryKey: ["settings", "payout-accounts"],
    queryFn: () => payoutApi.listPayoutAccounts(),
  });
}

// Step 1 of "add account" — confirm the account name before committing.
// A useMutation rather than useQuery on purpose: this fires once per
// explicit "look this up" tap, not automatically as someone types a
// 10-digit account number.
export function useLookupPayoutAccount() {
  return useMutation({
    mutationFn: (req: { bankCode: string; accountNumber: string }) =>
      payoutApi.lookupPayoutAccount(req),
  });
}

// Step 2 — the actual commit. Needs `pin` re-verified by the user at
// this exact step; see file header re: 401 handling.
export function useCreatePayoutAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: { bankCode: string; accountNumber: string; pin: string }) =>
      payoutApi.createPayoutAccount(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "payout-accounts"] });
    },
  });
}

export function useSetPrimaryPayoutAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => payoutApi.setPrimaryPayoutAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "payout-accounts"] });
    },
  });
}

export function useDeletePayoutAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) =>
      payoutApi.deletePayoutAccount(id, { pin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "payout-accounts"] });
    },
  });
}