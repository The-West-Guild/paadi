import { Module } from "@nestjs/common";
import { DojahModule } from "../../../integrations/dojah/dojah.module";
import { PersistenceModule } from "../../../infra/persistence/persistence.module";
import { KycController } from "./kyc.controller";
import { KycService } from "./kyc.service";

@Module({
  imports: [DojahModule, PersistenceModule],
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService]
})
export class KycModule {}
