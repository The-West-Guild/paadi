import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PaymentProviderPort } from "@paadi/domain";
import { BillerRegistry } from "./biller.registry";
import { CableBillerAdapter } from "./cable-biller.adapter";
import { ElectricityBillerAdapter } from "./electricity-biller.adapter";
import { MockNombaProvider } from "./mock-nomba.provider";
import { NombaClient } from "./nomba.client";
import { NombaProvider } from "./nomba.provider";

export function createNombaProvider(config: ConfigService, client: NombaClient): PaymentProviderPort {
  if (config.get<string>("nomba.driver") === "nomba") {
    return new NombaProvider(client);
  }
  if (config.get<string>("nodeEnv") === "production") {
    throw new Error("NOMBA_DRIVER=nomba is required in production");
  }
  return new MockNombaProvider();
}

@Module({
  providers: [
    NombaClient,
    { provide: PaymentProviderPort, useFactory: createNombaProvider, inject: [ConfigService, NombaClient] },
    ElectricityBillerAdapter,
    CableBillerAdapter,
    BillerRegistry
  ],
  exports: [PaymentProviderPort, NombaClient, BillerRegistry]
})
export class NombaModule {}
