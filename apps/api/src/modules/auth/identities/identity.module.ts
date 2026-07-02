import { Module } from "@nestjs/common";
import { GoogleModule } from "../../../integrations/google/google.module";
import { GoogleIdentityController } from "./google-identity.controller";
import { GoogleIdentityService } from "./google-identity.service";

@Module({
  imports: [GoogleModule],
  controllers: [GoogleIdentityController],
  providers: [GoogleIdentityService]
})
export class IdentityModule {}
