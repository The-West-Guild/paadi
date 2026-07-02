import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { PoolState } from "@paadi/contracts";
import { OutboxMessage, OutboxRepository, assertPoolTransition } from "@paadi/domain";
import {
  CompletionRule as DbCompletionRule,
  PotStatus as DbPotStatus,
  Prisma,
  PrismaService
} from "@paadi/db";
import { PrismaOutboxRepository } from "../infra/persistence/outbox.repository";
import { QUEUES } from "../queue/queue.constants";

const SWEEP_LIMIT = 100;
const OUTBOX_TARGET = "organizer";

@Processor(QUEUES.deadlineSweep)
export class DeadlineSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(DeadlineSweepProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OutboxRepository) private readonly outbox: PrismaOutboxRepository
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    void job;
    const due = await this.prisma.pot.findMany({
      where: { status: DbPotStatus.OPEN, deadlineAt: { not: null, lte: new Date() } },
      take: SWEEP_LIMIT,
      select: { id: true }
    });

    for (const pot of due) {
      try {
        await this.sweepOne(pot.id);
      } catch (error) {
        this.logger.error(`deadline sweep failed for pot ${pot.id}`, error as Error);
      }
    }
  }

  private async sweepOne(potId: string): Promise<void> {
    await this.prisma.$transaction((tx) => this.closeDuePot(tx, potId));
  }

  private async closeDuePot(tx: Prisma.TransactionClient, potId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Pot" WHERE id = ${potId} FOR UPDATE`;
    const pot = await tx.pot.findUniqueOrThrow({ where: { id: potId } });
    if (pot.status !== DbPotStatus.OPEN) {
      return;
    }

    const progressive = pot.completionRule === DbCompletionRule.PROGRESSIVE;
    const collected = pot.collectedKobo > 0n;

    if (progressive && collected) {
      assertPoolTransition(PoolState.Open, PoolState.Funded);
      await tx.pot.update({ where: { id: potId }, data: { status: DbPotStatus.FUNDED } });
      await this.outbox.enqueue(this.poolFunded(potId), tx);
      return;
    }

    assertPoolTransition(PoolState.Open, PoolState.Expired);
    await tx.pot.update({ where: { id: potId }, data: { status: DbPotStatus.EXPIRED } });
    await this.outbox.enqueue(this.poolExpired(potId), tx);
  }

  private poolFunded(potId: string): OutboxMessage {
    return { id: randomUUID(), target: OUTBOX_TARGET, event: { type: "pool.funded", potId }, attempts: 0 };
  }

  private poolExpired(potId: string): OutboxMessage {
    return { id: randomUUID(), target: OUTBOX_TARGET, event: { type: "pool.expired", potId }, attempts: 0 };
  }
}
