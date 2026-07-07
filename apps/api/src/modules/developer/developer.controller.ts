import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  apiErrorSchema,
  registerWebhookEndpointSchema,
  webhookDeliveriesResponseSchema,
  webhookEndpointCreatedSchema,
  webhookEndpointParamsSchema,
  webhookEndpointSchema,
  webhookEndpointsResponseSchema,
  type RegisterWebhookEndpointInput,
  type WebhookDeliveriesResponse,
  type WebhookEndpointCreatedDto,
  type WebhookEndpointDto,
  type WebhookEndpointParams,
  type WebhookEndpointsResponse
} from "@paadi/contracts";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Scopes } from "../../common/decorators/scopes.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiZod, ApiZodResponse } from "../../common/swagger/zod-api";
import type { AccessClaims } from "../../infra/auth/token.service";
import { DeveloperService } from "./developer.service";

@ApiTags("developer")
@ApiBearerAuth()
@Scopes("webhooks:manage")
@Controller("developer/webhooks")
export class DeveloperController {
  constructor(private readonly developer: DeveloperService) {}

  @Post("")
  @ApiOperation({
    summary: "Register webhook endpoint",
    description: "Registers a URL to receive signed event deliveries. The signing secret is generated server-side and returned once in this response."
  })
  @ApiZod({ body: registerWebhookEndpointSchema, response: webhookEndpointCreatedSchema, status: 201 })
  @ApiZodResponse(400, apiErrorSchema)
  register(
    @CurrentUser() claims: AccessClaims,
    @Body(new ZodValidationPipe(registerWebhookEndpointSchema)) body: RegisterWebhookEndpointInput
  ): Promise<WebhookEndpointCreatedDto> {
    return this.developer.register(claims.sub, body);
  }

  @Get("")
  @ApiOperation({
    summary: "List webhook endpoints",
    description: "Returns the caller's registered webhook endpoints. Signing secrets are never included in this response."
  })
  @ApiZodResponse(200, webhookEndpointsResponseSchema)
  list(@CurrentUser() claims: AccessClaims): Promise<WebhookEndpointsResponse> {
    return this.developer.list(claims.sub);
  }

  @Delete(":id")
  @ApiOperation({
    summary: "Disable webhook endpoint",
    description: "Soft-disables a webhook endpoint the caller owns. No further deliveries are attempted to it."
  })
  @ApiZodResponse(200, webhookEndpointSchema)
  @ApiZodResponse(404, apiErrorSchema)
  remove(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(webhookEndpointParamsSchema)) params: WebhookEndpointParams
  ): Promise<WebhookEndpointDto> {
    return this.developer.remove(claims.sub, params.id);
  }

  @Get(":id/deliveries")
  @ApiOperation({
    summary: "List webhook deliveries",
    description: "Returns recent delivery attempts for a webhook endpoint the caller owns, including status and retry state."
  })
  @ApiZodResponse(200, webhookDeliveriesResponseSchema)
  @ApiZodResponse(404, apiErrorSchema)
  deliveries(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(webhookEndpointParamsSchema)) params: WebhookEndpointParams
  ): Promise<WebhookDeliveriesResponse> {
    return this.developer.deliveries(claims.sub, params.id);
  }
}
