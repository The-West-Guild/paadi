import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import { SettlementFailureReason } from "@paadi/contracts";
import { PaymentProviderPort } from "@paadi/domain";
import { WithdrawalStatus as DbWithdrawalStatus } from "@paadi/db";
import { SettlementsRepository } from "../infra/persistence/settlements.repository";
import { WithdrawalRepository } from "../infra/persistence/withdrawal.repository";
import { QUEUES } from "../queue/queue.constants";
import { PayoutConfirmJob } from "../queue/jobs/job.types";

const MAX_CONFIRM_ATTEMPTS = 12;
const CONFIRM_BACKOFF_MS = 30_000;
const CONFIRM_JOB_NAME = "confirm";

type ConfirmTarget = "settlement" | "withdrawal";

interface NormalizedConfirmJob {
  kind: ConfirmTarget;
  id: string;
  attempt: number;
}

@Processor(QUEUES.payoutConfirm)
export class PayoutConfirmProcessor extends WorkerHost {
  private readonly logger = new Logger(PayoutConfirmProcessor.name);

  constructor(
    private readonly settlements: SettlementsRepository,
    private readonly withdrawals: WithdrawalRepository,
    @Inject(PaymentProviderPort) private readonly provider: PaymentProviderPort,
    @InjectQueue(QUEUES.payoutConfirm) private readonly queue: Queue
  ) {
    super();
  }

  async process(job: Job<PayoutConfirmJob>): Promise<void> {
    const normalized = this.normalize(job.data);
    if (normalized.kind === "withdrawal") {
      await this.processWithdrawal(normalized);
      return;
    }
    await this.processSettlement(normalized);
  }

  private async processSettlement(job: NormalizedConfirmJob): Promise<void> {
    const settlement = await this.settlements.findSettlementForConfirm(job.id);
    if (!settlement || settlement.status !== "PROCESSING") {
      return;
    }

    const requeryRef = settlement.nombaRef ?? settlement.merchantTxRef;
    const status = await this.provider.verifyTransactionById(requeryRef);

    if (status.success) {
      await this.settlements.confirmPayout(job.id);
      this.logger.log(`payout ${job.id} confirmed settled`);
      return;
    }

    if (status.status === "FAILED" || status.status === "DECLINED") {
      await this.settlements.reversePayout(job.id);
      this.logger.warn(`payout ${job.id} declined; reversed to funded`);
      return;
    }

    await this.reschedule("settlement", job);
  }

  private async processWithdrawal(job: NormalizedConfirmJob): Promise<void> {
    const withdrawal = await this.withdrawals.findForConfirm(job.id);
    if (!withdrawal || withdrawal.status !== DbWithdrawalStatus.PROCESSING) {
      return;
    }

    const requeryRef = withdrawal.nombaRef ?? withdrawal.merchantTxRef;
    const status = await this.provider.verifyTransactionById(requeryRef);

    if (status.success) {
      await this.withdrawals.confirmWithdrawal(job.id, {
        nombaRef: withdrawal.nombaRef,
        providerStatus: "SUCCESS"
      });
      this.logger.log(`withdrawal ${job.id} confirmed completed`);
      return;
    }

    if (status.status === "FAILED" || status.status === "DECLINED") {
      await this.withdrawals.reverseWithdrawal(job.id, SettlementFailureReason.ProviderDeclined);
      this.logger.warn(`withdrawal ${job.id} declined; reversed to wallet`);
      return;
    }

    await this.reschedule("withdrawal", job);
  }

  private async reschedule(kind: ConfirmTarget, job: NormalizedConfirmJob): Promise<void> {
    if (job.attempt + 1 >= MAX_CONFIRM_ATTEMPTS) {
      this.logger.error(
        `${kind} ${job.id} still pending after ${job.attempt + 1} attempts; holding for ops`
      );
      return;
    }
    const next: PayoutConfirmJob = { kind, id: job.id, attempt: job.attempt + 1 };
    await this.queue.add(CONFIRM_JOB_NAME, next, { delay: CONFIRM_BACKOFF_MS });
  }

  private normalize(data: PayoutConfirmJob): NormalizedConfirmJob {
    const attempt = data.attempt ?? 0;
    if ("kind" in data) {
      return { kind: data.kind, id: data.id, attempt };
    }
    return { kind: "settlement", id: data.settlementId, attempt };
  }
}
