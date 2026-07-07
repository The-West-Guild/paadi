import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { receiptResponseSchema, type ReceiptResponse } from "@paadi/contracts";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Scopes } from "../../common/decorators/scopes.decorator";
import { ApiZodResponse } from "../../common/swagger/zod-api";
import type { AccessClaims } from "../../infra/auth/token.service";
import { ReceiptsService } from "./receipts.service";

@ApiTags("receipts")
@ApiBearerAuth()
@Controller("receipts")
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get("payment/:id")
  @Scopes("pots:read")
  @ApiZodResponse(200, receiptResponseSchema)
  payment(
    @CurrentUser() claims: AccessClaims,
    @Param("id", new ParseUUIDPipe()) id: string
  ): Promise<ReceiptResponse> {
    return this.receipts.getPaymentReceipt(id, claims.sub);
  }

  @Get("settlement/:id")
  @Scopes("pots:read")
  @ApiZodResponse(200, receiptResponseSchema)
  settlement(
    @CurrentUser() claims: AccessClaims,
    @Param("id", new ParseUUIDPipe()) id: string
  ): Promise<ReceiptResponse> {
    return this.receipts.getSettlementReceipt(id, claims.sub);
  }
}
