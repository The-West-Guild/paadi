import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import { SettlementType } from "@paadi/contracts";
import { PrismaService } from "@paadi/db";
import { SettlementsService } from "../modules/settlements/settlements.service";
import { QUEUES } from "../queue/queue.constants";
import { PayoutConfirmJob, SettlementJob } from "../queue/jobs/job.types";

@Processor(QUEUES.settlement)
export class SettlementProcessor extends WorkerHost {
  private readonly logger = new Logger(SettlementProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementsService,
    @InjectQueue(QUEUES.payoutConfirm) private readonly payoutConfirm: Queue
  ) {
    super();
  }

  async process(job: Job<SettlementJob>): Promise<void> {
    const { potId } = job.data;
    const pot = await this.prisma.pot.findUnique({
      where: { id: potId },
      select: { settlementType: true }
    });
    if (!pot) {
      this.logger.warn(`settlement job for unknown pot ${potId}`);
      return;
    }

    const type = pot.settlementType.toLowerCase() as SettlementType;
    const result = await this.settlements.settle(potId, type);
    this.logger.log(`settlement for pot ${potId} resolved as ${result.status}`);

    if (result.status === "awaiting_confirmation") {
      const data: PayoutConfirmJob = { settlementId: result.settlementId };
      await this.payoutConfirm.add("confirm", data);
    }
  }
}
