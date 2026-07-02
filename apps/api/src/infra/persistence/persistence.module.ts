import { Module } from "@nestjs/common";
import { IdempotencyStore, LedgerRepository, OutboxRepository } from "@paadi/domain";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";
import { PrismaIdempotencyStore } from "./idempotency.store";

@Module({
  providers: [
    { provide: LedgerRepository, useClass: PrismaLedgerRepository },
    { provide: OutboxRepository, useClass: PrismaOutboxRepository },
    { provide: IdempotencyStore, useClass: PrismaIdempotencyStore }
  ],
  exports: [LedgerRepository, OutboxRepository, IdempotencyStore]
})
export class PersistenceModule {}
