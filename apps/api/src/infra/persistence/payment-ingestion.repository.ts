import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  CompletionRule,
  PaymentMethod,
  PaymentRecordStatus,
  PoolState,
  ShareState
} from "@paadi/contracts";
import {
  LedgerAccountKind,
  LedgerRepository,
  OutboxMessage,
  OutboxRepository,
  applyPaymentToShare,
  assertPoolTransition,
  buildContributionPosting,
  buildSuspensePosting,
  buildWalletContributionPosting,
  isPotFunded
} from "@paadi/domain";
import {
  PaymentMethod as DbPaymentMethod,
  PotStatus as DbPotStatus,
  Prisma,
  PrismaService,
  ShareStatus as DbShareStatus
} from "@paadi/db";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";
import { toAmountKoboBigInt } from "./mappers/payment.mapper";

const OUTBOX_TARGET = "organizer";
const WALLET_OUTBOX_TARGET = "user";
const WALLET_TXREF_PREFIX = "wallet:";

export interface IngestPaymentInput {
  webhookEventInId: string;
  nombaTransactionId: string;
  splitId: string | null;
  potId: string | null;
  amountKobo: number;
  method: PaymentMethod;
  senderName: string | null;
  senderAccount: string | null;
  senderBank: string | null;
}

export interface IngestPaymentResult {
  status: PaymentRecordStatus;
  paymentId: string | null;
  potId: string | null;
  splitId: string | null;
  attributedKobo: number;
  excessKobo: number;
  funded: boolean;
  alreadyProcessed: boolean;
}

export interface PayFromWalletInput {
  payerUserId: string;
  potId: string;
  splitId: string;
  amountKobo: number;
  idempotencyKey: string;
  payerName: string | null;
}

