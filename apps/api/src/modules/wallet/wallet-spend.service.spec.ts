import { HttpException, UnauthorizedException } from "@nestjs/common";
import { PotStatus as DbPotStatus, ShareStatus as DbShareStatus } from "@paadi/db";
import { PaymentIngestionRepository } from "../../infra/persistence/payment-ingestion.repository";
import { PinService } from "../auth/pin/pin.service";
import { WalletSpendService } from "./wallet-spend.service";

const VALID_PIN = "1234";

interface FakeSplit {
  id: string;
  potId: string;
  label: string;
  shareKobo: bigint;
  paidKobo: bigint;
  status: DbShareStatus;
  weight: number;
  payToken: string;
  checkoutUrl: string | null;
  paidAt: Date | null;
}

interface FakePot {
  id: string;
  title: string;
  description: string | null;
  totalKobo: bigint;
  targetKobo: bigint;
  collectedKobo: bigint;
  settlementType: string;
  completionRule: string;
  status: DbPotStatus;
  billerCategory: string | null;
  billerProductCode: string | null;
  billerCustomerId: string | null;
  meterType: string | null;
  deadlineAt: Date | null;
  createdAt: Date;
}

const POT_ID = "pot-1";
const SPLIT_ID = "split-1";
const USER_ID = "user-1";

function makeSplit(overrides: Partial<FakeSplit> = {}): FakeSplit {
  return {
    id: SPLIT_ID,
    potId: POT_ID,
    label: "Ada",
    shareKobo: 250000n,
    paidKobo: 0n,
    status: DbShareStatus.PENDING,
    weight: 1,
    payToken: "tok-1",
    checkoutUrl: null,
    paidAt: null,
    ...overrides
  };
}

function makePot(overrides: Partial<FakePot> = {}): FakePot {
  return {
    id: POT_ID,
    title: "House Rent",
    description: null,
    totalKobo: 1000000n,
    targetKobo: 1000000n,
    collectedKobo: 0n,
    settlementType: "WALLET",
    completionRule: "PROGRESSIVE",
    status: DbPotStatus.OPEN,
    billerCategory: null,
    billerProductCode: null,
    billerCustomerId: null,
    meterType: null,
    deadlineAt: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides
  };
}

class FakePrisma {
  readonly split: {
    findUnique: (args: { where: { id: string } }) => Promise<FakeSplit | null>;
  };

  readonly pot: {
    findUnique: (args: { where: { id: string } }) => Promise<FakePot | null>;
    findUniqueOrThrow: (args: unknown) => Promise<FakePot & { splits: FakeSplit[] }>;
  };

  constructor(seedSplit: FakeSplit | null, seedPot: FakePot | null) {
    this.split = {
      findUnique: async () => seedSplit
    };
    this.pot = {
      findUnique: async () => seedPot,
      findUniqueOrThrow: async () => {
        if (seedPot === null) {
          throw new Error("pot not found");
        }
        return { ...seedPot, splits: seedSplit ? [seedSplit] : [] };
      }
    };
  }
}

function buildService(opts: {
  split: FakeSplit | null;
  pot: FakePot | null;
  payFromWallet?: jest.Mock;
  verifyPin?: jest.Mock;
}): { service: WalletSpendService; payFromWallet: jest.Mock; verifyPin: jest.Mock } {
  const prisma = new FakePrisma(opts.split, opts.pot);
  const payFromWallet =
    opts.payFromWallet ??
    jest.fn().mockResolvedValue({
      status: "succeeded",
      paymentId: "pay-1",
      potId: POT_ID,
      splitId: SPLIT_ID,
      attributedKobo: 250000,
      excessKobo: 0,
      funded: false,
      alreadyProcessed: false
    });
  const ingestion = { payFromWallet } as unknown as PaymentIngestionRepository;
  const verifyPin = opts.verifyPin ?? jest.fn().mockResolvedValue({ ok: true });
  const pin = { verify: verifyPin } as unknown as PinService;
  const service = new WalletSpendService(prisma as never, ingestion, pin);
  return { service, payFromWallet, verifyPin };
}

async function expectHttp(promise: Promise<unknown>, status: number, message: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(HttpException);
  await promise.catch((error: HttpException) => {
    expect(error.getStatus()).toBe(status);
    expect(error.message).toBe(message);
  });
}

