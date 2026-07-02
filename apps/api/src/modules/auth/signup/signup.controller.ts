import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  AuthSession,
  authSessionSchema,
  signupPasswordSchema,
  signupPinSchema,
  signupProfileSchema,
  signupStartResponseSchema,
  signupStartSchema,
  signupUsernameSchema,
  signupVerifyPhoneSchema,
  usernameAvailableQuerySchema,
  usernameAvailableResponseSchema,
  type SignupPasswordInput,
  type SignupPinInput,
  type SignupProfileInput,
  type SignupStartInput,
  type SignupUsernameInput,
  type SignupVerifyPhoneInput,
  type UsernameAvailableQuery
} from "@paadi/contracts";
import { Public } from "../../../common/decorators/public.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { ApiZod, ApiZodResponse } from "../../../common/swagger/zod-api";
import { SignupService } from "./signup.service";

@ApiTags("auth")
@Public()
@Controller("auth")
export class SignupController {
  constructor(private readonly signup: SignupService) {}

  @Post("signup/start")
  @ApiZod({ body: signupStartSchema, response: signupStartResponseSchema, status: 201 })
  start(@Body(new ZodValidationPipe(signupStartSchema)) body: SignupStartInput) {
    return this.signup.start(body.phone);
  }

  @Post("signup/verify-phone")
  @ApiZod({ body: signupVerifyPhoneSchema, status: 201 })
  verifyPhone(@Body(new ZodValidationPipe(signupVerifyPhoneSchema)) body: SignupVerifyPhoneInput) {
    return this.signup.verifyPhone(body.onboardingToken, body.code);
  }

  @Post("signup/profile")
  @ApiZod({ body: signupProfileSchema, status: 201 })
  profile(@Body(new ZodValidationPipe(signupProfileSchema)) body: SignupProfileInput) {
    return this.signup.setProfile(body.onboardingToken, body.firstName, body.lastName);
  }

  @Get("username/available")
  @ApiZodResponse(200, usernameAvailableResponseSchema)
  usernameAvailable(@Query(new ZodValidationPipe(usernameAvailableQuerySchema)) query: UsernameAvailableQuery) {
    return this.signup.usernameAvailable(query.u);
  }

  @Post("signup/username")
  @ApiZod({ body: signupUsernameSchema, status: 201 })
  username(@Body(new ZodValidationPipe(signupUsernameSchema)) body: SignupUsernameInput) {
    return this.signup.setUsername(body.onboardingToken, body.username);
  }

  @Post("signup/password")
  @ApiZod({ body: signupPasswordSchema, status: 201 })
  password(@Body(new ZodValidationPipe(signupPasswordSchema)) body: SignupPasswordInput) {
    return this.signup.setPassword(body.onboardingToken, body.password);
  }

  @Post("signup/pin")
  @ApiZod({ body: signupPinSchema, response: authSessionSchema, status: 201 })
  pin(@Body(new ZodValidationPipe(signupPinSchema)) body: SignupPinInput): Promise<AuthSession> {
    return this.signup.setPin(body.onboardingToken, body.pin);
  }
}
