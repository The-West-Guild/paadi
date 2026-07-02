import { Injectable } from "@nestjs/common";
import {
  BeginSettlementResult,
  SettlementsRepository
} from "../../../infra/persistence/settlements.repository";
import { SettleResult, SettlementStrategy } from "../settlements.service";

@Injectable()
export class WalletStrategy implements SettlementStrategy {
  constructor(private readonly settlements: SettlementsRepository) {}

  async dispatch(begin: BeginSettlementResult): Promise<SettleResult> {
    const { context } = begin;
    const finalized = await this.settlements.finalizeSettlement(context.potId, {
      kind: "settled",
      netKobo: context.collectedKobo - context.feeKobo,
      feeKobo: context.feeKobo,
      vendToken: null,
      vendUnits: null,
      nombaRef: null,
      providerStatus: null
    });
    return { settlementId: finalized.settlementId, status: "settled" };
  }
}
