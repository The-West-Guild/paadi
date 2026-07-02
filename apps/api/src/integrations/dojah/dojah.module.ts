import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KycProvider } from "@paadi/domain";
import { DojahClient } from "./dojah.client";
import { DojahKycProvider } from "./dojah.provider";
import { MockKycProvider } from "./mock-kyc.provider";

@Module({
  providers: [
    DojahClient,
    {
      provide: KycProvider,
      useFactory: (config: ConfigService, client: DojahClient) => {
        if (config.get<string>("dojah.driver") === "dojah") {
          return new DojahKycProvider(client);
        }
        if (config.get<string>("nodeEnv") === "production") {
          throw new Error("DOJAH_DRIVER=dojah is required in production");
        }
        return new MockKycProvider();
      },
      inject: [ConfigService, DojahClient]
    }
  ],
  exports: [KycProvider]
})
export class DojahModule {}
