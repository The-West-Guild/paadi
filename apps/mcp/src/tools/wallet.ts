import type { PayFromWalletInput, WithdrawInput } from "@paadi/contracts";
import { z } from "zod";
import { dedupeInFlight, mintIdempotencyKey } from "../idempotency";
import { ok } from "../result";
import { KOBO_HELP, type ToolDef } from "./types";

const statement = {
  cursor: z.string().optional().describe("Opaque cursor from a previous page's nextCursor."),
  limit: z.number().int().min(1).max(100).optional().describe("Page size, 1-100."),
  direction: z.enum(["credit", "debit"]).optional(),
  from: z.string().datetime().optional().describe("ISO 8601 lower bound."),
  to: z.string().datetime().optional().describe("ISO 8601 upper bound."),
};

const clientRef = z
  .string()
  .optional()
  .describe(
    "Caller-supplied idempotency reference. Reuse the same value with identical arguments to retry safely; change it to intentionally repeat."
  );

export const walletTools: ToolDef[] = [
  {
    name: "get_wallet",
    title: "Get wallet",
    description: "Fetch the caller's wallet balance (in kobo).",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "wallet:read",
    handler: async ({ client }) => ok(await client.getWallet()),
  },
  {
    name: "get_wallet_transactions",
    title: "Get wallet transactions",
    description: "List wallet transactions (credits and debits), most recent first.",
    inputSchema: statement,
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "wallet:read",
    handler: async ({ client }, args) => ok(await client.getWalletTransactions(args)),
  },
  {
    name: "get_statement",
    title: "Get statement",
    description: "Fetch the caller's wallet statement over an optional date range.",
    inputSchema: statement,
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "wallet:read",
    handler: async ({ client }, args) => ok(await client.getStatement(args)),
  },
  {
    name: "get_withdrawal",
    title: "Get withdrawal",
    description:
      "Fetch a withdrawal by id. Withdrawals settle asynchronously — poll this to watch status move to completed or failed.",
    inputSchema: { id: z.string().uuid().describe("Withdrawal id (UUID).") },
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "wallet:read",
    handler: async ({ client }, args) => ok(await client.getWithdrawal(args.id as string)),
  },
  {
    name: "get_payout_accounts",
    title: "Get payout accounts",
    description: "List the caller's saved bank payout accounts.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "wallet:read",
    handler: async ({ client }) => ok(await client.getPayoutAccounts()),
  },
  {
    name: "list_banks",
    title: "List banks",
    description: "List supported banks (with codes) for building payout accounts.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "wallet:read",
    handler: async ({ client }) => ok(await client.getBanks()),
  },
  {
    name: "pay_split_from_wallet",
    title: "Pay a split from wallet",
    description:
      "Pay a pot split from the caller's wallet balance. Moves money. Omit amountKobo to pay the split's full outstanding share. Requires PAADI_PIN to be configured. Reuse clientRef to retry safely.",
    inputSchema: {
      potId: z.string().uuid().describe("Pot id (UUID)."),
      splitId: z.string().uuid().describe("Split id (UUID) within the pot."),
      amountKobo: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(`Optional partial amount. ${KOBO_HELP}`),
      clientRef,
    },
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    requiredScope: "wallet:pay",
    needsPin: true,
    handler: async ({ client, config }, args) => {
      const pin = config.pin;
      if (!pin) throw new Error("PAADI_PIN is not configured");
      const { potId, splitId, amountKobo, clientRef: ref } = args as {
        potId: string;
        splitId: string;
        amountKobo?: number;
        clientRef?: string;
      };
      const body: PayFromWalletInput = {
        potId,
        splitId,
        pin,
        ...(amountKobo !== undefined ? { amountKobo } : {}),
      };
      const key = mintIdempotencyKey("pay_split_from_wallet", args, ref);
      return ok(await dedupeInFlight(key, () => client.payFromWallet(body, key)));
    },
  },
  {
    name: "withdraw",
    title: "Withdraw to bank",
    description:
      "Withdraw wallet funds to a bank payout account. Moves money. Omit payoutAccountId to use the primary account. Requires PAADI_PIN to be configured. Reuse clientRef to retry safely.",
    inputSchema: {
      amountKobo: z
        .number()
        .int()
        .positive()
        .describe(`Amount to withdraw. ${KOBO_HELP}`),
      payoutAccountId: z
        .string()
        .uuid()
        .optional()
        .describe("Payout account id (UUID). Defaults to the primary account."),
      clientRef,
    },
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    requiredScope: "wallet:withdraw",
    needsPin: true,
    handler: async ({ client, config }, args) => {
      const pin = config.pin;
      if (!pin) throw new Error("PAADI_PIN is not configured");
      const { amountKobo, payoutAccountId, clientRef: ref } = args as {
        amountKobo: number;
        payoutAccountId?: string;
        clientRef?: string;
      };
      const body: WithdrawInput = {
        amountKobo,
        pin,
        ...(payoutAccountId !== undefined ? { payoutAccountId } : {}),
      };
      const key = mintIdempotencyKey("withdraw", args, ref);
      return ok(await dedupeInFlight(key, () => client.withdraw(body, key)));
    },
  },
];
