import { Body, Controller, Get, Post, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  provisionVirtualAccountSchema,
  virtualAccountResponseSchema,
  type ProvisionVirtualAccountInput,
  type VirtualAccountResponse
} from "@paadi/contracts";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiZod, ApiZodResponse } from "../../common/swagger/zod-api";
import { toVirtualAccountResponse } from "../../infra/persistence/mappers/virtual-account.mapper";
import type { AccessClaims } from "../../infra/auth/token.service";
import { VirtualAccountService } from "./virtual-account.service";

interface StatusResponse {
  status(code: number): unknown;
}

@ApiTags("virtual-accounts")
@ApiBearerAuth()
@Controller("me/virtual-account")
export class VirtualAccountsController {
  constructor(private readonly virtualAccounts: VirtualAccountService) {}

  @Get("")
  @ApiOperation({
    summary: "Get virtual account",
    description: "Returns the caller's dedicated NUBAN and holder name, or 404 if not yet provisioned."
  })
  @ApiZodResponse(200, virtualAccountResponseSchema)
  async get(@CurrentUser() claims: AccessClaims): Promise<VirtualAccountResponse> {
    const virtualAccount = await this.virtualAccounts.getForUser(claims.sub);
    return toVirtualAccountResponse(virtualAccount);
  }

  @Post("")
  @ApiOperation({
    summary: "Provision virtual account",
    description: "Provisions a dedicated NUBAN for the caller. Returns 201 when newly created, 200 when one already exists."
  })
  @ApiZod({ body: provisionVirtualAccountSchema, response: virtualAccountResponseSchema, status: 201 })
  @ApiZodResponse(200, virtualAccountResponseSchema)
  async provision(
    @CurrentUser() claims: AccessClaims,
    @Body(new ZodValidationPipe(provisionVirtualAccountSchema)) _body: ProvisionVirtualAccountInput,
    @Res({ passthrough: true }) res: StatusResponse
  ): Promise<VirtualAccountResponse> {
    const outcome = await this.virtualAccounts.provisionVirtualAccount(claims.sub);
    res.status(outcome.created ? 201 : 200);
    return toVirtualAccountResponse(outcome.virtualAccount);
  }
}
