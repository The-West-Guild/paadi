import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import type {
  CreatePotInput,
  ListPotsQuery,
  ListPotsResponse,
  PayView,
  PoolState,
  PotDetail,
  UpdatePotInput,
} from "@paadi/contracts";
import { $Enums } from "@paadi/db";
import {
  IdempotencyStore,
  Money,
  PaymentProviderPort,
  assertPoolTransition,
  normalizeToWeights,
  requestHash,
  splitByWeight,
  type SplitBasis,
} from "@paadi/domain";
import { CryptoService } from "../../common/crypto/crypto.service";
import { PayoutAccountRepository } from "../../infra/persistence/payout-account.repository";
import { PotRepository } from "../../infra/persistence/pot.repository";
import {
  toPayView,
  toPotDetail,
  toPotSummary,
} from "../../infra/persistence/mappers/pot.mapper";

const SCOPE = "pots:create";
const DEFAULT_DEADLINE_MS = 7 * 86_400_000;

interface PartialRecord {
  __partial: true;
  potId: string;
}

function isPartialRecord(value: unknown): value is PartialRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "__partial" in value &&
    typeof (value as { potId?: unknown }).potId === "string"
  );
}

function isPotDetailRecord(value: unknown): value is PotDetail {
  return (
    typeof value === "object" &&
    value !== null &&
    "splits" in value &&
    "id" in value &&
    !("__partial" in value)
  );
}

@Injectable()
export class PotsService {
  constructor(
    private readonly pots: PotRepository,
    private readonly provider: PaymentProviderPort,
    private readonly idempotency: IdempotencyStore,
    private readonly payoutAccounts: PayoutAccountRepository,
    private readonly crypto: CryptoService,
  ) {}

  async create(
    creatorId: string,
    input: CreatePotInput,
    idempotencyKey: string,
  ): Promise<PotDetail> {
    const key = `${SCOPE}:${creatorId}:${idempotencyKey}`;
    const hash = requestHash({ method: "POST", path: "/pots", body: input });

    const prior = await this.idempotency.getResult(key);
    if (prior) {
      if (prior.requestHash !== hash) {
        throw new ConflictException(
          "idempotency key reused with different payload",
        );
      }
      if (isPotDetailRecord(prior.response)) {
        return prior.response;
      }
      if (isPartialRecord(prior.response)) {
        return this.finalize(creatorId, prior.response.potId, key, hash);
      }
    }

    const deadlineAt = this.resolveDeadline(input);
    const payoutAccountId = await this.resolvePayoutAccount(creatorId, input);
    const { weights, shares } = this.computeShares(input);

    const fresh = await this.idempotency.remember({
      key,
      scope: SCOPE,
      requestHash: hash,
    });
    if (!fresh) {
      const raced = await this.idempotency.getResult(key);
      if (!raced || raced.requestHash !== hash) {
        throw new ConflictException(
          "idempotency key reused with different payload",
        );
      }
      if (isPotDetailRecord(raced.response)) {
        return raced.response;
      }
      if (isPartialRecord(raced.response)) {
        return this.finalize(creatorId, raced.response.potId, key, hash);
      }
      throw new ConflictException("pot creation already in progress");
    }

    const pot = await this.pots.createPotWithSplits({
      creatorId,
      title: input.title,
      description: input.description ?? null,
      totalKobo: input.totalKobo,
      targetKobo: input.totalKobo,
      settlementType:
        input.settlementType.toUpperCase() as $Enums.SettlementType,
      completionRule:
        input.completionRule.toUpperCase() as $Enums.CompletionRule,
      attributionMode:
        input.attributionMode.toUpperCase() as $Enums.AttributionMode,
      billerCategory: input.billerCategory
        ? (input.billerCategory.toUpperCase() as $Enums.BillerCategory)
        : null,
      billerProductCode: input.billerProductCode ?? null,
      billerCustomerId: input.billerCustomerId ?? null,
      meterType: (input.meterType ?? null) as $Enums.MeterType | null,
      payoutAccountId,
      deadlineAt,
      splits: input.splits.map((s, i) => ({
        label: s.label,
        weight: weights[i],
        shareKobo: shares[i],
        phoneEnc: s.phone ? this.encryptPhoneMaybe(s.phone) : null,
      })),
    });

    await this.idempotency.remember({
      key,
      scope: SCOPE,
      requestHash: hash,
      response: { __partial: true, potId: pot.id },
    });

    return this.finalize(creatorId, pot.id, key, hash);
  }

  async list(
    creatorId: string,
    query: ListPotsQuery,
  ): Promise<ListPotsResponse> {
    const status = query.status
      ? (query.status.toUpperCase() as $Enums.PotStatus)
      : undefined;
    const { items, nextCursor } = await this.pots.listForCreator(
      creatorId,
      query.cursor,
      query.limit,
      status,
    );
    return { items: items.map(toPotSummary), nextCursor };
  }

  async findOne(potId: string, creatorId: string): Promise<PotDetail> {
    const pot = await this.pots.findByIdForCreator(potId, creatorId);
    if (!pot) {
      throw new NotFoundException("pot not found");
    }
    const contributions = await this.pots.contributionsSummary(potId);
    return toPotDetail(pot, contributions);
  }

  async getPayerView(token: string): Promise<PayView> {
    const split = await this.pots.findByPayToken(token);
    if (!split) {
      throw new NotFoundException("pay link not found");
    }
    return toPayView(split);
  }

