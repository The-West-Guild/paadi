import { Module } from "@nestjs/common";
import { PushModule } from "../../integrations/push/push.module";
import { PersistenceModule } from "../../infra/persistence/persistence.module";
import { TwilioModule } from "../../integrations/twilio/twilio.module";
import { NudgeRepository } from "../../infra/persistence/nudge.repository";
import { NudgesService } from "./nudges.service";

@Module({
  imports: [PersistenceModule, PushModule, TwilioModule],
  providers: [NudgeRepository, NudgesService],
  exports: [NudgesService],
})
export class NudgesModule {}
