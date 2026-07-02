import { Module } from "@nestjs/common";
import { KycModule } from "../modules/auth/kyc/kyc.module";
import { QueueModule } from "../queue/queue.module";
import { DojahSignatureGuard } from "./dojah-signature.guard";
import { NombaSignatureGuard } from "./nomba-signature.guard";
import { WebhooksController } from "./webhooks.controller";

@Module({
  imports: [QueueModule, KycModule],
  controllers: [WebhooksController],
  providers: [NombaSignatureGuard, DojahSignatureGuard]
})
export class WebhooksModule {}
