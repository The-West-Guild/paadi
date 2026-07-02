import { Injectable } from "@nestjs/common";
import { SettlementType } from "@paadi/contracts";
import {
  BeginSettlementResult,
  SettlementsRepository
} from "../../infra/persistence/settlements.repository";
import { BankPayoutStrategy } from "./strategies/bank-payout.strategy";
import { BillPaymentStrategy } from "./strategies/bill-payment.strategy";
import { WalletStrategy } from "./strategies/wallet.strategy";

export interface SettleResult {
  settlementId: string;
  status: "noop" | "settled" | "awaiting_confirmation";
}

export interface SettlementStrategy {
  dispatch(begin: BeginSettlementResult): Promise<SettleResult>;
}

@Injectable()
export class SettlementsService {
  constructor(
    private readonly settlements: SettlementsRepository,
    private readonly billPayment: BillPaymentStrategy,
    private readonly bankPayout: BankPayoutStrategy,
    private readonly wallet: WalletStrategy
  ) {}

  async settle(potId: string, type: SettlementType): Promise<SettleResult> {
    const begin = await this.settlements.beginSettlement(potId);
    if (begin.alreadyTerminal) {
      return { settlementId: begin.settlementId, status: "noop" };
    }
    return this.strategyFor(type).dispatch(begin);
  }

  private strategyFor(type: SettlementType): SettlementStrategy {
    if (type === SettlementType.BillPayment) {
      return this.billPayment;
    }
    if (type === SettlementType.BankPayout) {
      return this.bankPayout;
    }
    return this.wallet;
  }
}
