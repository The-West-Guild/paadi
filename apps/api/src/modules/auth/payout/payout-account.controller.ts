import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  createPayoutAccountSchema,
  deletePayoutAccountSchema,
  payoutAccountParamsSchema,
  payoutAccountSchema,
  payoutAccountsResponseSchema,
  payoutLookupResponseSchema,
  payoutLookupSchema,
  type CreatePayoutAccountInput,
  type DeletePayoutAccountInput,
  type PayoutAccountParams,
  type PayoutLookupInput
} from "@paadi/contracts";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { ApiZod, ApiZodResponse } from "../../../common/swagger/zod-api";
import type { AccessClaims } from "../../../infra/auth/token.service";
import { PayoutAccountService } from "./payout-account.service";

@ApiTags("payout")
@ApiBearerAuth()
@Controller("me/payout-accounts")
export class PayoutAccountController {
  constructor(private readonly payouts: PayoutAccountService) {}

  @Post("lookup")
  @ApiZod({ body: payoutLookupSchema, response: payoutLookupResponseSchema, status: 201 })
  lookup(@Body(new ZodValidationPipe(payoutLookupSchema)) body: PayoutLookupInput) {
    return this.payouts.lookup(body.bankCode, body.accountNumber);
  }

  @Get("")
  @ApiZodResponse(200, payoutAccountsResponseSchema)
  list(@CurrentUser() claims: AccessClaims) {
    return this.payouts.list(claims.sub);
  }

  @Post("")
  @ApiZod({ body: createPayoutAccountSchema, response: payoutAccountSchema, status: 201 })
  create(
    @CurrentUser() claims: AccessClaims,
    @Body(new ZodValidationPipe(createPayoutAccountSchema)) body: CreatePayoutAccountInput
  ) {
    return this.payouts.create(claims.sub, body.bankCode, body.accountNumber, body.pin);
  }

  @Put(":id/primary")
  setPrimary(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(payoutAccountParamsSchema)) params: PayoutAccountParams
  ) {
    return this.payouts.setPrimary(claims.sub, params.id);
  }

  @Delete(":id")
  @ApiZod({ body: deletePayoutAccountSchema, status: 200 })
  remove(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(payoutAccountParamsSchema)) params: PayoutAccountParams,
    @Body(new ZodValidationPipe(deletePayoutAccountSchema)) body: DeletePayoutAccountInput
  ) {
    return this.payouts.remove(claims.sub, params.id, body.pin);
  }
}
