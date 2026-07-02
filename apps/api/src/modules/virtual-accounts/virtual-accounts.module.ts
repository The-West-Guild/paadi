import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../infra/persistence/persistence.module";
import { NombaModule } from "../../integrations/nomba/nomba.module";
import { VirtualAccountRepository } from "../../infra/persistence/virtual-account.repository";
import { VirtualAccountsController } from "./virtual-accounts.controller";
import { VirtualAccountService } from "./virtual-account.service";

@Module({
  imports: [NombaModule, PersistenceModule],
  controllers: [VirtualAccountsController],
  providers: [VirtualAccountService, VirtualAccountRepository],
  exports: [VirtualAccountService, VirtualAccountRepository]
})
export class VirtualAccountsModule {}
