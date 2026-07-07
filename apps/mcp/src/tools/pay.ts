import { z } from "zod";
import { ok } from "../result";
import type { ToolDef } from "./types";

export const payTools: ToolDef[] = [
  {
    name: "get_payer_view",
    title: "Get payer view",
    description:
      "Fetch the public payer view for a split's pay token — what a contributor sees at their checkout link (amount owed, organizer, checkout URL). Public: needs no scope.",
    inputSchema: {
      token: z.string().min(1).describe("The split's pay token (from a split's payToken / checkout link)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async ({ client }, args) => ok(await client.getPayerView(args.token as string)),
  },
];
