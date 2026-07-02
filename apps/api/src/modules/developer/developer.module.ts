import { Module } from "@nestjs/common";
import { WebhookEndpointRepository } from "../../infra/persistence/webhook-endpoint.repository";
import { DeveloperController } from "./developer.controller";
import { DeveloperService } from "./developer.service";

@Module({
  controllers: [DeveloperController],
  providers: [DeveloperService, WebhookEndpointRepository],
  exports: [DeveloperService]
})
export class DeveloperModule {}
