import {
  type CreatePotInput,
  createPotSchema,
  listPotsQuerySchema,
} from "@paadi/contracts";
import { z } from "zod";
import { mintIdempotencyKey } from "../idempotency";
import { ok } from "../result";
import { KOBO_HELP, type ToolDef } from "./types";

const idInput = { id: z.string().uuid().describe("Pot id (UUID).") };

const pagination = {
  cursor: z.string().optional().describe("Opaque cursor from a previous page's nextCursor."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Page size, 1-100."),
};

// createPotSchema is a ZodEffects (it uses superRefine for cross-field rules).
// Its flat field shape is what the tool advertises for JSON-Schema; the full
// schema (with the cross-field refinements) is re-run inside the handler.
const createPotShape = createPotSchema._def.schema.shape;
const createPotInputSchema = {
  ...createPotShape,
  totalKobo: createPotShape.totalKobo.describe(
    `Target total to collect. ${KOBO_HELP}`
  ),
};

export const potTools: ToolDef[] = [
  {
    name: "list_pots",
    title: "List pots",
    description:
      "List the caller's pots (shared bills), newest first. Optionally filter by status and paginate with cursor/limit.",
    inputSchema: {
      ...pagination,
      status: listPotsQuerySchema.shape.status,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "pots:read",
    handler: async ({ client }, args) => {
      const { cursor, limit, status } = args as {
        cursor?: string;
        limit?: number;
        status?: string;
      };
      return ok(await client.listPots({ cursor, limit, status }));
    },
  },
  {
    name: "get_pot",
    title: "Get pot",
    description:
      "Fetch a single pot with its splits, funding progress, and settlement state.",
    inputSchema: idInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "pots:read",
    handler: async ({ client }, args) => ok(await client.getPot(args.id as string)),
  },
  {
    name: "get_pot_activity",
    title: "Get pot activity",
    description: "List the activity feed for a single pot (payments, settlement events).",
    inputSchema: { ...idInput, ...pagination },
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "pots:read",
    handler: async ({ client }, args) => {
      const { id, cursor, limit } = args as {
        id: string;
        cursor?: string;
        limit?: number;
      };
      return ok(await client.getPotActivity(id, { cursor, limit }));
    },
  },
  {
    name: "get_pot_settlement",
    title: "Get pot settlement",
    description:
      "Fetch the settlement record for a pot. Settlement is asynchronous — poll this to watch status move to completed or failed.",
    inputSchema: idInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "pots:read",
    handler: async ({ client }, args) =>
      ok(await client.getPotSettlement(args.id as string)),
  },
  {
    name: "create_pot",
    title: "Create pot",
    description:
      "Create a pot — a shared bill split across contributors. Choose the settlement target (bank_payout, bill_payment, or wallet), the split mode, and the splits. All amounts are in kobo. Pass an optional clientRef to make retries safe.",
    inputSchema: {
      ...createPotInputSchema,
      clientRef: z
        .string()
        .optional()
        .describe(
          "Caller-supplied idempotency reference. Reuse the same value with identical arguments to retry safely."
        ),
    },
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    requiredScope: "pots:write",
    handler: async ({ client }, args) => {
      const { clientRef, ...rest } = args as { clientRef?: string } & Record<string, unknown>;
      // Re-run the full schema so the cross-field rules (split sums, biller
      // fields) are enforced, not just the flat field types.
      const input = createPotSchema.parse(rest) as CreatePotInput;
      const key = mintIdempotencyKey("create_pot", args, clientRef);
      return ok(await client.createPot(input, key));
    },
  },
  {
    name: "update_pot",
    title: "Update pot",
    description:
      "Update a pot's title, description, or deadline. At least one field must be provided.",
    inputSchema: {
      ...idInput,
      title: z.string().min(3).max(120).optional(),
      description: z.string().max(500).optional(),
      deadlineAt: z.string().datetime().optional().describe("ISO 8601 deadline."),
    },
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    requiredScope: "pots:write",
    handler: async ({ client }, args) => {
      const { id, ...input } = args as {
        id: string;
        title?: string;
        description?: string;
        deadlineAt?: string;
      };
      return ok(await client.updatePot(id, input));
    },
  },
  {
    name: "cancel_pot",
    title: "Cancel pot",
    description:
      "Cancel a pot. Contributors can no longer pay; already-collected funds are refunded per the pot's rules. This cannot be undone.",
    inputSchema: idInput,
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    requiredScope: "pots:write",
    handler: async ({ client }, args) => ok(await client.cancelPot(args.id as string)),
  },
  {
    name: "retry_pot_settlement",
    title: "Retry pot settlement",
    description:
      "Retry a failed settlement for a funded pot. Safe to call again — settlement is idempotent server-side.",
    inputSchema: idInput,
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    requiredScope: "pots:write",
    handler: async ({ client }, args) =>
      ok(await client.retryPotSettlement(args.id as string)),
  },
];
