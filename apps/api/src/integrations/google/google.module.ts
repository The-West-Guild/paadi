import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleVerifier } from "@paadi/domain";
import { GoogleRealVerifier } from "./google.client";
import { MockGoogleVerifier } from "./mock-google.verifier";

@Module({
  providers: [
    {
      provide: GoogleVerifier,
      useFactory: (config: ConfigService) => {
        if (config.get<string>("google.driver") === "google") {
          return new GoogleRealVerifier(config);
        }
        if (config.get<string>("nodeEnv") === "production") {
          throw new Error("GOOGLE_DRIVER=google is required in production");
        }
        return new MockGoogleVerifier();
      },
      inject: [ConfigService]
    }
  ],
  exports: [GoogleVerifier]
})
export class GoogleModule {}
