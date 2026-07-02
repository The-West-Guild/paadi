import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { RedisBullModule } from "../../infra/redis/bull.module";
import { PersistenceModule } from "../../infra/persistence/persistence.module";
import { PrismaModule } from "../../infra/persistence/prisma.module";
import { PaymentIngestionRepository } from "../../infra/persistence/payment-ingestion.repository";
import { WithdrawalRepository } from "../../infra/persistence/withdrawal.repository";
import { NombaModule } from "../../integrations/nomba/nomba.module";
import { AuthModule } from "../auth/auth.module";
import { QUEUES } from "../../queue/queue.constants";
import { WalletController } from "./wallet.controller";
import { WalletSpendService } from "./wallet-spend.service";
import { WalletStatementService } from "./wallet-statement.service";
import { WithdrawService } from "./withdrawal.service";

@Module({
  imports: [
    PersistenceModule,
    PrismaModule,
    NombaModule,
    AuthModule,
    RedisBullModule,
    BullModule.registerQueue({ name: QUEUES.payoutConfirm })
  ],
  controllers: [WalletController],
  providers: [
    WalletStatementService,
    WalletSpendService,
    WithdrawService,
    PaymentIngestionRepository,
    WithdrawalRepository
  ],
  exports: [WalletStatementService, WalletSpendService, WithdrawService, WithdrawalRepository]
})
export class WalletModule {}
