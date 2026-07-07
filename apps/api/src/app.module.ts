import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtGuard } from "./common/guards/jwt.guard";
import { RateLimitGuard } from "./common/guards/rate-limit.guard";
import { ScopesGuard } from "./common/guards/scopes.guard";
import { CoreModule } from "./core/core.module";
import { AuditModule } from "./infra/audit/audit.module";
import { CryptoModule } from "./common/crypto/crypto.module";
import { RedisModule } from "./infra/redis/redis.module";
import { PrismaModule } from "./infra/persistence/prisma.module";
import { PersistenceModule } from "./infra/persistence/persistence.module";
import { AuthPersistenceModule } from "./infra/persistence/auth-persistence.module";
import { TokenModule } from "./infra/auth/token.module";
import { OtpModule } from "./infra/auth/otp.module";
import { SendchampModule } from "./integrations/sendchamp/sendchamp.module";
import { DojahModule } from "./integrations/dojah/dojah.module";
import { NombaModule } from "./integrations/nomba/nomba.module";
import { QueueModule } from "./queue/queue.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { PotsModule } from "./modules/pots/pots.module";
import { BillsModule } from "./modules/bills/bills.module";
import { SettlementsModule } from "./modules/settlements/settlements.module";
import { RefundsModule } from "./modules/refunds/refunds.module";
import { AuthModule } from "./modules/auth/auth.module";
import { SignupModule } from "./modules/auth/signup/signup.module";
import { KycModule } from "./modules/auth/kyc/kyc.module";
import { NudgesModule } from "./modules/nudges/nudges.module";
import { ReceiptsModule } from "./modules/receipts/receipts.module";
import { MeModule } from "./modules/auth/me/me.module";
import { EmailModule } from "./modules/auth/email/email.module";
import { AccountPrefsModule } from "./modules/auth/account-prefs.module";
import { PayoutModule } from "./modules/auth/payout/payout.module";
import { IdentityModule } from "./modules/auth/identities/identity.module";
import { VirtualAccountsModule } from "./modules/virtual-accounts/virtual-accounts.module";
import { ReconciliationModule } from "./modules/reconciliation/reconciliation.module";
import { WalletModule } from "./modules/wallet/wallet.module";
import { ActivityModule } from "./modules/activity/activity.module";
import { ApiKeysModule } from "./modules/api-keys/api-keys.module";
import { DeveloperModule } from "./modules/developer/developer.module";

@Module({
  imports: [
    CoreModule,
    AuditModule,
    CryptoModule,
    RedisModule,
    PrismaModule,
    PersistenceModule,
    AuthPersistenceModule,
    SendchampModule,
    DojahModule,
    TokenModule,
    OtpModule,
    NombaModule,
    QueueModule,
    WebhooksModule,
    PotsModule,
    BillsModule,
    SettlementsModule,
    RefundsModule,
    AuthModule,
    SignupModule,
    KycModule,
    NudgesModule,
    ReceiptsModule,
    MeModule,
    EmailModule,
    AccountPrefsModule,
    PayoutModule,
    IdentityModule,
    VirtualAccountsModule,
    ReconciliationModule,
    WalletModule,
    ActivityModule,
    ApiKeysModule,
    DeveloperModule
  ],
  providers: [
    // Same-module APP_GUARD order is deterministic:
    // authenticate → rate-limit (keyed on principal) → authorize scopes.
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: ScopesGuard }
  ]
})
export class AppModule {}
