import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../infra/persistence/persistence.module";
import { RefundsRepository } from "../../infra/persistence/refunds.repository";
import { NombaModule } from "../../integrations/nomba/nomba.module";
import { RefundsService } from "./refunds.service";

@Module({
  imports: [PersistenceModule, NombaModule],
  providers: [RefundsService, RefundsRepository],
  exports: [RefundsService]
})
export class RefundsModule {}
