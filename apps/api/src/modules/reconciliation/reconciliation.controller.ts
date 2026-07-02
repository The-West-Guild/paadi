import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  exceptionParamsSchema,
  exceptionSchema,
  listExceptionsQuerySchema,
  listExceptionsResponseSchema,
  reconciliationReportResponseSchema,
  resolveExceptionSchema,
  type ExceptionDto,
  type ExceptionParams,
  type ListExceptionsQuery,
  type ListExceptionsResponse,
  type ReconciliationReportResponse,
  type ResolveExceptionInput
} from "@paadi/contracts";
import { AdminOnly } from "../../common/decorators/admin-only.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AdminGuard } from "../../common/guards/admin.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiZod, ApiZodResponse } from "../../common/swagger/zod-api";
import type { AccessClaims } from "../../infra/auth/token.service";
import { ReconciliationReportService } from "./reconciliation-report.service";
import { ReconciliationService } from "./reconciliation.service";

@ApiTags("reconciliation")
@ApiBearerAuth()
@AdminOnly()
@UseGuards(AdminGuard)
@Controller("admin/reconciliation")
export class ReconciliationController {
  @Inject(ReconciliationReportService)
  private readonly report!: ReconciliationReportService;

  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get("report")
  @ApiZodResponse(200, reconciliationReportResponseSchema)
  async reconciliationReport(): Promise<ReconciliationReportResponse> {
    return this.report.build();
  }

  @Get("exceptions")
  @ApiZodResponse(200, listExceptionsResponseSchema)
  async list(
    @Query(new ZodValidationPipe(listExceptionsQuerySchema)) query: ListExceptionsQuery
  ): Promise<ListExceptionsResponse> {
    return this.reconciliation.listExceptions(query);
  }

  @Post("exceptions/:id/resolve")
  @ApiZod({ body: resolveExceptionSchema, response: exceptionSchema, status: 200 })
  async resolve(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(exceptionParamsSchema)) params: ExceptionParams,
    @Body(new ZodValidationPipe(resolveExceptionSchema)) body: ResolveExceptionInput
  ): Promise<ExceptionDto> {
    return this.reconciliation.resolve(params.id, body.action, claims.sub, body);
  }
}
