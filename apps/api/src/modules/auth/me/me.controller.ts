import { Body, Controller, Get, Param, Patch, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  changeUsernameSchema,
  meResponseSchema,
  publicProfileResponseSchema,
  updateProfileSchema,
  type ChangeUsernameInput,
  type UpdateProfileInput
} from "@paadi/contracts";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Scopes } from "../../../common/decorators/scopes.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { ApiZod, ApiZodResponse } from "../../../common/swagger/zod-api";
import type { AccessClaims } from "../../../infra/auth/token.service";
import { ProfileService } from "./profile.service";

@ApiTags("me")
@ApiBearerAuth()
@Controller()
export class MeController {
  constructor(private readonly profile: ProfileService) {}

  @Get("me")
  @Scopes("profile:read")
  @ApiZodResponse(200, meResponseSchema)
  me(@CurrentUser() claims: AccessClaims) {
    return this.profile.getMe(claims.sub);
  }

  @Patch("me/profile")
  @ApiZod({ body: updateProfileSchema, status: 200 })
  updateProfile(
    @CurrentUser() claims: AccessClaims,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput
  ) {
    return this.profile.updateProfile(claims.sub, body);
  }

  @Put("me/username")
  @ApiZod({ body: changeUsernameSchema, status: 200 })
  changeUsername(
    @CurrentUser() claims: AccessClaims,
    @Body(new ZodValidationPipe(changeUsernameSchema)) body: ChangeUsernameInput
  ) {
    return this.profile.changeUsername(claims.sub, body.username);
  }

  @Public()
  @Get("profiles/:username")
  @ApiZodResponse(200, publicProfileResponseSchema)
  publicProfile(@Param("username") username: string) {
    return this.profile.getPublicProfile(username.replace(/^@/, ""));
  }
}
