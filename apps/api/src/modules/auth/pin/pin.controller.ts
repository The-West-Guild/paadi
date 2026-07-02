import { Body, Controller, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  changePinSchema,
  pinVerifySchema,
  type ChangePinInput,
  type PinVerifyInput
} from "@paadi/contracts";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { ApiZod } from "../../../common/swagger/zod-api";
import type { AccessClaims } from "../../../infra/auth/token.service";
import { PinService } from "./pin.service";

@ApiTags("auth")
@ApiBearerAuth()
@Controller("auth/pin")
export class PinController {
  constructor(private readonly pin: PinService) {}

  @Post("verify")
  @ApiZod({ body: pinVerifySchema, status: 201 })
  verify(@CurrentUser() claims: AccessClaims, @Body(new ZodValidationPipe(pinVerifySchema)) body: PinVerifyInput) {
    return this.pin.verify(claims.sub, body.pin);
  }

  @Put("")
  @ApiZod({ body: changePinSchema, status: 200 })
  change(@CurrentUser() claims: AccessClaims, @Body(new ZodValidationPipe(changePinSchema)) body: ChangePinInput) {
    return this.pin.change(claims.sub, body.currentPin, body.newPin);
  }
}
