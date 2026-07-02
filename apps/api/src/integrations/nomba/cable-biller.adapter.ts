import { Injectable } from "@nestjs/common";
import {
  BillerAdapter,
  BillerCategory,
  BillerCustomer,
  BillerOption,
  BillPaymentResult,
  PaymentProviderPort
} from "@paadi/domain";

const CABLE_PROVIDERS: BillerOption[] = [
  { code: "dstv", name: "DStv" },
  { code: "gotv", name: "GOtv" },
  { code: "startimes", name: "StarTimes" }
];

@Injectable()
export class CableBillerAdapter implements BillerAdapter {
  readonly category: BillerCategory = "cable";

  constructor(private readonly port: PaymentProviderPort) {}

  async listProviders(): Promise<BillerOption[]> {
    return CABLE_PROVIDERS;
  }

  listPlans(providerCode: string): Promise<BillerOption[]> {
    return this.port.listCableProducts(providerCode);
  }

  lookupCustomer(providerCode: string, customerId: string): Promise<BillerCustomer> {
    return this.port.lookupCableCustomer(providerCode, customerId);
  }

  async vend(
    target: { providerCode: string; customerId: string; meta?: Record<string, string> },
    amountKobo: number,
    merchantTxRef: string
  ): Promise<BillPaymentResult> {
    await this.port.payCable(
      target.providerCode,
      target.customerId,
      amountKobo,
      merchantTxRef,
      target.meta?.payerName ?? ""
    );
    return { vendToken: "" };
  }

  requiredFields(): string[] {
    return [];
  }
}
