import { SettlementFailureReason, SettlementType } from "@paadi/contracts";
import { PaymentProviderPort, TransferResult } from "@paadi/domain";
import { PrismaService, Tier as DbTier } from "@paadi/db";
import {
  BeginSettlementResult,
  SettlementContext,
  SettlementsRepository
} from "../../../infra/persistence/settlements.repository";
import { CryptoService } from "../../../common/crypto/crypto.service";
import { SettlementOutcomeRecorder, makeSettlementsFake } from "./settlements-fake";
import { BankPayoutStrategy } from "./bank-payout.strategy";

interface FakeUser {
  tier: DbTier;
  profile: { firstName: string; lastName: string } | null;
}

interface FakeAccount {
  userId: string;
  accountName: string;
  accountNumberEnc: string;
  bankCode: string;
  nameMatchVerified: boolean;
}

function context(overrides: Partial<SettlementContext> = {}): SettlementContext {
  return {
    potId: "pot-1",
    creatorId: "user-1",
    settlementType: SettlementType.BankPayout,
    collectedKobo: 5000000,
    feeKobo: 0,
    completionRule: "all_or_nothing",
    payoutAccountId: "acct-1",
    billerCategory: null,
    billerProductCode: null,
    billerCustomerId: null,
    meterType: null,
    billerMeta: {},
    ...overrides
  };
}

function begin(ctx: SettlementContext): BeginSettlementResult {
  return { settlementId: "stl-1", merchantTxRef: "settle:pot-1", alreadyTerminal: false, context: ctx };
}

function makePrisma(opts: { user: FakeUser; account: FakeAccount | null }) {
  return {
    user: { findUniqueOrThrow: jest.fn(async () => opts.user) },
    payoutAccount: { findUnique: jest.fn(async () => opts.account) }
  } as unknown as PrismaService;
}

function makeProvider(transfer: TransferResult) {
  const transferToBank = jest.fn(async () => transfer);
  return { provider: { transferToBank } as unknown as PaymentProviderPort, transferToBank };
}

const crypto = { decryptAccountNumber: jest.fn(() => "0102030405") } as unknown as CryptoService;

function verifiedAccount(overrides: Partial<FakeAccount> = {}): FakeAccount {
  return {
    userId: "user-1",
    accountName: "Ada Okeke",
    accountNumberEnc: "enc",
    bankCode: "058",
    nameMatchVerified: true,
    ...overrides
  };
}

function tier1User(): FakeUser {
  return { tier: DbTier.TIER_1, profile: { firstName: "Ada", lastName: "Okeke" } };
}

function build(opts: {
  user?: FakeUser;
  account?: FakeAccount | null;
  transfer?: TransferResult;
  recorder?: SettlementOutcomeRecorder;
}) {
  const recorder = opts.recorder ?? makeSettlementsFake();
  const prisma = makePrisma({
    user: opts.user ?? tier1User(),
    account: opts.account === undefined ? verifiedAccount() : opts.account
  });
  const { provider, transferToBank } = makeProvider(
    opts.transfer ?? { status: "success", reference: "nomba-ref-1" }
  );
  const strategy = new BankPayoutStrategy(
    recorder.repo as unknown as SettlementsRepository,
    prisma,
    provider,
    crypto
  );
  return { strategy, recorder, transferToBank, prisma };
}

