import { Injectable } from "@nestjs/common";
import {
  BillerAdapter,
  BillerCategory,
  BillerCustomer,
  BillerOption,
  BillPaymentResult,
  MeterType,
  PaymentProviderPort
} from "@paadi/domain";

@Injectable()
export class ElectricityBillerAdapter implements BillerAdapter {
  readonly category: BillerCategory = "electricity";

  constructor(private readonly port: PaymentProviderPort) {}

  listProviders(): Promise<BillerOption[]> {
    return this.port.listElectricityDiscos();
  }

  lookupCustomer(
    providerCode: string,
    customerId: string,
    meta?: Record<string, string>
  ): Promise<BillerCustomer> {
    return this.port.lookupElectricityCustomer(providerCode, customerId, this.meterTypeOf(meta));
  }

  vend(
    target: { providerCode: string; customerId: string; meta?: Record<string, string> },
    amountKobo: number,
    merchantTxRef: string
  ): Promise<BillPaymentResult> {
    return this.port.payElectricity(
      target.providerCode,
      target.customerId,
      this.meterTypeOf(target.meta),
      amountKobo,
      merchantTxRef,
      target.meta?.payerName ?? ""
    );
  }

  requiredFields(): string[] {
    return ["meterType"];
  }

  private meterTypeOf(meta?: Record<string, string>): MeterType {
    return meta?.meterType === "POSTPAID" ? "POSTPAID" : "PREPAID";
  }
}
