import { Module } from "@nestjs/common";
import { TwilioClient } from "./twilio.client";

@Module({
  providers: [TwilioClient],
  exports: [TwilioClient],
})
export class TwilioModule {}