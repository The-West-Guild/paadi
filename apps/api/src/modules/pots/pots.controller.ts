import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  createPotSchema,
  listPotsQuerySchema,
  listPotsResponseSchema,
  potDetailSchema,
  potParamsSchema,
  updatePotSchema,
  type CreatePotInput,
  type ListPotsQuery,
  type PotParams,
  type UpdatePotInput
} from "@paadi/contracts";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Scopes } from "../../common/decorators/scopes.decorator";
import { Audited } from "../../infra/audit/audited.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiZod, ApiZodResponse } from "../../common/swagger/zod-api";
import type { AccessClaims } from "../../infra/auth/token.service";
import { PotsService } from "./pots.service";

@ApiTags("pots")
@ApiBearerAuth()
@Controller("pots")
export class PotsController {
  constructor(private readonly pots: PotsService) {}

  @Post("")
  @Scopes("pots:write")
  @Audited("pots.created")
  @ApiOperation({ summary: "Create a pot", description: "Opens a new bill-split pot. Requires an idempotency-key header." })
  @ApiZod({ body: createPotSchema, response: potDetailSchema, status: 201 })
  create(
    @CurrentUser() claims: AccessClaims,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createPotSchema)) body: CreatePotInput
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException("idempotency-key header required");
    }
    return this.pots.create(claims.sub, body, idempotencyKey);
  }

  @Get("")
  @Scopes("pots:read")
  @ApiOperation({ summary: "List pots", description: "Returns the caller's pots, filterable and paginated by query." })
  @ApiZodResponse(200, listPotsResponseSchema)
  list(
    @CurrentUser() claims: AccessClaims,
    @Query(new ZodValidationPipe(listPotsQuerySchema)) query: ListPotsQuery
  ) {
    return this.pots.list(claims.sub, query);
  }

  @Get(":id")
  @Scopes("pots:read")
  @ApiOperation({ summary: "Get a pot", description: "Returns full detail for a pot the caller owns or participates in." })
  @ApiZodResponse(200, potDetailSchema)
  findOne(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(potParamsSchema)) params: PotParams
  ) {
    return this.pots.findOne(params.id, claims.sub);
  }

  @Patch(":id")
  @Scopes("pots:write")
  @ApiOperation({ summary: "Update a pot", description: "Edits mutable fields on a pot the caller owns." })
  @ApiZod({ body: updatePotSchema, response: potDetailSchema, status: 200 })
  update(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(potParamsSchema)) params: PotParams,
    @Body(new ZodValidationPipe(updatePotSchema)) body: UpdatePotInput
  ) {
    return this.pots.update(params.id, claims.sub, body);
  }

  @Delete(":id")
  @Scopes("pots:write")
  @ApiOperation({ summary: "Delete a pot", description: "Removes a draft pot the caller owns." })
  remove(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(potParamsSchema)) params: PotParams
  ) {
    return this.pots.delete(params.id, claims.sub);
  }

  @Post(":id/cancel")
  @Scopes("pots:write")
  @ApiOperation({ summary: "Cancel a pot", description: "Cancels an open pot and stops further contributions." })
  @ApiZodResponse(200, potDetailSchema)
  cancel(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(potParamsSchema)) params: PotParams
  ) {
    return this.pots.cancel(params.id, claims.sub);
  }
}
