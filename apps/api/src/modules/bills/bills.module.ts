import { Module } from "@nestjs/common";
import { NombaModule } from "../../integrations/nomba/nomba.module";
import { BillsController } from "./bills.controller";

@Module({
  imports: [NombaModule],
  controllers: [BillsController]
})
export class BillsModule {}
