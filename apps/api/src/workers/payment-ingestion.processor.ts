import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "@paadi/db";
import { QUEUES } from "../queue/queue.constants";
import { NombaWebhookBody } from "../webhooks/nomba-webhook.types";
import { NombaWebhookRouter } from "../modules/payments/nomba-webhook.router";

interface IngestionJobData {
  webhookEventInId: string;
}

@Processor(QUEUES.ingestion)
export class PaymentIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentIngestionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: NombaWebhookRouter
  ) {
    super();
  }

  async process(job: Job<IngestionJobData>): Promise<void> {
    const { webhookEventInId } = job.data;
    const event = await this.prisma.webhookEventIn.findUnique({ where: { id: webhookEventInId } });
    if (!event) {
      this.logger.warn(`webhook event ${webhookEventInId} not found`);
      return;
    }
    if (event.processedAt !== null) {
      return;
    }
    const body = event.payload as unknown as NombaWebhookBody;
    await this.router.route({ id: event.id }, body);
  }
}
