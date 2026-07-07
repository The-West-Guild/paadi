import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  activityFeedResponseSchema,
  paginationQuerySchema,
  potActivityResponseSchema,
  potParamsSchema,
  type ActivityFeedResponse,
  type PaginationQuery,
  type PotActivityResponse,
  type PotParams
} from "@paadi/contracts";
import { PrismaService } from "@paadi/db";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Scopes } from "../../common/decorators/scopes.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiZodResponse } from "../../common/swagger/zod-api";
import type { AccessClaims } from "../../infra/auth/token.service";
import { ActivityFeedService } from "./activity-feed.service";

@ApiTags("activity")
@ApiBearerAuth()
@Controller()
export class ActivityController {
  constructor(
    private readonly activity: ActivityFeedService,
    private readonly prisma: PrismaService
  ) {}

  @Get("me/activity")
  @Scopes("activity:read")
  @ApiZodResponse(200, activityFeedResponseSchema)
  globalFeed(
    @CurrentUser() claims: AccessClaims,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery
  ): Promise<ActivityFeedResponse> {
    return this.activity.getGlobalActivity(claims.sub, query);
  }

  @Get("pots/:id/activity")
  @Scopes("activity:read")
  @ApiZodResponse(200, potActivityResponseSchema)
  async potFeed(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(potParamsSchema)) params: PotParams,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery
  ): Promise<PotActivityResponse> {
    const pot = await this.prisma.pot.findUnique({
      where: { id: params.id },
      select: { creatorId: true }
    });
    if (!pot) {
      throw new NotFoundException("pot not found");
    }
    if (pot.creatorId !== claims.sub) {
      throw new ForbiddenException("not entitled to pot activity");
    }
    return this.activity.getPotActivity(params.id, query);
  }
}