describe("WalletSpendService.paySplitFromWallet (unit, hand-built fakes)", () => {
  it("routes to the wallet-source contribution with the full remaining share by default", async () => {
    const { service, payFromWallet, verifyPin } = buildService({
      split: makeSplit({ shareKobo: 250000n, paidKobo: 0n }),
      pot: makePot()
    });

    const result = await service.payFromWallet({
      userId: USER_ID,
      potId: POT_ID,
      splitId: SPLIT_ID,
      pin: VALID_PIN,
      idempotencyKey: "idem-1"
    });

    expect(verifyPin).toHaveBeenCalledWith(USER_ID, VALID_PIN);
    expect(payFromWallet).toHaveBeenCalledTimes(1);
    expect(payFromWallet).toHaveBeenCalledWith({
      payerUserId: USER_ID,
      potId: POT_ID,
      splitId: SPLIT_ID,
      amountKobo: 250000,
      idempotencyKey: "idem-1",
      payerName: null
    });
    expect(result.pot.id).toBe(POT_ID);
    expect(result.outcome.attributedKobo).toBe(250000);
  });

  it("rejects an invalid pin before any debit (ingestion never runs)", async () => {
    const verifyPin = jest.fn().mockRejectedValue(new UnauthorizedException("invalid pin"));
    const { service, payFromWallet } = buildService({
      split: makeSplit(),
      pot: makePot(),
      verifyPin
    });

    await expect(
      service.payFromWallet({
        userId: USER_ID,
        potId: POT_ID,
        splitId: SPLIT_ID,
        pin: "9999",
        idempotencyKey: "idem-bad-pin"
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(verifyPin).toHaveBeenCalledWith(USER_ID, "9999");
    expect(payFromWallet).not.toHaveBeenCalled();
  });

  it("pays only the remaining share when the split is partially paid", async () => {
    const { service, payFromWallet } = buildService({
      split: makeSplit({ shareKobo: 250000n, paidKobo: 100000n, status: DbShareStatus.PARTIALLY_PAID }),
      pot: makePot()
    });

    await service.payFromWallet({
      userId: USER_ID,
      potId: POT_ID,
      splitId: SPLIT_ID,
      pin: VALID_PIN,
      idempotencyKey: "idem-2"
    });

    expect(payFromWallet.mock.calls[0][0].amountKobo).toBe(150000);
  });

  it("honours an explicit amountKobo override (partial top-up)", async () => {
    const { service, payFromWallet } = buildService({
      split: makeSplit({ shareKobo: 250000n, paidKobo: 0n }),
      pot: makePot()
    });

    await service.payFromWallet({
      userId: USER_ID,
      potId: POT_ID,
      splitId: SPLIT_ID,
      amountKobo: 50000,
      pin: VALID_PIN,
      idempotencyKey: "idem-3"
    });

    expect(payFromWallet.mock.calls[0][0].amountKobo).toBe(50000);
  });

  it("rejects with 404 when the split does not belong to the pot", async () => {
    const { service, payFromWallet } = buildService({
      split: makeSplit({ potId: "other-pot" }),
      pot: makePot()
    });

    await expectHttp(
      service.payFromWallet({
        userId: USER_ID,
        potId: POT_ID,
        splitId: SPLIT_ID,
        pin: VALID_PIN,
        idempotencyKey: "k"
      }),
      404,
      "split not found"
    );
    expect(payFromWallet).not.toHaveBeenCalled();
  });

  it("rejects with 404 when the split is missing entirely", async () => {
    const { service, payFromWallet } = buildService({ split: null, pot: makePot() });

    await expectHttp(
      service.payFromWallet({
        userId: USER_ID,
        potId: POT_ID,
        splitId: SPLIT_ID,
        pin: VALID_PIN,
        idempotencyKey: "k"
      }),
      404,
      "split not found"
    );
    expect(payFromWallet).not.toHaveBeenCalled();
  });

  it("rejects with 409 pot not open when the pot has left the OPEN state (fail-fast, no debit)", async () => {
    const { service, payFromWallet } = buildService({
      split: makeSplit(),
      pot: makePot({ status: DbPotStatus.FUNDED })
    });

    await expectHttp(
      service.payFromWallet({
        userId: USER_ID,
        potId: POT_ID,
        splitId: SPLIT_ID,
        pin: VALID_PIN,
        idempotencyKey: "k"
      }),
      409,
      "pot not open"
    );
    expect(payFromWallet).not.toHaveBeenCalled();
  });

  it("rejects with 409 split already paid when there is no remaining share", async () => {
    const { service, payFromWallet } = buildService({
      split: makeSplit({ shareKobo: 250000n, paidKobo: 250000n, status: DbShareStatus.PAID }),
      pot: makePot()
    });

    await expectHttp(
      service.payFromWallet({
        userId: USER_ID,
        potId: POT_ID,
        splitId: SPLIT_ID,
        pin: VALID_PIN,
        idempotencyKey: "k"
      }),
      409,
      "split already paid"
    );
    expect(payFromWallet).not.toHaveBeenCalled();
  });

  it("rejects with 400 nothing to pay when an explicit amountKobo is non-positive", async () => {
    const { service, payFromWallet } = buildService({ split: makeSplit(), pot: makePot() });

    await expectHttp(
      service.payFromWallet({
        userId: USER_ID,
        potId: POT_ID,
        splitId: SPLIT_ID,
        amountKobo: 0,
        pin: VALID_PIN,
        idempotencyKey: "k"
      }),
      400,
      "nothing to pay"
    );
    expect(payFromWallet).not.toHaveBeenCalled();
  });

  it("propagates the insufficient-balance rejection raised by the ingestion transaction", async () => {
    const payFromWallet = jest.fn().mockRejectedValue(
      new HttpException("insufficient wallet balance", 402)
    );
    const { service } = buildService({ split: makeSplit(), pot: makePot(), payFromWallet });

    await expectHttp(
      service.payFromWallet({
        userId: USER_ID,
        potId: POT_ID,
        splitId: SPLIT_ID,
        pin: VALID_PIN,
        idempotencyKey: "k"
      }),
      402,
      "insufficient wallet balance"
    );
  });
});
