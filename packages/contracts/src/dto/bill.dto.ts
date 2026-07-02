import { z } from "zod";

export const billerOptionSchema = z.object({
  code: z.string(),
  name: z.string(),
  amountKobo: z.number().int().optional()
});

export const billerOptionListSchema = z.array(billerOptionSchema);

export const billerCustomerSchema = z.object({ customerName: z.string() });

export const electricityLookupQuerySchema = z.object({
  disco: z.string().min(1),
  customerId: z.string().min(1),
  meterType: z.enum(["PREPAID", "POSTPAID"])
});

export const cableProductsQuerySchema = z.object({
  cableTvType: z.string().min(1)
});

export const cableLookupQuerySchema = z.object({
  cableTvType: z.string().min(1),
  customerId: z.string().min(1)
});

export type BillerOption = z.infer<typeof billerOptionSchema>;
export type BillerOptionList = z.infer<typeof billerOptionListSchema>;
export type BillerCustomer = z.infer<typeof billerCustomerSchema>;
export type ElectricityLookupQuery = z.infer<
  typeof electricityLookupQuerySchema
>;
export type CableProductsQuery = z.infer<typeof cableProductsQuerySchema>;
export type CableLookupQuery = z.infer<typeof cableLookupQuerySchema>;
