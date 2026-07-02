import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { PotDetail } from "@paadi/contracts";
import { PotStatus as DbPotStatus, PrismaService } from "@paadi/db";
import {
  IngestPaymentResult,
  PaymentIngestionRepository
} from "../../infra/persistence/payment-ingestion.repository";
import { toPotDetail } from "../../infra/persistence/mappers/pot.mapper";
import { PinService } from "../auth/pin/pin.service";

export interface PayFromWalletCommand {
  userId: string;
  potId: string;
  splitId: string;
  amountKobo?: number;
  pin: string;
  idempotencyKey: string;
}

export interface PayFromWalletResult {
  outcome: IngestPaymentResult;
  pot: PotDetail;
}

@Injectable()
export class WalletSpendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentIngestion: PaymentIngestionRepository,
    private readonly pin: PinService
  ) {}

  async payFromWallet(command: PayFromWalletCommand): Promise<PayFromWalletResult> {
    await this.pin.verify(command.userId, command.pin);

    const split = await this.prisma.split.findUnique({ where: { id: command.splitId } });
    if (split === null || split.potId !== command.potId) {
      throw new HttpException("split not found", HttpStatus.NOT_FOUND);
    }

    const pot = await this.prisma.pot.findUnique({ where: { id: command.potId } });
    if (pot === null) {
      throw new HttpException("pot not found", HttpStatus.NOT_FOUND);
    }
    if (pot.status !== DbPotStatus.OPEN) {
      throw new HttpException("pot not open", HttpStatus.CONFLICT);
    }

    const remainingKobo = Number(split.shareKobo) - Number(split.paidKobo);
    if (remainingKobo <= 0) {
      throw new HttpException("split already paid", HttpStatus.CONFLICT);
    }

    const amountKobo = command.amountKobo ?? remainingKobo;
    if (amountKobo <= 0) {
      throw new HttpException("nothing to pay", HttpStatus.BAD_REQUEST);
    }

    const outcome = await this.paymentIngestion.payFromWallet({
      payerUserId: command.userId,
      potId: command.potId,
      splitId: command.splitId,
      amountKobo,
      idempotencyKey: command.idempotencyKey,
      payerName: null
    });

    const refreshed = await this.prisma.pot.findUniqueOrThrow({
      where: { id: command.potId },
      include: { splits: true }
    });

    return { outcome, pot: toPotDetail(refreshed) };
  }
}
