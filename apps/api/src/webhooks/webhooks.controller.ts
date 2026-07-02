import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  UseGuards
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { InjectQueue } from "@nestjs/bullmq";
import { Prisma, PrismaService, WebhookEventIn } from "@paadi/db";
import { Queue } from "bullmq";
import { Public } from "../common/decorators/public.decorator";
import { KycService } from "../modules/auth/kyc/kyc.service";
import { QUEUES } from "../queue/queue.constants";
import { DojahSignatureGuard } from "./dojah-signature.guard";
import { NombaSignatureGuard } from "./nomba-signature.guard";
import { NombaWebhookBody } from "./nomba-webhook.types";

interface DojahWebhookBody {
  reference?: string;
  entity?: { reference?: string };
  status?: string;
}

@ApiTags("webhooks")
@Public()
@Controller("webhooks")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @InjectQueue(QUEUES.ingestion) private readonly ingestion: Queue,
    private readonly prisma: PrismaService,
    private readonly kyc: KycService
  ) {}

  @Post("nomba")
  @UseGuards(NombaSignatureGuard)
  async handle(@Body() body: NombaWebhookBody): Promise<{ received: boolean }> {
    const providerEventId = body.requestId ?? body.data?.transaction?.transactionId;
    if (!providerEventId) {
      throw new BadRequestException("unidentifiable webhook");
    }

    let event: WebhookEventIn;
    try {
      event = await this.prisma.webhookEventIn.create({
        data: {
          provider: "nomba",
          providerEventId,
          signatureOk: true,
          payload: body as unknown as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { received: true };
      }
      throw error;
    }

    try {
      await this.ingestion.add("ingest", { webhookEventInId: event.id });
    } catch (error) {
      this.logger.error(`failed to enqueue ingestion job for event ${event.id}`, error as Error);
    }

    return { received: true };
  }

  @Post("dojah")
  @UseGuards(DojahSignatureGuard)
  async dojah(@Body() body: DojahWebhookBody): Promise<{ received: boolean }> {
    const reference = body.reference ?? body.entity?.reference;
    const status = (body.status ?? "").toLowerCase();
    const success = status === "success" || status === "verified" || status === "completed";
    if (reference) {
      await this.prisma.webhookEventIn.upsert({
        where: { provider_providerEventId: { provider: "dojah", providerEventId: reference } },
        create: {
          provider: "dojah",
          providerEventId: reference,
          signatureOk: true,
          payload: { reference, status } as Prisma.InputJsonValue,
          processedAt: new Date()
        },
        update: {}
      });
      if (success) {
        await this.kyc.completeByReference(reference);
      }
    }
    return { received: true };
  }
}
