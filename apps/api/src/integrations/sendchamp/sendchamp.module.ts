import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OtpProvider } from "@paadi/domain";
import { ConsoleOtpProvider } from "./console-otp.provider";
import { SendchampClient } from "./sendchamp.client";
import { SendchampOtpProvider } from "./sendchamp.provider";

@Module({
  providers: [
    SendchampClient,
    {
      provide: OtpProvider,
      useFactory: (config: ConfigService, client: SendchampClient) => {
        if (config.get<string>("sendchamp.driver") === "sendchamp") {
          return new SendchampOtpProvider(client);
        }
        if (config.get<string>("nodeEnv") === "production") {
          throw new Error("SENDCHAMP_DRIVER=sendchamp is required in production");
        }
        return new ConsoleOtpProvider();
      },
      inject: [ConfigService, SendchampClient]
    }
  ],
  exports: [OtpProvider]
})
export class SendchampModule {}
