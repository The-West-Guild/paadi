import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  kycBvnSchema,
  kycSelfieSchema,
  kycStatusResponseSchema,
  type KycBvnInput,
  type KycSelfieInput
} from "@paadi/contracts";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { ApiZod, ApiZodResponse } from "../../../common/swagger/zod-api";
import type { AccessClaims } from "../../../infra/auth/token.service";
import { KycService } from "./kyc.service";

@ApiTags("kyc")
@ApiBearerAuth()
@Controller("me/kyc")
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get("")
  @ApiZodResponse(200, kycStatusResponseSchema)
  getStatus(@CurrentUser() claims: AccessClaims) {
    return this.kyc.getStatus(claims.sub);
  }

  @Post("bvn")
  @ApiZod({ body: kycBvnSchema, status: 201 })
  submitBvn(
    @CurrentUser() claims: AccessClaims,
    @Body(new ZodValidationPipe(kycBvnSchema)) body: KycBvnInput
  ) {
    return this.kyc.submitBvn(claims.sub, body.bvn);
  }

  @Post("selfie")
  @ApiZod({ body: kycSelfieSchema, status: 201 })
  submitSelfie(
    @CurrentUser() claims: AccessClaims,
    @Body(new ZodValidationPipe(kycSelfieSchema)) body: KycSelfieInput
  ) {
    return this.kyc.submitSelfie(claims.sub, body.image);
  }
}
