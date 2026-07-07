import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  apiErrorSchema,
  apiKeyCreatedSchema,
  apiKeyCurrentSchema,
  apiKeyParamsSchema,
  apiKeySchema,
  apiKeysResponseSchema,
  mintApiKeySchema,
  type ApiKeyCreatedDto,
  type ApiKeyCurrentDto,
  type ApiKeyDto,
  type ApiKeyParams,
  type ApiKeysResponse,
  type MintApiKeyInput
} from "@paadi/contracts";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Scopes } from "../../common/decorators/scopes.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiZod, ApiZodResponse } from "../../common/swagger/zod-api";
import type { AccessClaims } from "../../infra/auth/token.service";
import { ApiKeysService } from "./api-keys.service";

@ApiTags("api-keys")
@ApiBearerAuth()
@Controller("me/api-keys")
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post("")
  @ApiOperation({
    summary: "Mint API key",
    description:
      "Creates a scoped API key acting as the caller. Session auth only — the plaintext key is returned once in this response and never again."
  })
  @ApiZod({ body: mintApiKeySchema, response: apiKeyCreatedSchema, status: 201 })
  @ApiZodResponse(400, apiErrorSchema)
  @ApiZodResponse(403, apiErrorSchema)
  mint(
    @CurrentUser() claims: AccessClaims,
    @Body(new ZodValidationPipe(mintApiKeySchema)) body: MintApiKeyInput
  ): Promise<ApiKeyCreatedDto> {
    return this.apiKeys.mint(claims, body);
  }

  @Get("")
  @ApiOperation({
    summary: "List API keys",
    description: "Returns the caller's API keys (prefix and metadata only — never the secret). Session auth only."
  })
  @ApiZodResponse(200, apiKeysResponseSchema)
  @ApiZodResponse(403, apiErrorSchema)
  list(@CurrentUser() claims: AccessClaims): Promise<ApiKeysResponse> {
    return this.apiKeys.list(claims);
  }

  @Get("current")
  @Scopes()
  @ApiOperation({
    summary: "Introspect current API key",
    description:
      "Returns the identity, mode and scopes of the API key making this call. API-key auth only — lets an integration discover what it is allowed to do."
  })
  @ApiZodResponse(200, apiKeyCurrentSchema)
  @ApiZodResponse(400, apiErrorSchema)
  current(@CurrentUser() claims: AccessClaims): Promise<ApiKeyCurrentDto> {
    return this.apiKeys.current(claims);
  }

  @Delete(":id")
  @ApiOperation({
    summary: "Revoke API key",
    description: "Revokes an API key the caller owns. Takes effect immediately. Session auth only."
  })
  @ApiZodResponse(200, apiKeySchema)
  @ApiZodResponse(404, apiErrorSchema)
  revoke(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(apiKeyParamsSchema)) params: ApiKeyParams
  ): Promise<ApiKeyDto> {
    return this.apiKeys.revoke(claims, params.id);
  }
}
