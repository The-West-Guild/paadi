import { Injectable } from "@nestjs/common";
import {
  PrismaService,
  WebhookEndpoint,
  WebhookEndpointStatus as DbWebhookEndpointStatus
} from "@paadi/db";
import { CryptoService } from "../../common/crypto/crypto.service";

const SECRET_BYTES = 32;

export interface RegisterWebhookEndpointInput {
  userId: string;
  url: string;
  events: string[];
  description?: string;
}

export interface RegisteredWebhookEndpoint {
  endpoint: WebhookEndpoint;
  secret: string;
}

@Injectable()
export class WebhookEndpointRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService
  ) {}

  async register(input: RegisterWebhookEndpointInput): Promise<RegisteredWebhookEndpoint> {
    const secret = this.crypto.randomToken(SECRET_BYTES);
    const secretHash = await this.crypto.hashSecret(secret);
    const secretEnc = this.crypto.encryptAccountNumber(secret);
    const endpoint = await this.prisma.$transaction((tx) =>
      tx.webhookEndpoint.create({
        data: {
          userId: input.userId,
          url: input.url,
          events: input.events,
          description: input.description,
          secretHash,
          secretEnc,
          status: DbWebhookEndpointStatus.ACTIVE
        }
      })
    );
    return { endpoint, secret };
  }

  listForUser(userId: string): Promise<WebhookEndpoint[]> {
    return this.prisma.webhookEndpoint.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });
  }

  findById(id: string): Promise<WebhookEndpoint | null> {
    return this.prisma.webhookEndpoint.findUnique({ where: { id } });
  }

  findActiveForEvent(userId: string, eventType: string): Promise<WebhookEndpoint[]> {
    return this.prisma.webhookEndpoint.findMany({
      where: {
        userId,
        status: DbWebhookEndpointStatus.ACTIVE,
        events: { has: eventType }
      }
    });
  }

  revealSecret(endpoint: WebhookEndpoint): string {
    return this.crypto.decryptAccountNumber(endpoint.secretEnc);
  }

  async rotateSecret(id: string): Promise<RegisteredWebhookEndpoint> {
    const secret = this.crypto.randomToken(SECRET_BYTES);
    const secretHash = await this.crypto.hashSecret(secret);
    const secretEnc = this.crypto.encryptAccountNumber(secret);
    const endpoint = await this.prisma.$transaction((tx) =>
      tx.webhookEndpoint.update({
        where: { id },
        data: { secretHash, secretEnc }
      })
    );
    return { endpoint, secret };
  }

  disable(id: string): Promise<WebhookEndpoint> {
    return this.prisma.webhookEndpoint.update({
      where: { id },
      data: { status: DbWebhookEndpointStatus.DISABLED }
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.webhookDelivery.deleteMany({ where: { endpointId: id } });
      await tx.webhookEventOut.updateMany({
        where: { endpointId: id },
        data: { endpointId: null }
      });
      await tx.webhookEndpoint.delete({ where: { id } });
    });
  }
}
