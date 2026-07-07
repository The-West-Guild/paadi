import { z } from "zod";
import { ok } from "../result";
import type { ToolDef } from "./types";

export const billTools: ToolDef[] = [
  {
    name: "list_electricity_providers",
    title: "List electricity providers",
    description: "List electricity disco providers available for bill_payment pots.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "bills:read",
    handler: async ({ client }) => ok(await client.listElectricityProviders()),
  },
  {
    name: "lookup_electricity_customer",
    title: "Look up electricity customer",
    description:
      "Resolve the customer name for an electricity meter before creating a bill_payment pot.",
    inputSchema: {
      disco: z.string().min(1).describe("Disco provider code (from list_electricity_providers)."),
      customerId: z.string().min(1).describe("Meter or account number."),
      meterType: z.enum(["PREPAID", "POSTPAID"]),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "bills:read",
    handler: async ({ client }, args) => {
      const { disco, customerId, meterType } = args as {
        disco: string;
        customerId: string;
        meterType: string;
      };
      return ok(await client.lookupElectricityCustomer({ disco, customerId, meterType }));
    },
  },
  {
    name: "list_cable_providers",
    title: "List cable providers",
    description: "List cable TV providers (DStv, GOtv, StarTimes).",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "bills:read",
    handler: async ({ client }) => ok(await client.listCableProviders()),
  },
  {
    name: "list_cable_plans",
    title: "List cable plans",
    description: "List the plans (bouquets) offered by a cable TV provider.",
    inputSchema: {
      cableTvType: z.string().min(1).describe("Cable provider code (from list_cable_providers)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "bills:read",
    handler: async ({ client }, args) =>
      ok(await client.listCablePlans(args.cableTvType as string)),
  },
  {
    name: "lookup_cable_customer",
    title: "Look up cable customer",
    description:
      "Resolve the customer name for a cable TV smartcard before creating a bill_payment pot.",
    inputSchema: {
      cableTvType: z.string().min(1).describe("Cable provider code (from list_cable_providers)."),
      customerId: z.string().min(1).describe("Smartcard or account number."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    requiredScope: "bills:read",
    handler: async ({ client }, args) => {
      const { cableTvType, customerId } = args as {
        cableTvType: string;
        customerId: string;
      };
      return ok(await client.lookupCableCustomer({ cableTvType, customerId }));
    },
  },
];
