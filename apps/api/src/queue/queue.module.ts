import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { RedisBullModule } from "../infra/redis/bull.module";
import { DEFAULT_JOB_OPTIONS, QUEUES } from "./queue.constants";

@Module({
  imports: [
    RedisBullModule,
    BullModule.registerQueue(
      { name: QUEUES.settlement },
      { name: QUEUES.payoutConfirm },
      { name: QUEUES.reconciliation, defaultJobOptions: DEFAULT_JOB_OPTIONS },
      { name: QUEUES.outbox, defaultJobOptions: DEFAULT_JOB_OPTIONS },
      { name: QUEUES.deadlineSweep },
      { name: QUEUES.nudge },
      { name: QUEUES.ingestion, defaultJobOptions: DEFAULT_JOB_OPTIONS }
    )
  ],
  exports: [BullModule]
})
export class QueueModule {}
