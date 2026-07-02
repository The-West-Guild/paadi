import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { banksResponseSchema } from "@paadi/contracts";
import { ApiZodResponse } from "../../../common/swagger/zod-api";
import { PayoutAccountService } from "./payout-account.service";

@ApiTags("payout")
@ApiBearerAuth()
@Controller("transfers")
export class BanksController {
  constructor(private readonly payouts: PayoutAccountService) {}

  @Get("banks")
  @ApiZodResponse(200, banksResponseSchema)
  listBanks() {
    return this.payouts.listBanks();
  }
}