  async update(
    potId: string,
    creatorId: string,
    patch: UpdatePotInput,
  ): Promise<PotDetail> {
    const pot = await this.pots.findByIdForCreator(potId, creatorId);
    if (!pot) {
      throw new NotFoundException("pot not found");
    }
    if (pot.collectedKobo !== 0n || (await this.pots.hasPayments(potId))) {
      throw new ConflictException("pot has payments, cannot edit");
    }
    if (pot.status !== "OPEN" && pot.status !== "DRAFT") {
      throw new BadRequestException(
        `pot not editable in status ${pot.status.toLowerCase()}`,
      );
    }
    const updated = await this.pots.update(potId, {
      title: patch.title,
      description: patch.description,
      deadlineAt: patch.deadlineAt ? new Date(patch.deadlineAt) : undefined,
    });
    return toPotDetail(updated);
  }

  async delete(potId: string, creatorId: string): Promise<{ ok: boolean }> {
    const pot = await this.pots.findByIdForCreator(potId, creatorId);
    if (!pot) {
      throw new NotFoundException("pot not found");
    }
    if (await this.pots.hasPayments(potId)) {
      throw new ConflictException("pot has payments, cancel instead");
    }
    if (pot.status !== "DRAFT" && pot.status !== "OPEN") {
      throw new ConflictException(
        `pot cannot be deleted in status ${pot.status.toLowerCase()}`,
      );
    }
    const ok = await this.pots.deleteIfNoPayments(potId);
    if (!ok) {
      throw new ConflictException("pot has payments, cancel instead");
    }
    return { ok: true };
  }

  async cancel(potId: string, creatorId: string): Promise<PotDetail> {
    const pot = await this.pots.findByIdForCreator(potId, creatorId);
    if (!pot) {
      throw new NotFoundException("pot not found");
    }
    try {
      assertPoolTransition(pot.status.toLowerCase() as PoolState, "cancelled");
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const cancelled = await this.pots.cancel(potId);
    return toPotDetail(cancelled);
  }

  private async finalize(
    creatorId: string,
    potId: string,
    key: string,
    hash: string,
  ): Promise<PotDetail> {
    const pot = await this.pots.findByIdForCreator(potId, creatorId);
    if (!pot) {
      throw new NotFoundException("pot not found");
    }

    for (const split of pot.splits) {
      if (split.checkoutOrderRef) {
        continue;
      }
      let order;
      try {
        order = await this.provider.createCheckoutOrder(
          Number(split.shareKobo),
          `paadi-${split.id}`,
        );
      } catch {
        throw new HttpException(
          "checkout provider unavailable",
          HttpStatus.BAD_GATEWAY,
        );
      }
      await this.pots.setCheckout(
        split.id,
        order.reference,
        order.checkoutLink,
      );
    }

    let finalPot = pot;
    if (pot.status === "DRAFT") {
      assertPoolTransition("draft", "open");
      finalPot = await this.pots.markOpen(potId);
    } else {
      const reloaded = await this.pots.findByIdForCreator(potId, creatorId);
      if (reloaded) {
        finalPot = reloaded;
      }
    }

    const detail = toPotDetail(finalPot);
    await this.idempotency.remember({
      key,
      scope: SCOPE,
      requestHash: hash,
      response: detail,
    });
    return detail;
  }

  private resolveDeadline(input: CreatePotInput): Date {
    if (input.deadlineAt) {
      const deadline = new Date(input.deadlineAt);
      if (deadline.getTime() <= Date.now()) {
        throw new BadRequestException("deadline must be in the future");
      }
      return deadline;
    }
    return new Date(Date.now() + DEFAULT_DEADLINE_MS);
  }

  private async resolvePayoutAccount(
    creatorId: string,
    input: CreatePotInput,
  ): Promise<string | null> {
    if (input.settlementType !== "bank_payout") {
      return null;
    }
    let account;
    if (input.payoutAccountId) {
      account = await this.payoutAccounts.findById(input.payoutAccountId);
      if (!account || account.userId !== creatorId) {
        throw new NotFoundException("payout account not found");
      }
    } else {
      const accounts = await this.payoutAccounts.listForUser(creatorId);
      account = accounts.find((a) => a.isPrimary) ?? null;
      if (!account) {
        throw new BadRequestException("no payout account on file");
      }
    }
    if (!account.nameMatchVerified) {
      throw new ForbiddenException("payout account not name-verified");
    }
    return account.id;
  }

  private computeShares(input: CreatePotInput): {
    weights: number[];
    shares: number[];
  } {
    const basis = this.toBasis(input);
    const weights = normalizeToWeights(basis, input.totalKobo);
    const shares = splitByWeight(input.totalKobo, weights);
    const sum = shares.reduce((acc, share) => acc + share, 0);
    if (!Money.fromKobo(sum).eq(Money.fromKobo(input.totalKobo))) {
      throw new Error("computed shares do not sum to totalKobo");
    }
    if (shares.some((share) => share === 0)) {
      throw new BadRequestException(
        `totalKobo too small to split across ${shares.length} participants`,
      );
    }
    return { weights, shares };
  }

  private encryptPhoneMaybe(raw: string): string | null {
    const parsed = parsePhoneNumberFromString(raw, "NG");
    if (!parsed || !parsed.isValid()) {
      return null;
    }
    return this.crypto.encryptPhone(parsed.number);
  }

  private toBasis(input: CreatePotInput): SplitBasis {
    switch (input.splitMode) {
      case "amount":
        return {
          kind: "amount",
          amountsKobo: input.splits.map((s) => s.amountKobo as number),
        };
      case "percent":
        return {
          kind: "percent",
          percents: input.splits.map((s) => s.percent as number),
        };
      default:
        return {
          kind: "weight",
          weights: input.splits.map((s) => s.weight as number),
        };
    }
  }
}
