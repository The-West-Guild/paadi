import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  RegisterWebhookEndpointInput,
  WebhookDeliveriesResponse,
  WebhookDeliveryDto,
  WebhookEndpointCreatedDto,
  WebhookEndpointDto,
  WebhookEndpointsResponse
} from "@paadi/contracts";
import { PrismaService, WebhookDelivery, WebhookEndpoint } from "@paadi/db";
import { WebhookEndpointRepository } from "../../infra/persistence/webhook-endpoint.repository";

const RECENT_DELIVERIES_LIMIT = 50;

@Injectable()
export class DeveloperService {
  constructor(
    private readonly endpoints: WebhookEndpointRepository,
    private readonly prisma: PrismaService
  ) {}

  async register(
    userId: string,
    input: RegisterWebhookEndpointInput
  ): Promise<WebhookEndpointCreatedDto> {
    const { endpoint, secret } = await this.endpoints.register({
      userId,
      url: input.url,
      events: input.events,
      description: input.description
    });
    return { ...this.toEndpointDto(endpoint), secret };
  }

  async list(userId: string): Promise<WebhookEndpointsResponse> {
    const rows = await this.endpoints.listForUser(userId);
    return { endpoints: rows.map((row) => this.toEndpointDto(row)) };
  }

  async remove(userId: string, id: string): Promise<WebhookEndpointDto> {
    const endpoint = await this.ownedEndpoint(userId, id);
    const disabled = await this.endpoints.disable(endpoint.id);
    return this.toEndpointDto(disabled);
  }

  async deliveries(userId: string, id: string): Promise<WebhookDeliveriesResponse> {
    const endpoint = await this.ownedEndpoint(userId, id);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
      orderBy: { createdAt: "desc" },
      take: RECENT_DELIVERIES_LIMIT
    });
    return { deliveries: rows.map((row) => this.toDeliveryDto(row)) };
  }

  private async ownedEndpoint(userId: string, id: string): Promise<WebhookEndpoint> {
    const endpoint = await this.endpoints.findById(id);
    if (!endpoint || endpoint.userId !== userId) {
      throw new NotFoundException("webhook endpoint not found");
    }
    return endpoint;
  }

  private toEndpointDto(endpoint: WebhookEndpoint): WebhookEndpointDto {
    return {
      id: endpoint.id,
      url: endpoint.url,
      events: endpoint.events,
      description: endpoint.description,
      status: endpoint.status,
      createdAt: endpoint.createdAt.toISOString(),
      updatedAt: endpoint.updatedAt.toISOString()
    };
  }

  private toDeliveryDto(delivery: WebhookDelivery): WebhookDeliveryDto {
    return {
      id: delivery.id,
      endpointId: delivery.endpointId,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      status: delivery.status,
      attempts: delivery.attempts,
      nextAttemptAt: delivery.nextAttemptAt ? delivery.nextAttemptAt.toISOString() : null,
      lastResponseCode: delivery.lastResponseCode,
      lastError: delivery.lastError,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString()
    };
  }
}
