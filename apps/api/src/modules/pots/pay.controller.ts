import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  payTokenParamsSchema,
  payViewSchema,
  type PayTokenParams
} from "@paadi/contracts";
import { Public } from "../../common/decorators/public.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiZodResponse } from "../../common/swagger/zod-api";
import { PotsService } from "./pots.service";

@ApiTags("pay")
@Public()
@Controller("pay")
export class PayController {
  constructor(private readonly pots: PotsService) {}

  @Get(":token")
  @ApiZodResponse(200, payViewSchema)
  getPayerView(@Param(new ZodValidationPipe(payTokenParamsSchema)) params: PayTokenParams) {
    return this.pots.getPayerView(params.token);
  }
}
