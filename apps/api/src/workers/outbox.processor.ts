import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import { OutboxMessage, OutboxRepository, nextBackoffAt } from "@paadi/domain";
import { PaadiEvent } from "@paadi/contracts";
import { WebhookEndpoint } from "@paadi/db";
import { RefundsService } from "../modules/refunds/refunds.service";
import { WebhookEndpointRepository } from "../infra/persistence/webhook-endpoint.repository";
import { WebhookDeliveryService } from "../modules/developer/webhook-delivery.service";
import { QUEUES } from "../queue/queue.constants";
import { SettlementJob, VaProvisioningJob } from "../queue/jobs/job.types";

const DRAIN_LIMIT = 50;
const EXPIRED_REFUND_REASON = "pool_expired";

@Processor(QUEUES.outbox)
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly refunds: RefundsService,
    private readonly webhookEndpoints: WebhookEndpointRepository,
    private readonly webhookDelivery: WebhookDeliveryService,
    @InjectQueue(QUEUES.settlement) private readonly settlement: Queue,
    @InjectQueue(QUEUES.vaProvisioning) private readonly vaProvisioning: Queue
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    void job;
    const messages = await this.outbox.pending(DRAIN_LIMIT);
    for (const message of messages) {
      try {
        await this.dispatch(message);
        await this.outbox.markDispatched(message.id);
      } catch (error) {
        this.logger.error(`failed to dispatch outbox event ${message.id}`, error as Error);
        await this.outbox.markFailed(
          message.id,
          nextBackoffAt(message.attempts, new Date()).toISOString()
        );
      }
      await this.fanOutToEndpoints(message);
    }
  }

  private async dispatch(message: OutboxMessage): Promise<void> {
    const event = message.event;
    if (event.type === "pool.funded") {
      const data: SettlementJob = { potId: event.potId };
      await this.settlement.add("settle", data);
      return;
    }
    if (event.type === "pool.expired") {
      await this.refunds.refundPot(event.potId, EXPIRED_REFUND_REASON);
      return;
    }
    if (event.type === "kyc.verified") {
      const data: VaProvisioningJob = { kind: "provision", userId: event.userId };
      await this.vaProvisioning.add("provision", data);
      return;
    }
    if (event.type === "profile.name_changed") {
      const data: VaProvisioningJob = { kind: "rename", userId: event.userId };
      await this.vaProvisioning.add("rename", data);
      return;
    }
    this.logger.log(`dispatching ${event.type} to ${message.target}`);
  }

  private async fanOutToEndpoints(message: OutboxMessage): Promise<void> {
    const event = message.event;
    const ownerUserId = this.ownerOf(event);
    if (!ownerUserId) {
      return;
    }
    let endpoints: WebhookEndpoint[];
    try {
      endpoints = await this.webhookEndpoints.findActiveForEvent(ownerUserId, event.type);
    } catch (error) {
      this.logger.error(`failed to resolve webhook endpoints for ${message.id}`, error as Error);
      return;
    }
    if (endpoints.length === 0) {
      return;
    }
    const task = { eventId: message.id, event, createdAt: new Date().toISOString() };
    for (const endpoint of endpoints) {
      try {
        await this.webhookDelivery.deliver(task, endpoint);
      } catch (error) {
        this.logger.error(`failed to deliver webhook for ${message.id} to ${endpoint.id}`, error as Error);
      }
    }
  }

  private ownerOf(event: PaadiEvent): string | null {
    return "userId" in event && typeof event.userId === "string" ? event.userId : null;
  }
}
