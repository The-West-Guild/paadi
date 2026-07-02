import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../infra/persistence/persistence.module";
import { SettlementsRepository } from "../../infra/persistence/settlements.repository";
import { NombaModule } from "../../integrations/nomba/nomba.module";
import { QueueModule } from "../../queue/queue.module";
import { PotsModule } from "../pots/pots.module";
import { SettlementsController } from "./settlements.controller";
import { SettlementsService } from "./settlements.service";
import { BankPayoutStrategy } from "./strategies/bank-payout.strategy";
import { BillPaymentStrategy } from "./strategies/bill-payment.strategy";
import { WalletStrategy } from "./strategies/wallet.strategy";

@Module({
  imports: [NombaModule, PersistenceModule, QueueModule, PotsModule],
  controllers: [SettlementsController],
  providers: [
    SettlementsService,
    SettlementsRepository,
    BillPaymentStrategy,
    BankPayoutStrategy,
    WalletStrategy
  ],
  exports: [SettlementsService]
})
export class SettlementsModule {}
