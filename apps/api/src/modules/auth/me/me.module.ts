import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../../infra/persistence/persistence.module";
import { MeController } from "./me.controller";
import { ProfileService } from "./profile.service";

@Module({
  imports: [PersistenceModule],
  controllers: [MeController],
  providers: [ProfileService],
  exports: [ProfileService]
})
export class MeModule {}
