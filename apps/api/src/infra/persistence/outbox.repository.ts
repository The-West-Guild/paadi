import { Injectable } from "@nestjs/common";
import { OutboxMessage, OutboxRepository } from "@paadi/domain";
import { PaadiEvent } from "@paadi/contracts";
import { Prisma, PrismaService } from "@paadi/db";

const MAX_DELIVERY_ATTEMPTS = 10;

@Injectable()
export class PrismaOutboxRepository extends OutboxRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async enqueue(message: OutboxMessage, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.webhookEventOut.create({
      data: {
        target: message.target,
        eventType: message.event.type,
        payload: message.event as unknown as Prisma.InputJsonValue,
        status: message.status ?? "pending",
        attempts: message.attempts,
        nextAttemptAt: message.nextAttemptAt ? new Date(message.nextAttemptAt) : null
      }
    });
  }

  async pending(limit: number): Promise<OutboxMessage[]> {
    const now = new Date();
    const rows = await this.prisma.webhookEventOut.findMany({
      where: {
        status: "pending",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
      },
      orderBy: { createdAt: "asc" },
      take: limit
    });
    return rows.map((row) => ({
      id: row.id,
      target: row.target,
      event: row.payload as unknown as PaadiEvent,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt ? row.nextAttemptAt.toISOString() : undefined,
      status: row.status as OutboxMessage["status"]
    }));
  }

  async markDispatched(id: string): Promise<void> {
    await this.prisma.webhookEventOut.update({
      where: { id },
      data: { status: "dispatched" }
    });
  }

  async markFailed(id: string, nextAttemptAt: string): Promise<void> {
    const updated = await this.prisma.webhookEventOut.update({
      where: { id },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(nextAttemptAt) }
    });
    if (updated.attempts >= MAX_DELIVERY_ATTEMPTS) {
      await this.prisma.webhookEventOut.update({
        where: { id },
        data: { status: "failed" }
      });
    }
  }
}
