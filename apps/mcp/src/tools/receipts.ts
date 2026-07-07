import { z } from "zod";
import { ok } from "../result";
import type { ToolDef } from "./types";

export const receiptTools: ToolDef[] = [
  {
    name: "get_payment_receipt",
    title: "Get payment receipt",
    description: "Fetch the receipt for a contributor payment into a pot.",
    inputSchema: { id: z.string().uuid().describe("Payment id (UUID).") },
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "pots:read",
    handler: async ({ client }, args) => ok(await client.getPaymentReceipt(args.id as string)),
  },
  {
    name: "get_settlement_receipt",
    title: "Get settlement receipt",
    description: "Fetch the receipt for a pot settlement (bank payout, bill vend, or wallet credit).",
    inputSchema: { id: z.string().uuid().describe("Settlement id (UUID).") },
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "pots:read",
    handler: async ({ client }, args) => ok(await client.getSettlementReceipt(args.id as string)),
  },
];
