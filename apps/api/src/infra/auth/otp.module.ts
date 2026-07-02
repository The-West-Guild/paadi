import { Global, Module } from "@nestjs/common";
import { SendchampModule } from "../../integrations/sendchamp/sendchamp.module";
import { OtpService } from "./otp.service";

@Global()
@Module({
  imports: [SendchampModule],
  providers: [OtpService],
  exports: [OtpService]
})
export class OtpModule {}
