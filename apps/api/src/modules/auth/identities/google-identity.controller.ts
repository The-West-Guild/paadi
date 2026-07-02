import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  authSessionSchema,
  googleSignInSchema,
  linkGoogleSchema,
  type GoogleSignInInput,
  type LinkGoogleInput
} from "@paadi/contracts";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { ApiZod } from "../../../common/swagger/zod-api";
import type { AccessClaims } from "../../../infra/auth/token.service";
import { GoogleIdentityService } from "./google-identity.service";

@ApiTags("auth")
@ApiBearerAuth()
@Controller()
export class GoogleIdentityController {
  constructor(private readonly identity: GoogleIdentityService) {}

  @Public()
  @Post("auth/google")
  @ApiZod({ body: googleSignInSchema, response: authSessionSchema, status: 201 })
  signIn(@Body(new ZodValidationPipe(googleSignInSchema)) body: GoogleSignInInput) {
    return this.identity.signIn(body.idToken);
  }

  @Post("me/identities/google")
  @ApiZod({ body: linkGoogleSchema, status: 201 })
  link(
    @CurrentUser() claims: AccessClaims,
    @Body(new ZodValidationPipe(linkGoogleSchema)) body: LinkGoogleInput
  ) {
    return this.identity.link(claims.sub, body.idToken);
  }
}
