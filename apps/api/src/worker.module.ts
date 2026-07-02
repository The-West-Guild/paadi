import { Module } from "@nestjs/common";
import { CoreModule } from "./core/core.module";
import { PrismaModule } from "./infra/persistence/prisma.module";
import { PersistenceModule } from "./infra/persistence/persistence.module";
import { AuthPersistenceModule } from "./infra/persistence/auth-persistence.module";
import { CryptoModule } from "./common/crypto/crypto.module";
import { NombaModule } from "./integrations/nomba/nomba.module";
import { PushModule } from "./integrations/push/push.module";
import { TwilioModule } from "./integrations/twilio/twilio.module";
import { WorkersModule } from "./workers/workers.module";

@Module({
  imports: [
    CoreModule,
    CryptoModule,
    PrismaModule,
    PersistenceModule,
    AuthPersistenceModule,
    NombaModule,
    PushModule,
    TwilioModule,
    WorkersModule,
  ],
})
export class WorkerModule {}
