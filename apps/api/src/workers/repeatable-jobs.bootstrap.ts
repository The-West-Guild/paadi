import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Queue } from "bullmq";
import {
  DEADLINE_SWEEP_EVERY_MS,
  DEADLINE_SWEEP_SCHEDULER_ID,
  NUDGE_CREATED_DELAY_SCHEDULER_ID,
  NUDGE_DEADLINE_WINDOW_SCHEDULER_ID,
  NUDGE_SWEEP_EVERY_MS,
  OUTBOX_DRAIN_EVERY_MS,
  OUTBOX_DRAIN_SCHEDULER_ID,
  QUEUES,
  RECONCILIATION_SWEEP_EVERY_MS,
  RECONCILIATION_SWEEP_SCHEDULER_ID,
  WEBHOOK_RETRY_SWEEP_EVERY_MS,
  WEBHOOK_RETRY_SWEEP_SCHEDULER_ID,
} from "../queue/queue.constants";

@Injectable()
export class RepeatableJobsBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(RepeatableJobsBootstrap.name);

  constructor(
    @InjectQueue(QUEUES.outbox) private readonly outbox: Queue,
    @InjectQueue(QUEUES.reconciliation) private readonly reconciliation: Queue,
    @InjectQueue(QUEUES.deadlineSweep) private readonly deadlineSweep: Queue,
    @InjectQueue(QUEUES.nudge) private readonly nudge: Queue,
    @InjectQueue(QUEUES.webhookRetry) private readonly webhookRetry: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.outbox.upsertJobScheduler(
      OUTBOX_DRAIN_SCHEDULER_ID,
      { every: OUTBOX_DRAIN_EVERY_MS },
      { name: "drain" },
    );
    await this.reconciliation.upsertJobScheduler(
      RECONCILIATION_SWEEP_SCHEDULER_ID,
      { every: RECONCILIATION_SWEEP_EVERY_MS },
      { name: "sweep" },
    );
    await this.deadlineSweep.upsertJobScheduler(
      DEADLINE_SWEEP_SCHEDULER_ID,
      { every: DEADLINE_SWEEP_EVERY_MS },
      { name: "sweep" },
    );
    await this.nudge.upsertJobScheduler(
      NUDGE_CREATED_DELAY_SCHEDULER_ID,
      { every: NUDGE_SWEEP_EVERY_MS },
      { name: "created-delay" },
    );
    await this.nudge.upsertJobScheduler(
      NUDGE_DEADLINE_WINDOW_SCHEDULER_ID,
      { every: NUDGE_SWEEP_EVERY_MS },
      { name: "deadline-window" },
    );
    await this.webhookRetry.upsertJobScheduler(
      WEBHOOK_RETRY_SWEEP_SCHEDULER_ID,
      { every: WEBHOOK_RETRY_SWEEP_EVERY_MS },
      { name: "sweep" },
    );
    this.logger.log(
      "registered outbox drain, reconciliation sweep, deadline sweep, nudge sweep, and webhook retry schedulers",
    );
  }
}
