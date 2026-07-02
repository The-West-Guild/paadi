import { Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { QUEUES } from "../queue/queue.constants";
import { NudgesService } from "../modules/nudges/nudges.service";

@Processor(QUEUES.nudge)
export class NudgeProcessor extends WorkerHost {
  private readonly logger = new Logger(NudgeProcessor.name);

  constructor(
    private readonly nudges: NudgesService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(
    job: Job<{ kind: "created-delay" | "deadline-window" }>,
  ): Promise<void> {
    if (job.data.kind === "created-delay") {
      const n = await this.nudges.sweepCreatedDelay(
        this.config.get<number>("nudges.createdDelayMs")!,
      );
      if (n > 0) this.logger.log(`nudged ${n} pots (created-delay)`);
      return;
    }
    const n = await this.nudges.sweepDeadlineWindow(
      this.config.get<number>("nudges.deadlineWindowMs")!,
    );
    if (n > 0) this.logger.log(`nudged ${n} pots (deadline-window)`);
  }
}
