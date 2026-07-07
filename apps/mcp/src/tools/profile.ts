import { ok } from "../result";
import type { ToolDef } from "./types";

export const profileTools: ToolDef[] = [
  {
    name: "get_me",
    title: "Get profile",
    description: "Fetch the authenticated account's profile (identity, KYC tier, handle).",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "profile:read",
    handler: async ({ client }) => ok(await client.getMe()),
  },
];
