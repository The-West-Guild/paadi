import { Injectable, Logger } from "@nestjs/common";
import { BillerCategory, SettlementFailureReason } from "@paadi/contracts";
import { BillPaymentResult } from "@paadi/domain";
import {
  BeginSettlementResult,
  SettlementsRepository
} from "../../../infra/persistence/settlements.repository";
import { BillerRegistry } from "../../../integrations/nomba/biller.registry";
import { SettleResult, SettlementStrategy } from "../settlements.service";

@Injectable()
export class BillPaymentStrategy implements SettlementStrategy {
  private readonly logger = new Logger(BillPaymentStrategy.name);

  constructor(
    private readonly settlements: SettlementsRepository,
    private readonly billers: BillerRegistry
  ) {}

  async dispatch(begin: BeginSettlementResult): Promise<SettleResult> {
    const { context, merchantTxRef, settlementId } = begin;
    const category = context.billerCategory;
    if (category === null) {
      return this.fail(context.potId, settlementId, SettlementFailureReason.BillerFieldsMissing);
    }

    const adapter = this.billers.get(this.toDomainCategory(category));
    const missing = adapter.requiredFields().some((field) => context.billerMeta[field] === undefined);
    if (
      missing ||
      context.billerProductCode === null ||
      context.billerCustomerId === null
    ) {
      return this.fail(context.potId, settlementId, SettlementFailureReason.BillerFieldsMissing);
    }

    let result: BillPaymentResult;
    try {
      result = await adapter.vend(
        {
          providerCode: context.billerProductCode,
          customerId: context.billerCustomerId,
          meta: context.billerMeta
        },
        context.collectedKobo - context.feeKobo,
        merchantTxRef
      );
    } catch (error) {
      this.logger.error(`bill vend failed for pot ${context.potId}`, error as Error);
      await this.settlements.failSettlement(context.potId, SettlementFailureReason.Gateway);
      throw error;
    }

    const finalized = await this.settlements.finalizeSettlement(context.potId, {
      kind: "settled",
      netKobo: context.collectedKobo - context.feeKobo,
      feeKobo: context.feeKobo,
      vendToken: result.vendToken.length > 0 ? result.vendToken : null,
      vendUnits: result.units ?? null,
      nombaRef: null,
      providerStatus: null
    });
    return { settlementId: finalized.settlementId, status: "settled" };
  }

  private async fail(
    potId: string,
    settlementId: string,
    reason: SettlementFailureReason
  ): Promise<SettleResult> {
    await this.settlements.failSettlement(potId, reason);
    this.logger.warn(`bill settlement ${settlementId} failed: ${reason}`);
    return { settlementId, status: "noop" };
  }

  private toDomainCategory(category: BillerCategory): "electricity" | "cable" {
    return category === BillerCategory.Cable ? "cable" : "electricity";
  }
}
