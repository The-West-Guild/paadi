import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  emailStartSchema,
  emailVerifySchema,
  type EmailStartInput,
  type EmailVerifyInput
} from "@paadi/contracts";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { ApiZod } from "../../../common/swagger/zod-api";
import type { AccessClaims } from "../../../infra/auth/token.service";
import { EmailVerificationService } from "./email-verification.service";

@ApiTags("me")
@ApiBearerAuth()
@Controller("me/email")
export class EmailController {
  constructor(private readonly email: EmailVerificationService) {}

  @Post("start")
  @ApiZod({ body: emailStartSchema, status: 201 })
  start(
    @CurrentUser() claims: AccessClaims,
    @Body(new ZodValidationPipe(emailStartSchema)) body: EmailStartInput
  ) {
    return this.email.start(claims.sub, body.email);
  }

  @Post("verify")
  @ApiZod({ body: emailVerifySchema, status: 201 })
  verify(
    @CurrentUser() claims: AccessClaims,
    @Body(new ZodValidationPipe(emailVerifySchema)) body: EmailVerifyInput
  ) {
    return this.email.verify(claims.sub, body.code);
  }
}
