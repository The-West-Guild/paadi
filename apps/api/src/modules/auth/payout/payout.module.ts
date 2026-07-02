import { Module } from "@nestjs/common";
import { NombaModule } from "../../../integrations/nomba/nomba.module";
import { AuthModule } from "../auth.module";
import { BanksController } from "./banks.controller";
import { PayoutAccountController } from "./payout-account.controller";
import { PayoutAccountService } from "./payout-account.service";

@Module({
  imports: [NombaModule, AuthModule],
  controllers: [BanksController, PayoutAccountController],
  providers: [PayoutAccountService]
})
export class PayoutModule {}
