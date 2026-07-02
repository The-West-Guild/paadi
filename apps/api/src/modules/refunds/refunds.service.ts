import { Inject, Injectable, Logger } from "@nestjs/common";
import { PaymentProviderPort } from "@paadi/domain";
import { RefundTarget, RefundsRepository } from "../../infra/persistence/refunds.repository";

export interface RefundPotResult {
  potId: string;
  attempted: number;
  refunded: number;
  failed: number;
}

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly refunds: RefundsRepository,
    @Inject(PaymentProviderPort) private readonly provider: PaymentProviderPort
  ) {}

  async refundPot(potId: string, reason: string): Promise<RefundPotResult> {
    const { targets } = await this.refunds.beginRefund(potId);
    let refunded = 0;
    let failed = 0;

    for (const target of targets) {
      const ok = await this.refundOne(potId, reason, target);
      if (ok) {
        refunded += 1;
      } else {
        failed += 1;
      }
    }

    return { potId, attempted: targets.length, refunded, failed };
  }

  private async refundOne(potId: string, reason: string, target: RefundTarget): Promise<boolean> {
    try {
      const result = await this.provider.refundTransaction({
        transactionId: target.nombaTransactionId,
        amountKobo: target.amountKobo
      });
      if (!result.success) {
        await this.refunds.recordRefundFailed(target.refundId, "provider_declined");
        this.logger.warn(`refund declined potId=${potId} refundId=${target.refundId} reason=${reason}`);
        return false;
      }
      await this.refunds.recordRefundCleared({
        potId,
        refundId: target.refundId,
        nombaRef: result.nombaRef ?? null
      });
      return true;
    } catch (error) {
      await this.refunds.recordRefundFailed(target.refundId, "gateway");
      this.logger.error(
        `refund failed potId=${potId} refundId=${target.refundId}: ${(error as Error).message}`
      );
      return false;
    }
  }
}
