import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import { ExceptionReason } from "@paadi/contracts";
import { PrismaService } from "@paadi/db";
import { NombaWebhookBody } from "../webhooks/nomba-webhook.types";
import { mapVirtualAccountCredit } from "../modules/payments/virtual-account-credit.mapper";
import { RaiseExceptionService } from "../modules/reconciliation/raise-exception.service";
import { QUEUES } from "../queue/queue.constants";

const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const SWEEP_LIMIT = 100;
const ADOPTION_BATCH = 100;
const HANDLED_TRANSACTION_TYPES = new Set(["online_checkout", "vact_transfer"]);

@Processor(QUEUES.reconciliation)
export class ReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly raiseException: RaiseExceptionService,
    @InjectQueue(QUEUES.ingestion) private readonly ingestion: Queue
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    void job;
    await this.reenqueueStuckIngestions();
    await this.adoptHouseSuspenseOrphans();
  }

  private async reenqueueStuckIngestions(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const stuck = await this.prisma.webhookEventIn.findMany({
      where: { provider: "nomba", processedAt: null, createdAt: { lt: cutoff } },
      take: SWEEP_LIMIT,
      select: { id: true }
    });
    for (const event of stuck) {
      await this.ingestion.add("ingest", { webhookEventInId: event.id });
    }
    if (stuck.length > 0) {
      this.logger.warn(`re-enqueued ${stuck.length} stuck ingestion events`);
    }
  }

  private async adoptHouseSuspenseOrphans(): Promise<void> {
    const candidates = await this.prisma.webhookEventIn.findMany({
      where: { provider: "nomba", processedAt: { not: null } },
      orderBy: { createdAt: "desc" },
      take: ADOPTION_BATCH,
      select: { id: true, payload: true }
    });

    let adopted = 0;
    for (const candidate of candidates) {
      const orphan = this.toHouseSuspenseOrphan(candidate.payload);
      if (!orphan) {
        continue;
      }
      if (await this.alreadyMaterialized(orphan.nombaTransactionId)) {
        continue;
      }
      await this.raiseException.raiseException({
        nombaTransactionId: orphan.nombaTransactionId,
        amountKobo: orphan.amountKobo,
        reason: ExceptionReason.UnknownAccount,
        senderName: orphan.senderName ?? undefined,
        senderAccount: orphan.senderAccount ?? undefined,
        senderBank: orphan.senderBank ?? undefined,
        vaAccountNumber: orphan.vaAccountNumber ?? undefined,
        suspenseOwnerRef: "house"
      });
      adopted += 1;
    }

    if (adopted > 0) {
      this.logger.warn(`adopted ${adopted} house-suspense orphans into reconciliation exceptions`);
    }
  }

  private toHouseSuspenseOrphan(payload: unknown): {
    nombaTransactionId: string;
    amountKobo: number;
    senderName: string | null;
    senderAccount: string | null;
    senderBank: string | null;
    vaAccountNumber: string | null;
  } | null {
    const body = (payload ?? {}) as NombaWebhookBody;
    const transactionType = (body.data?.transaction?.type ?? "").toLowerCase();
    if (HANDLED_TRANSACTION_TYPES.has(transactionType)) {
      return null;
    }
    const mapped = mapVirtualAccountCredit(body);
    if (!mapped.transactionId || mapped.amountKobo <= 0) {
      return null;
    }
    return {
      nombaTransactionId: mapped.transactionId,
      amountKobo: mapped.amountKobo,
      senderName: mapped.senderName,
      senderAccount: mapped.senderAccount,
      senderBank: mapped.senderBank,
      vaAccountNumber: mapped.aliasAccountNumber
    };
  }

  private async alreadyMaterialized(nombaTransactionId: string): Promise<boolean> {
    const [exception, payment, walletCredit] = await Promise.all([
      this.prisma.reconciliationException.findUnique({
        where: { nombaTransactionId },
        select: { id: true }
      }),
      this.prisma.payment.findUnique({ where: { nombaTransactionId }, select: { id: true } }),
      this.prisma.walletCredit.findUnique({ where: { nombaTransactionId }, select: { id: true } })
    ]);
    return exception !== null || payment !== null || walletCredit !== null;
  }
}