describe("BankPayoutStrategy tier + account gating", () => {
  it("fails with kyc_tier_required and never transfers when the creator is tier 0", async () => {
    const { strategy, recorder, transferToBank } = build({
      user: { tier: DbTier.TIER_0, profile: { firstName: "Ada", lastName: "Okeke" } }
    });

    const result = await strategy.dispatch(begin(context()));

    expect(result.status).toBe("noop");
    expect(transferToBank).not.toHaveBeenCalled();
    expect(recorder.failCalls).toEqual([
      { potId: "pot-1", reason: SettlementFailureReason.KycTierRequired }
    ]);
    expect(recorder.finalizeCalls).toHaveLength(0);
  });

  it("allows tier 2 through the gate", async () => {
    const { strategy, transferToBank } = build({
      user: { tier: DbTier.TIER_2, profile: { firstName: "Ada", lastName: "Okeke" } }
    });

    await strategy.dispatch(begin(context()));

    expect(transferToBank).toHaveBeenCalledTimes(1);
  });

  it("fails with payout_account_invalid when no payout account is resolved", async () => {
    const { strategy, recorder, transferToBank } = build({ account: null });

    await strategy.dispatch(begin(context({ payoutAccountId: null })));

    expect(transferToBank).not.toHaveBeenCalled();
    expect(recorder.failCalls[0].reason).toBe(SettlementFailureReason.PayoutAccountInvalid);
  });

  it("fails with payout_account_invalid when the account is unverified", async () => {
    const { strategy, recorder, transferToBank } = build({
      account: verifiedAccount({ nameMatchVerified: false })
    });

    await strategy.dispatch(begin(context()));

    expect(transferToBank).not.toHaveBeenCalled();
    expect(recorder.failCalls[0].reason).toBe(SettlementFailureReason.PayoutAccountInvalid);
  });

  it("fails with payout_account_invalid when the account belongs to another user", async () => {
    const { strategy, recorder, transferToBank } = build({
      account: verifiedAccount({ userId: "someone-else" })
    });

    await strategy.dispatch(begin(context()));

    expect(transferToBank).not.toHaveBeenCalled();
    expect(recorder.failCalls[0].reason).toBe(SettlementFailureReason.PayoutAccountInvalid);
  });

  it("fails with name_mismatch when the resolved account name does not match the profile", async () => {
    const { strategy, recorder, transferToBank } = build({
      account: verifiedAccount({ accountName: "Bola Tinubu" })
    });

    await strategy.dispatch(begin(context()));

    expect(transferToBank).not.toHaveBeenCalled();
    expect(recorder.failCalls[0].reason).toBe(SettlementFailureReason.NameMismatch);
  });
});

describe("BankPayoutStrategy transfer-status handling", () => {
  it("on 200/success finalizes a settled outcome carrying the nomba reference", async () => {
    const { strategy, recorder, transferToBank } = build({
      transfer: { status: "success", reference: "nomba-ref-1" }
    });

    const result = await strategy.dispatch(begin(context({ collectedKobo: 5000000, feeKobo: 0 })));

    expect(result.status).toBe("settled");
    expect(transferToBank).toHaveBeenCalledWith(
      "0102030405",
      "Ada Okeke",
      "058",
      5000000,
      "settle:pot-1",
      "Paadi"
    );
    expect(recorder.finalizeCalls).toHaveLength(1);
    expect(recorder.finalizeCalls[0].outcome).toMatchObject({
      kind: "settled",
      netKobo: 5000000,
      nombaRef: "nomba-ref-1",
      providerStatus: "success"
    });
  });

  it("on 201/pending finalizes a pending stage-one outcome and reports awaiting_confirmation", async () => {
    const { strategy, recorder } = build({
      transfer: { status: "pending", reference: "nomba-ref-2" }
    });

    const result = await strategy.dispatch(begin(context()));

    expect(result.status).toBe("awaiting_confirmation");
    expect(recorder.finalizeCalls).toHaveLength(1);
    expect(recorder.finalizeCalls[0].outcome).toMatchObject({
      kind: "pending",
      nombaRef: "nomba-ref-2",
      providerStatus: "PENDING_BILLING"
    });
  });

  it("persists the transfer's returned id as nombaRef when present (the requery key for payout-confirm)", async () => {
    const { strategy, recorder } = build({
      transfer: { status: "pending", reference: "settle:pot-1", transferId: "transfer-9f3" }
    });

    await strategy.dispatch(begin(context()));

    expect(recorder.finalizeCalls[0].outcome).toMatchObject({
      kind: "pending",
      nombaRef: "transfer-9f3",
      providerStatus: "PENDING_BILLING"
    });
  });

  it("transfers net of the platform fee when feeKobo > 0", async () => {
    const { strategy, transferToBank } = build({});

    await strategy.dispatch(begin(context({ collectedKobo: 5000000, feeKobo: 10000 })));

    expect(transferToBank).toHaveBeenCalledWith(
      "0102030405",
      "Ada Okeke",
      "058",
      4990000,
      "settle:pot-1",
      "Paadi"
    );
  });

  it("fails with gateway and re-throws when the transfer call throws", async () => {
    const recorder = makeSettlementsFake();
    const prisma = makePrisma({ user: tier1User(), account: verifiedAccount() });
    const transferToBank = jest.fn(async () => {
      throw new Error("nomba 503");
    });
    const strategy = new BankPayoutStrategy(
      recorder.repo as unknown as SettlementsRepository,
      prisma,
      { transferToBank } as unknown as PaymentProviderPort,
      crypto
    );

    await expect(strategy.dispatch(begin(context()))).rejects.toThrow("nomba 503");
    expect(recorder.failCalls).toEqual([{ potId: "pot-1", reason: SettlementFailureReason.Gateway }]);
    expect(recorder.finalizeCalls).toHaveLength(0);
  });
});
