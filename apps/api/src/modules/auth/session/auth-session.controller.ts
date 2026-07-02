import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  authSessionSchema,
  forgotPasswordSchema,
  loginResponseSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type RefreshInput,
  type ResetPasswordInput
} from "@paadi/contracts";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { ApiZod } from "../../../common/swagger/zod-api";
import type { AccessClaims } from "../../../infra/auth/token.service";
import { AuthSessionService } from "./auth-session.service";

@ApiTags("auth")
@ApiBearerAuth()
@Controller("auth")
export class AuthSessionController {
  constructor(private readonly session: AuthSessionService) {}

  @Public()
  @Post("login")
  @ApiZod({ body: loginSchema, response: loginResponseSchema, status: 201 })
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.session.login(body.identifier, body.password, { deviceId: body.deviceId });
  }

  @Public()
  @Post("refresh")
  @ApiZod({ body: refreshSchema, response: authSessionSchema, status: 201 })
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput) {
    return this.session.refresh(body.refreshToken);
  }

  @Post("logout")
  logout(@CurrentUser() claims: AccessClaims) {
    return this.session.logout(claims.sid);
  }

  @Post("logout-all")
  logoutAll(@CurrentUser() claims: AccessClaims) {
    return this.session.logoutAll(claims.sub);
  }

  @Public()
  @Post("forgot-password")
  @ApiZod({ body: forgotPasswordSchema })
  forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput) {
    return this.session.forgotPassword(body.identifier);
  }

  @Public()
  @Post("reset-password")
  @ApiZod({ body: resetPasswordSchema })
  resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput) {
    return this.session.resetPassword(body.identifier, body.code, body.newPassword);
  }
}
