import { z } from "zod";
import { ok } from "../result";
import type { ToolDef } from "./types";

export const activityTools: ToolDef[] = [
  {
    name: "get_activity",
    title: "Get activity feed",
    description:
      "List the caller's account-wide activity feed across all pots and the wallet, over an optional date range.",
    inputSchema: {
      cursor: z.string().optional().describe("Opaque cursor from a previous page's nextCursor."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size, 1-100."),
      from: z.string().datetime().optional().describe("ISO 8601 lower bound."),
      to: z.string().datetime().optional().describe("ISO 8601 upper bound."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "activity:read",
    handler: async ({ client }, args) => ok(await client.getActivity(args)),
  },
];
