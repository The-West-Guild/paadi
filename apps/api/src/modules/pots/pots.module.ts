import { Module } from "@nestjs/common";
import { NombaModule } from "../../integrations/nomba/nomba.module";
import { PersistenceModule } from "../../infra/persistence/persistence.module";
import { PrismaModule } from "../../infra/persistence/prisma.module";
import { PotRepository } from "../../infra/persistence/pot.repository";
import { PayController } from "./pay.controller";
import { PotsController } from "./pots.controller";
import { PotsService } from "./pots.service";

@Module({
  imports: [NombaModule, PersistenceModule, PrismaModule],
  controllers: [PotsController, PayController],
  providers: [PotRepository, PotsService],
  exports: [PotsService]
})
export class PotsModule {}
