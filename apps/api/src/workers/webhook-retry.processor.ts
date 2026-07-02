import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { WebhookDeliveryService } from "../modules/developer/webhook-delivery.service";
import { QUEUES } from "../queue/queue.constants";

@Processor(QUEUES.webhookRetry)
export class WebhookRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookRetryProcessor.name);

  constructor(private readonly webhookDelivery: WebhookDeliveryService) {
    super();
  }

  async process(job: Job): Promise<void> {
    void job;
    const redriven = await this.webhookDelivery.redrivePending(new Date());
    if (redriven > 0) {
      this.logger.warn(`redrove ${redriven} failed webhook deliveries`);
    }
  }
}
