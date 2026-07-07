import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { InjectQueue } from "@nestjs/bullmq";
import {
  potParamsSchema,
  settlementViewSchema,
  type PotParams,
  type SettlementView
} from "@paadi/contracts";
import { PrismaService, Settlement } from "@paadi/db";
import { Queue } from "bullmq";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Scopes } from "../../common/decorators/scopes.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ApiZodResponse } from "../../common/swagger/zod-api";
import type { AccessClaims } from "../../infra/auth/token.service";
import { QUEUES } from "../../queue/queue.constants";
import { PotsService } from "../pots/pots.service";

function toSettlementView(settlement: Settlement): SettlementView {
  return {
    id: settlement.id,
    potId: settlement.potId,
    type: settlement.type.toLowerCase() as SettlementView["type"],
    status: settlement.status.toLowerCase() as SettlementView["status"],
    amountKobo: Number(settlement.amountKobo),
    feeKobo: Number(settlement.feeKobo),
    vendToken: settlement.vendToken,
    vendUnits: settlement.vendUnits,
    nombaRef: settlement.nombaRef,
    providerStatus: settlement.providerStatus,
    failureReason: settlement.failureReason as SettlementView["failureReason"],
    settledAt: settlement.settledAt ? settlement.settledAt.toISOString() : null,
    createdAt: settlement.createdAt.toISOString()
  };
}

@ApiTags("pots")
@ApiBearerAuth()
@Controller("pots")
export class SettlementsController {
  constructor(
    private readonly pots: PotsService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.settlement) private readonly settlement: Queue
  ) {}

  @Post(":id/settle/retry")
  @Scopes("pots:write")
  @ApiZodResponse(202, settlementViewSchema)
  async retry(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(potParamsSchema)) params: PotParams
  ): Promise<SettlementView> {
    const pot = await this.pots.findOne(params.id, claims.sub);
    if (pot.status !== "funded") {
      throw new ConflictException("pot not funded");
    }
    await this.settlement.add("settle", { potId: params.id });
    const settlement = await this.findSettlement(params.id);
    if (!settlement) {
      throw new ConflictException("settlement not started");
    }
    return toSettlementView(settlement);
  }

  @Get(":id/settlement")
  @Scopes("pots:read")
  @ApiZodResponse(200, settlementViewSchema)
  async getSettlement(
    @CurrentUser() claims: AccessClaims,
    @Param(new ZodValidationPipe(potParamsSchema)) params: PotParams
  ): Promise<SettlementView> {
    await this.pots.findOne(params.id, claims.sub);
    const settlement = await this.findSettlement(params.id);
    if (!settlement) {
      throw new NotFoundException("settlement not found");
    }
    return toSettlementView(settlement);
  }

  private findSettlement(potId: string): Promise<Settlement | null> {
    return this.prisma.settlement.findUnique({
      where: { merchantTxRef: `settle:${potId}` }
    });
  }
}
