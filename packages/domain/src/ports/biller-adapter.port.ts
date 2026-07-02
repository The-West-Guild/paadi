import { BillerCustomer, BillerOption, BillPaymentResult } from "./payment-provider.port";

export type BillerCategory = "electricity" | "cable";

export interface BillerAdapter {
  readonly category: BillerCategory;
  listProviders(): Promise<BillerOption[]>;
  listPlans?(providerCode: string): Promise<BillerOption[]>;
  lookupCustomer(
    providerCode: string,
    customerId: string,
    meta?: Record<string, string>
  ): Promise<BillerCustomer>;
  vend(
    target: { providerCode: string; customerId: string; meta?: Record<string, string> },
    amountKobo: number,
    merchantTxRef: string
  ): Promise<BillPaymentResult>;
  requiredFields(): string[];
}