@Injectable()
export class PaymentIngestionRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LedgerRepository) private readonly ledger: PrismaLedgerRepository,
    @Inject(OutboxRepository) private readonly outbox: PrismaOutboxRepository
  ) {}

  async ingest(input: IngestPaymentInput): Promise<IngestPaymentResult> {
    return this.runIngest(input, (tx) =>
      input.splitId === null
        ? this.ingestUnmatched(tx, input)
        : this.ingestMatched(tx, input, input.splitId)
    );
  }

  async ingestSuspense(
    input: IngestPaymentInput,
    status: PaymentRecordStatus
  ): Promise<IngestPaymentResult> {
    return this.runIngest(input, (tx) => this.ingestUnmatched(tx, input, status));
  }

  async payFromWallet(input: PayFromWalletInput): Promise<IngestPaymentResult> {
    const nombaTransactionId = WALLET_TXREF_PREFIX + input.idempotencyKey;
    try {
      return await this.prisma.$transaction((tx) =>
        this.runPayFromWallet(tx, input, nombaTransactionId)
      );
    } catch (error) {
      if (this.isDuplicateTransaction(error)) {
        return this.replayWalletPayment(nombaTransactionId);
      }
      throw error;
    }
  }

  private async runPayFromWallet(
    tx: Prisma.TransactionClient,
    input: PayFromWalletInput,
    nombaTransactionId: string
  ): Promise<IngestPaymentResult> {
    const prior = await tx.payment.findUnique({
      where: { nombaTransactionId },
      include: { split: true }
    });
    if (prior !== null) {
      return this.walletPaymentResult(prior);
    }

    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.payerUserId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Pot" WHERE id = ${input.potId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Split" WHERE id = ${input.splitId} FOR UPDATE`;

    const lockedPrior = await tx.payment.findUnique({
      where: { nombaTransactionId },
      include: { split: true }
    });
    if (lockedPrior !== null) {
      return this.walletPaymentResult(lockedPrior);
    }

    const split = await tx.split.findUniqueOrThrow({ where: { id: input.splitId } });
    if (split.potId !== input.potId) {
      throw new HttpException("split does not belong to pot", HttpStatus.NOT_FOUND);
    }
    const pot = await tx.pot.findUniqueOrThrow({ where: { id: input.potId } });

    if (pot.status !== DbPotStatus.OPEN) {
      throw new HttpException("pot not open", HttpStatus.CONFLICT);
    }

    const shareKobo = Number(split.shareKobo);
    const priorPaidKobo = Number(split.paidKobo);
    const remainingKobo = shareKobo - priorPaidKobo;
    if (remainingKobo <= 0) {
      throw new HttpException("split already paid", HttpStatus.CONFLICT);
    }

    const amountKobo = input.amountKobo;
    if (amountKobo <= 0) {
      throw new HttpException("nothing to pay", HttpStatus.BAD_REQUEST);
    }

    const spendableKobo = await this.walletSpendableKobo(tx, input.payerUserId);
    if (spendableKobo < amountKobo) {
      throw new HttpException("insufficient wallet balance", HttpStatus.PAYMENT_REQUIRED);
    }

    const applied = applyPaymentToShare({ shareKobo, priorPaidKobo, amountKobo });
    const contribution = buildWalletContributionPosting({
      payerUserId: input.payerUserId,
      potId: input.potId,
      shareKobo,
      priorPaidKobo,
      amountKobo
    });

    const payment = await tx.payment.create({
      data: {
        potId: input.potId,
        splitId: input.splitId,
        nombaTransactionId,
        amountKobo: toAmountKoboBigInt(amountKobo),
        method: DbPaymentMethod.WALLET,
        senderName: input.payerName,
        senderAccount: null,
        senderBank: null,
        rawEventId: null,
        status: PaymentRecordStatus.Succeeded
      }
    });

    await this.ledger.record(contribution.posting, tx);

    await tx.user.update({
      where: { id: input.payerUserId },
      data: { walletBalanceKobo: { decrement: toAmountKoboBigInt(amountKobo) } }
    });

    const splitUpdate: Prisma.SplitUpdateInput = {
      paidKobo: toAmountKoboBigInt(applied.newPaidKobo)
    };
    if (applied.to !== applied.from) {
      splitUpdate.status = applied.to.toUpperCase() as DbShareStatus;
      splitUpdate.paidAt = new Date();
    }
    await tx.split.update({ where: { id: input.splitId }, data: splitUpdate });

    const newCollectedKobo = Number(pot.collectedKobo) + contribution.attributedKobo;
    await tx.pot.update({
      where: { id: input.potId },
      data: { collectedKobo: { increment: toAmountKoboBigInt(contribution.attributedKobo) } }
    });

    const siblings = await tx.split.findMany({
      where: { potId: input.potId },
      select: { status: true }
    });
    const shareStates = siblings.map((s) => s.status.toLowerCase() as ShareState);
    const funded = isPotFunded({
      completionRule: pot.completionRule.toLowerCase() as CompletionRule,
      collectedKobo: newCollectedKobo,
      targetKobo: Number(pot.targetKobo),
      shareStates
    });

    let didFund = false;
    if (funded && pot.status === DbPotStatus.OPEN) {
      assertPoolTransition(PoolState.Open, PoolState.Funded);
      await tx.pot.update({ where: { id: input.potId }, data: { status: DbPotStatus.FUNDED } });
      await this.outbox.enqueue(this.poolFunded(input.potId), tx);
      didFund = true;
    }

    await this.outbox.enqueue(
      this.paymentSucceeded(input.potId, input.splitId, amountKobo),
      tx
    );
    await this.outbox.enqueue(this.walletDebited(input.payerUserId, amountKobo, input.potId), tx);

    return {
      status: PaymentRecordStatus.Succeeded,
      paymentId: payment.id,
      potId: input.potId,
      splitId: input.splitId,
      attributedKobo: contribution.attributedKobo,
      excessKobo: contribution.excessKobo,
      funded: didFund,
      alreadyProcessed: false
    };
  }

  private async replayWalletPayment(nombaTransactionId: string): Promise<IngestPaymentResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { nombaTransactionId },
      include: { split: true }
    });
    if (payment === null) {
      throw new HttpException("wallet payment not found on replay", HttpStatus.CONFLICT);
    }
    return this.walletPaymentResult(payment);
  }

  private walletPaymentResult(
    payment: { id: string; potId: string; splitId: string | null; amountKobo: bigint; split: { shareKobo: bigint } | null }
  ): IngestPaymentResult {
    const amountKobo = Number(payment.amountKobo);
    const shareKobo = payment.split !== null ? Number(payment.split.shareKobo) : amountKobo;
    const attributedKobo = Math.min(shareKobo, amountKobo);
    return {
      status: PaymentRecordStatus.Succeeded,
      paymentId: payment.id,
      potId: payment.potId,
      splitId: payment.splitId,
      attributedKobo,
      excessKobo: amountKobo - attributedKobo,
      funded: false,
      alreadyProcessed: true
    };
  }

  private async walletSpendableKobo(
    tx: Prisma.TransactionClient,
    userId: string
  ): Promise<number> {
    const account = await tx.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind: LedgerAccountKind.UserWallet, ownerRef: userId } },
      select: { id: true }
    });
    if (account === null) {
      return 0;
    }
    const net = await this.ledger.balance(account.id, tx);
    return -net;
  }

  private async runIngest(
    input: IngestPaymentInput,
    body: (tx: Prisma.TransactionClient) => Promise<IngestPaymentResult>
  ): Promise<IngestPaymentResult> {
    try {
      return await this.prisma.$transaction(body);
    } catch (error) {
      if (this.isDuplicateTransaction(error)) {
        await this.markProcessedAfterRollback(input.webhookEventInId);
        return {
          status: PaymentRecordStatus.Succeeded,
          paymentId: null,
          potId: input.potId,
          splitId: input.splitId,
          attributedKobo: 0,
          excessKobo: 0,
          funded: false,
          alreadyProcessed: true
        };
      }
      throw error;
    }
  }

  private isDuplicateTransaction(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return false;
    }
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.some((field) => String(field).includes("nombaTransactionId"));
    }
    return typeof target === "string" && target.includes("nombaTransactionId");
  }

  private markProcessedAfterRollback(webhookEventInId: string): Promise<unknown> {
    return this.prisma.webhookEventIn.update({
      where: { id: webhookEventInId },
      data: { processedAt: new Date() }
    });
  }

  private async ingestUnmatched(
    tx: Prisma.TransactionClient,
    input: IngestPaymentInput,
    status: PaymentRecordStatus = PaymentRecordStatus.Unmatched
  ): Promise<IngestPaymentResult> {
    const potId = input.potId;
    await this.ledger.record(buildSuspensePosting({ potId, amountKobo: input.amountKobo }), tx);

    let paymentId: string | null = null;
    if (potId !== null) {
      const payment = await tx.payment.create({
        data: {
          potId,
          splitId: null,
          nombaTransactionId: input.nombaTransactionId,
          amountKobo: toAmountKoboBigInt(input.amountKobo),
          method: input.method.toUpperCase() as DbPaymentMethod,
          senderName: input.senderName,
          senderAccount: input.senderAccount,
          senderBank: input.senderBank,
          rawEventId: input.webhookEventInId,
          status
        }
      });
      paymentId = payment.id;
    }

    await this.markProcessed(tx, input.webhookEventInId);
    return {
      status,
      paymentId,
      potId,
      splitId: null,
      attributedKobo: 0,
      excessKobo: input.amountKobo,
      funded: false,
      alreadyProcessed: false
    };
  }

  private async ingestMatched(
    tx: Prisma.TransactionClient,
    input: IngestPaymentInput,
    splitId: string
  ): Promise<IngestPaymentResult> {
    const lockedSplit = await tx.split.findUniqueOrThrow({ where: { id: splitId } });
    const potId = lockedSplit.potId;
    await tx.$queryRaw`SELECT id FROM "Pot" WHERE id = ${potId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Split" WHERE id = ${splitId} FOR UPDATE`;
    const pot = await tx.pot.findUniqueOrThrow({ where: { id: potId } });
    const split = await tx.split.findUniqueOrThrow({ where: { id: splitId } });

    if (pot.status !== DbPotStatus.OPEN) {
      return this.ingestLate(tx, input, splitId, potId, pot.status);
    }

    const shareKobo = Number(split.shareKobo);
    const priorPaidKobo = Number(split.paidKobo);

    if (priorPaidKobo >= shareKobo) {
      return this.recordSuspenseOnly(tx, input, splitId, potId, PaymentRecordStatus.OverCollection);
    }

    const applied = applyPaymentToShare({ shareKobo, priorPaidKobo, amountKobo: input.amountKobo });
    const contribution = buildContributionPosting({
      potId,
      shareKobo,
      priorPaidKobo,
      amountKobo: input.amountKobo
    });

    const payment = await tx.payment.create({
      data: {
        potId,
        splitId,
        nombaTransactionId: input.nombaTransactionId,
        amountKobo: toAmountKoboBigInt(input.amountKobo),
        method: input.method.toUpperCase() as DbPaymentMethod,
        senderName: input.senderName,
        senderAccount: input.senderAccount,
        senderBank: input.senderBank,
        rawEventId: input.webhookEventInId,
        status: PaymentRecordStatus.Succeeded
      }
    });

    await this.ledger.record(contribution.posting, tx);

    const splitUpdate: Prisma.SplitUpdateInput = {
      paidKobo: toAmountKoboBigInt(applied.newPaidKobo)
    };
    if (applied.to !== applied.from) {
      splitUpdate.status = applied.to.toUpperCase() as DbShareStatus;
      splitUpdate.paidAt = new Date();
    }
    await tx.split.update({ where: { id: splitId }, data: splitUpdate });

    const newCollectedKobo = Number(pot.collectedKobo) + contribution.attributedKobo;
    await tx.pot.update({
      where: { id: potId },
      data: { collectedKobo: { increment: toAmountKoboBigInt(contribution.attributedKobo) } }
    });

    const siblings = await tx.split.findMany({ where: { potId }, select: { status: true } });
    const shareStates = siblings.map((s) => s.status.toLowerCase() as ShareState);
    const funded = isPotFunded({
      completionRule: pot.completionRule.toLowerCase() as CompletionRule,
      collectedKobo: newCollectedKobo,
      targetKobo: Number(pot.targetKobo),
      shareStates
    });

    let didFund = false;
    if (funded && pot.status === DbPotStatus.OPEN) {
      assertPoolTransition(PoolState.Open, PoolState.Funded);
      await tx.pot.update({ where: { id: potId }, data: { status: DbPotStatus.FUNDED } });
      await this.outbox.enqueue(this.poolFunded(potId), tx);
      didFund = true;
    }

    await this.outbox.enqueue(this.paymentSucceeded(potId, splitId, input.amountKobo), tx);
    await this.markProcessed(tx, input.webhookEventInId);

    return {
      status: PaymentRecordStatus.Succeeded,
      paymentId: payment.id,
      potId,
      splitId,
      attributedKobo: contribution.attributedKobo,
      excessKobo: contribution.excessKobo,
      funded: didFund,
      alreadyProcessed: false
    };
  }

  private ingestLate(
    tx: Prisma.TransactionClient,
    input: IngestPaymentInput,
    splitId: string,
    potId: string,
    potStatus: DbPotStatus
  ): Promise<IngestPaymentResult> {
    const status =
      potStatus === DbPotStatus.FUNDED
        ? PaymentRecordStatus.OverCollection
        : PaymentRecordStatus.PostTerminal;
    return this.recordSuspenseOnly(tx, input, splitId, potId, status);
  }

  private async recordSuspenseOnly(
    tx: Prisma.TransactionClient,
    input: IngestPaymentInput,
    splitId: string,
    potId: string,
    status: PaymentRecordStatus
  ): Promise<IngestPaymentResult> {
    const payment = await tx.payment.create({
      data: {
        potId,
        splitId,
        nombaTransactionId: input.nombaTransactionId,
        amountKobo: toAmountKoboBigInt(input.amountKobo),
        method: input.method.toUpperCase() as DbPaymentMethod,
        senderName: input.senderName,
        senderAccount: input.senderAccount,
        senderBank: input.senderBank,
        rawEventId: input.webhookEventInId,
        status
      }
    });

    await this.ledger.record(buildSuspensePosting({ potId, amountKobo: input.amountKobo }), tx);
    await this.outbox.enqueue(this.paymentSucceeded(potId, splitId, input.amountKobo), tx);
    await this.markProcessed(tx, input.webhookEventInId);

    return {
      status,
      paymentId: payment.id,
      potId,
      splitId,
      attributedKobo: 0,
      excessKobo: input.amountKobo,
      funded: false,
      alreadyProcessed: false
    };
  }

  private markProcessed(tx: Prisma.TransactionClient, webhookEventInId: string): Promise<unknown> {
    return tx.webhookEventIn.update({
      where: { id: webhookEventInId },
      data: { processedAt: new Date() }
    });
  }

  private paymentSucceeded(potId: string, splitId: string, amountKobo: number): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "payment.succeeded", potId, splitId, amountKobo },
      attempts: 0
    };
  }

  private poolFunded(potId: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "pool.funded", potId },
      attempts: 0
    };
  }

  private walletDebited(userId: string, amountKobo: number, potId: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: WALLET_OUTBOX_TARGET,
      event: { type: "wallet.debited", userId, amountKobo, reason: "split_payment", potId },
      attempts: 0
    };
  }
}
