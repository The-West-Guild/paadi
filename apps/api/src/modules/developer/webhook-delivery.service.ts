import { Inject, Injectable, Logger } from "@nestjs/common";
import { PaadiEvent } from "@paadi/contracts";
import {
  OutboundDeliveryPayload,
  WebhookDeliveryPort,
  nextBackoffAt,
  signPayload
} from "@paadi/domain";
import {
  Prisma,
  PrismaService,
  WebhookDelivery,
  WebhookDeliveryStatus as DbWebhookDeliveryStatus,
  WebhookEndpoint
} from "@paadi/db";
import { WebhookEndpointRepository } from "../../infra/persistence/webhook-endpoint.repository";

const MAX_DELIVERY_ATTEMPTS = 10;
const REDRIVE_BATCH = 100;

export interface WebhookDeliveryTask {
  eventId: string;
  event: PaadiEvent;
  createdAt: string;
}

interface StoredDeliveryPayload {
  event: PaadiEvent;
  createdAt: string;
}

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly endpoints: WebhookEndpointRepository,
    @Inject(WebhookDeliveryPort) private readonly transport: WebhookDeliveryPort
  ) {}

  async deliver(task: WebhookDeliveryTask, endpoint: WebhookEndpoint): Promise<WebhookDelivery> {
    const delivery = await this.claim(task, endpoint.id);
    if (delivery.status === DbWebhookDeliveryStatus.DELIVERED) {
      return delivery;
    }
    if (delivery.status === DbWebhookDeliveryStatus.DEAD) {
      return delivery;
    }
    return this.send(delivery, task, endpoint);
  }

  async redrivePending(now: Date): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: {
        status: DbWebhookDeliveryStatus.FAILED,
        attempts: { lt: MAX_DELIVERY_ATTEMPTS },
        nextAttemptAt: { not: null, lte: now }
      },
      orderBy: { nextAttemptAt: "asc" },
      take: REDRIVE_BATCH
    });

    let redriven = 0;
    for (const delivery of due) {
      try {
        await this.redriveOne(delivery);
        redriven += 1;
      } catch (error) {
        this.logger.error(`failed to redrive webhook delivery ${delivery.id}`, error as Error);
      }
    }
    return redriven;
  }

  private async redriveOne(delivery: WebhookDelivery): Promise<void> {
    const endpoint = await this.endpoints.findById(delivery.endpointId);
    if (!endpoint) {
      return;
    }
    const stored = this.parseStoredPayload(delivery.payload);
    if (!stored) {
      this.logger.warn(`webhook delivery ${delivery.id} has no replayable payload; skipping redrive`);
      return;
    }
    const task: WebhookDeliveryTask = {
      eventId: delivery.eventId,
      event: stored.event,
      createdAt: stored.createdAt
    };
    await this.send(delivery, task, endpoint);
  }

  private async send(
    delivery: WebhookDelivery,
    task: WebhookDeliveryTask,
    endpoint: WebhookEndpoint
  ): Promise<WebhookDelivery> {
    const payload: OutboundDeliveryPayload = {
      id: task.eventId,
      type: task.event.type,
      createdAt: task.createdAt,
      data: task.event as unknown as Record<string, unknown>
    };
    const timestamp = new Date().toISOString();
    const secret = this.endpoints.revealSecret(endpoint);
    const signature = signPayload(secret, payload, timestamp);
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "paadi-signature": signature,
      "paadi-timestamp": timestamp,
      "paadi-event-type": payload.type,
      "paadi-delivery-id": payload.id
    };

    try {
      const result = await this.transport.deliver(endpoint.url, headers, body);
      if (result.ok) {
        return this.markDelivered(delivery.id, result.statusCode);
      }
      return this.markFailed(delivery.id, delivery.attempts, result.statusCode, null);
    } catch (error) {
      this.logger.error(`failed to deliver webhook ${delivery.id}`, error as Error);
      return this.markFailed(delivery.id, delivery.attempts, null, this.describe(error));
    }
  }

  private async claim(task: WebhookDeliveryTask, endpointId: string): Promise<WebhookDelivery> {
    const existing = await this.prisma.webhookDelivery.findFirst({
      where: { endpointId, eventId: task.eventId }
    });
    if (existing) {
      return existing;
    }
    return this.prisma.webhookDelivery.create({
      data: {
        endpointId,
        eventId: task.eventId,
        eventType: task.event.type,
        payload: this.toStoredPayload(task),
        status: DbWebhookDeliveryStatus.PENDING
      }
    });
  }

  private toStoredPayload(task: WebhookDeliveryTask): Prisma.InputJsonValue {
    const stored: StoredDeliveryPayload = { event: task.event, createdAt: task.createdAt };
    return stored as unknown as Prisma.InputJsonValue;
  }

  private parseStoredPayload(payload: WebhookDelivery["payload"]): StoredDeliveryPayload | null {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const record = payload as Record<string, unknown>;
    const event = record.event;
    const createdAt = record.createdAt;
    if (!event || typeof event !== "object" || typeof createdAt !== "string") {
      return null;
    }
    return { event: event as unknown as PaadiEvent, createdAt };
  }

  private markDelivered(id: string, statusCode: number): Promise<WebhookDelivery> {
    return this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: DbWebhookDeliveryStatus.DELIVERED,
        attempts: { increment: 1 },
        nextAttemptAt: null,
        lastResponseCode: statusCode,
        lastError: null
      }
    });
  }

  private markFailed(
    id: string,
    attempts: number,
    statusCode: number | null,
    error: string | null
  ): Promise<WebhookDelivery> {
    const nextAttempts = attempts + 1;
    const dead = nextAttempts >= MAX_DELIVERY_ATTEMPTS;
    return this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: dead ? DbWebhookDeliveryStatus.DEAD : DbWebhookDeliveryStatus.FAILED,
        attempts: { increment: 1 },
        nextAttemptAt: dead ? null : nextBackoffAt(nextAttempts, new Date()),
        lastResponseCode: statusCode,
        lastError: error
      }
    });
  }

  private describe(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return "delivery failed";
  }
}
