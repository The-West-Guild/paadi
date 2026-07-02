import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../infra/persistence/persistence.module";
import { NombaModule } from "../../integrations/nomba/nomba.module";
import { AdminGuard } from "../../common/guards/admin.guard";
import { ReconciliationRepository } from "../../infra/persistence/reconciliation.repository";
import { RaiseExceptionService } from "./raise-exception.service";
import { ReconciliationController } from "./reconciliation.controller";
import { ReconciliationReportService } from "./reconciliation-report.service";
import { ReconciliationService } from "./reconciliation.service";

@Module({
  imports: [PersistenceModule, NombaModule],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationService,
    ReconciliationReportService,
    RaiseExceptionService,
    ReconciliationRepository,
    AdminGuard
  ],
  exports: [ReconciliationService, RaiseExceptionService, ReconciliationRepository]
})
export class ReconciliationModule {}
