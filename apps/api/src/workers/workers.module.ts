import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { RedisBullModule } from "../infra/redis/bull.module";
import { PersistenceModule } from "../infra/persistence/persistence.module";
import { NombaModule } from "../integrations/nomba/nomba.module";
import { PaymentIngestionRepository } from "../infra/persistence/payment-ingestion.repository";
import { WalletCreditRepository } from "../infra/persistence/wallet-credit.repository";
import { VirtualAccountRepository } from "../infra/persistence/virtual-account.repository";
import { SettlementsRepository } from "../infra/persistence/settlements.repository";
import { WithdrawalRepository } from "../infra/persistence/withdrawal.repository";
import { NudgeRepository } from "../infra/persistence/nudge.repository";
import { SettlementsModule } from "../modules/settlements/settlements.module";
import { RefundsModule } from "../modules/refunds/refunds.module";
import { NudgesModule } from "../modules/nudges/nudges.module";
import { VirtualAccountsModule } from "../modules/virtual-accounts/virtual-accounts.module";
import { PushModule } from "../integrations/push/push.module";
import { TwilioModule } from "../integrations/twilio/twilio.module";
import { NombaWebhookRouter } from "../modules/payments/nomba-webhook.router";
import { CheckoutPaymentHandler } from "../modules/payments/checkout-payment.handler";
import { VirtualAccountCreditHandler } from "../modules/payments/virtual-account-credit.handler";
import { RecordContributionService } from "../modules/payments/record-contribution.service";
import { RaiseExceptionService } from "../modules/reconciliation/raise-exception.service";
import { WalletService } from "../modules/wallet/wallet.service";
import { WebhookEndpointRepository } from "../infra/persistence/webhook-endpoint.repository";
import { WebhookDeliveryService } from "../modules/developer/webhook-delivery.service";
import { HttpWebhookDeliveryAdapter } from "../integrations/http/http-webhook-delivery.adapter";
import { WebhookDeliveryPort } from "@paadi/domain";
import { DEFAULT_JOB_OPTIONS, QUEUES } from "../queue/queue.constants";
import { SettlementProcessor } from "./settlement.processor";
import { PayoutConfirmProcessor } from "./payout-confirm.processor";
import { ReconciliationProcessor } from "./reconciliation.processor";
import { OutboxProcessor } from "./outbox.processor";
import { DeadlineSweepProcessor } from "./deadline-sweep.processor";
import { NudgeProcessor } from "./nudge.processor";
import { PaymentIngestionProcessor } from "./payment-ingestion.processor";
import { VirtualAccountProvisioningProcessor } from "./virtual-account-provisioning.processor";
import { WebhookRetryProcessor } from "./webhook-retry.processor";
import { RepeatableJobsBootstrap } from "./repeatable-jobs.bootstrap";

@Module({
  imports: [
    RedisBullModule,
    PersistenceModule,
    NombaModule,
    SettlementsModule,
    RefundsModule,
    NudgesModule,
    VirtualAccountsModule,
    PushModule,
    TwilioModule,
    BullModule.registerQueue(
      { name: QUEUES.settlement },
      { name: QUEUES.payoutConfirm },
      { name: QUEUES.reconciliation, defaultJobOptions: DEFAULT_JOB_OPTIONS },
      { name: QUEUES.outbox, defaultJobOptions: DEFAULT_JOB_OPTIONS },
      { name: QUEUES.deadlineSweep },
      { name: QUEUES.nudge },
      { name: QUEUES.ingestion, defaultJobOptions: DEFAULT_JOB_OPTIONS },
      { name: QUEUES.vaProvisioning, defaultJobOptions: DEFAULT_JOB_OPTIONS },
      { name: QUEUES.webhookRetry, defaultJobOptions: DEFAULT_JOB_OPTIONS },
    ),
  ],
  providers: [
    SettlementProcessor,
    PayoutConfirmProcessor,
    ReconciliationProcessor,
    OutboxProcessor,
    DeadlineSweepProcessor,
    NudgeProcessor,
    PaymentIngestionProcessor,
    VirtualAccountProvisioningProcessor,
    WebhookRetryProcessor,
    PaymentIngestionRepository,
    WalletCreditRepository,
    VirtualAccountRepository,
    SettlementsRepository,
    WithdrawalRepository,
    NudgeRepository,
    NombaWebhookRouter,
    CheckoutPaymentHandler,
    VirtualAccountCreditHandler,
    RecordContributionService,
    RaiseExceptionService,
    WalletService,
    WebhookEndpointRepository,
    WebhookDeliveryService,
    { provide: WebhookDeliveryPort, useClass: HttpWebhookDeliveryAdapter },
    RepeatableJobsBootstrap,
  ],
})
export class WorkersModule {}
