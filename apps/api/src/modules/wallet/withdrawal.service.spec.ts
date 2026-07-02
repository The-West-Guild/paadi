import { HttpException } from "@nestjs/common";
import { SettlementFailureReason } from "@paadi/contracts";
import { Tier as DbTier, WithdrawalStatus as DbWithdrawalStatus } from "@paadi/db";
import type { PaymentProviderPort, TransferResult } from "@paadi/domain";
import type { PayoutAccountRepository } from "../../infra/persistence/payout-account.repository";
import type {
  RequestWithdrawalResult,
  WithdrawalRepository
} from "../../infra/persistence/withdrawal.repository";
import type { CryptoService } from "../../common/crypto/crypto.service";
import type { PinService } from "../auth/pin/pin.service";
import { WithdrawService } from "./withdrawal.service";

const USER_ID = "user-1";
const ACCOUNT_ID = "acct-1";
const WITHDRAWAL_ID = "wd-1";
const MERCHANT_TX_REF = "wd:idem-1";

interface FakeUser {
  id: string;
  tier: DbTier;
  profile: { firstName: string; lastName: string } | null;
}

interface FakeAccount {
  id: string;
  userId: string;
  bankCode: string;
  bankName: string;
  accountNumberEnc: string;
  accountNumberLast4: string;
  accountName: string;
  nameMatchVerified: boolean;
  isPrimary: boolean;
}

interface FakeWithdrawalRow {
  id: string;
  userId: string;
  payoutAccountId: string;
  amountKobo: bigint;
  feeKobo: bigint;
  status: DbWithdrawalStatus;
  nombaRef: string | null;
  providerStatus: string | null;
  failureReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: USER_ID,
    tier: DbTier.TIER_1,
    profile: { firstName: "Tunde", lastName: "Ade" },
    ...overrides
  };
}

function makeAccount(overrides: Partial<FakeAccount> = {}): FakeAccount {
  return {
    id: ACCOUNT_ID,
    userId: USER_ID,
    bankCode: "058",
    bankName: "Guaranty Trust Bank",
    accountNumberEnc: "enc-0123456789",
    accountNumberLast4: "6789",
    accountName: "Tunde Ade",
    nameMatchVerified: true,
    isPrimary: true,
    ...overrides
  };
}

function makeRow(overrides: Partial<FakeWithdrawalRow> = {}): FakeWithdrawalRow {
  return {
    id: WITHDRAWAL_ID,
    userId: USER_ID,
    payoutAccountId: ACCOUNT_ID,
    amountKobo: 600000n,
    feeKobo: 0n,
    status: DbWithdrawalStatus.PROCESSING,
    nombaRef: null,
    providerStatus: null,
    failureReason: null,
    createdAt: new Date("2026-06-25T00:00:00.000Z"),
    completedAt: null,
    ...overrides
  };
}

class FakePrisma {
  readonly user: {
    findUniqueOrThrow: (args: unknown) => Promise<FakeUser>;
  };

  readonly withdrawal: {
    findUnique: (args: unknown) => Promise<FakeWithdrawalRow | null>;
    findUniqueOrThrow: (args: unknown) => Promise<FakeWithdrawalRow>;
  };

  constructor(seedUser: FakeUser | null, row: FakeWithdrawalRow) {
    this.user = {
      findUniqueOrThrow: async () => {
        if (seedUser === null) {
          throw new Error("user not found");
        }
        return seedUser;
      }
    };
    this.withdrawal = {
      findUnique: async () => row,
      findUniqueOrThrow: async () => row
    };
  }
}

interface Harness {
  service: WithdrawService;
  requestWithdrawal: jest.Mock;
  confirmWithdrawal: jest.Mock;
  reverseWithdrawal: jest.Mock;
  markPending: jest.Mock;
  transferToBank: jest.Mock;
  queueAdd: jest.Mock;
  prisma: FakePrisma;
}

function buildHarness(opts: {
  user?: FakeUser | null;
  accounts?: FakeAccount[];
  requestResult?: Partial<RequestWithdrawalResult>;
  requestThrows?: HttpException;
  transfer?: TransferResult;
  transferThrows?: Error;
  finalRow?: FakeWithdrawalRow;
}): Harness {
  const user = opts.user === undefined ? makeUser() : opts.user;
  const accounts = opts.accounts ?? [makeAccount()];
  const row = opts.finalRow ?? makeRow();
  const prisma = new FakePrisma(user, row);

  const pin = { verify: jest.fn().mockResolvedValue({ ok: true }) } as unknown as PinService;

  const payoutAccounts = {
    listForUser: jest.fn().mockResolvedValue(accounts),
    findById: jest
      .fn()
      .mockImplementation(async (id: string) => accounts.find((a) => a.id === id) ?? null)
  } as unknown as PayoutAccountRepository;

  const crypto = {
    decryptAccountNumber: jest.fn().mockReturnValue("0123456789")
  } as unknown as CryptoService;

  const transferToBank = opts.transferThrows
    ? jest.fn().mockRejectedValue(opts.transferThrows)
    : jest.fn().mockResolvedValue(
        opts.transfer ?? { status: "success", reference: MERCHANT_TX_REF, transferId: "nomba-1" }
      );
  const provider = { transferToBank } as unknown as PaymentProviderPort;

  const requestWithdrawal = opts.requestThrows
    ? jest.fn().mockRejectedValue(opts.requestThrows)
    : jest.fn().mockResolvedValue({
        withdrawalId: WITHDRAWAL_ID,
        merchantTxRef: MERCHANT_TX_REF,
        amountKobo: 600000,
        feeKobo: 0,
        netKobo: 600000,
        status: DbWithdrawalStatus.PROCESSING,
        alreadyExisted: false,
        ...opts.requestResult
      });
  const confirmWithdrawal = jest.fn().mockResolvedValue(undefined);
  const reverseWithdrawal = jest.fn().mockResolvedValue(undefined);
  const markPending = jest.fn().mockResolvedValue(undefined);
  const withdrawals = {
    requestWithdrawal,
    confirmWithdrawal,
    reverseWithdrawal,
    markPending
  } as unknown as WithdrawalRepository;

  const queueAdd = jest.fn().mockResolvedValue(undefined);
  const payoutConfirm = { add: queueAdd } as never;

  const service = new WithdrawService(
    prisma as never,
    pin,
    payoutAccounts,
    crypto,
    provider,
    withdrawals,
    payoutConfirm
  );

  return {
    service,
    requestWithdrawal,
    confirmWithdrawal,
    reverseWithdrawal,
    markPending,
    transferToBank,
    queueAdd,
    prisma
  };
}

async function expectHttp(promise: Promise<unknown>, status: number, message: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(HttpException);
  await promise.catch((error: HttpException) => {
    expect(error.getStatus()).toBe(status);
    expect(error.message).toBe(message);
  });
}

describe("WithdrawService.withdraw (unit, hand-built fakes)", () => {
  it("on transfer success confirms the withdrawal immediately and returns a completed view", async () => {
    const h = buildHarness({
      transfer: { status: "success", reference: MERCHANT_TX_REF, transferId: "nomba-1" },
      finalRow: makeRow({ status: DbWithdrawalStatus.COMPLETED, nombaRef: "nomba-1", completedAt: new Date() })
    });

    const view = await h.service.withdraw(USER_ID, { amountKobo: 600000, pin: "1234" }, "idem-1");

    expect(h.transferToBank).toHaveBeenCalledTimes(1);
    expect(h.transferToBank).toHaveBeenCalledWith(
      "0123456789",
      "Tunde Ade",
      "058",
      600000,
      MERCHANT_TX_REF,
      "Paadi"
    );
    expect(h.confirmWithdrawal).toHaveBeenCalledWith(WITHDRAWAL_ID, {
      nombaRef: "nomba-1",
      providerStatus: "success"
    });
    expect(h.reverseWithdrawal).not.toHaveBeenCalled();
    expect(h.queueAdd).not.toHaveBeenCalled();
    expect(view.status).toBe("completed");
    expect(view.destination.bankName).toBe("Guaranty Trust Bank");
  });

  it("on a 201/pending transfer marks pending and enqueues the payout-confirm requery job", async () => {
    const h = buildHarness({
      transfer: { status: "pending", reference: MERCHANT_TX_REF, transferId: "nomba-2" },
      finalRow: makeRow({ status: DbWithdrawalStatus.PROCESSING, nombaRef: "nomba-2", providerStatus: "PENDING_BILLING" })
    });

    const view = await h.service.withdraw(USER_ID, { amountKobo: 600000, pin: "1234" }, "idem-1");

    expect(h.confirmWithdrawal).not.toHaveBeenCalled();
    expect(h.markPending).toHaveBeenCalledWith(WITHDRAWAL_ID, {
      nombaRef: "nomba-2",
      providerStatus: "PENDING_BILLING"
    });
    expect(h.queueAdd).toHaveBeenCalledTimes(1);
    expect(h.queueAdd.mock.calls[0][1]).toEqual({ kind: "withdrawal", id: WITHDRAWAL_ID });
    expect(view.status).toBe("processing");
  });

  it("on a dispatch error keeps stage-1 committed, marks pending, and enqueues confirm (never loses the debit)", async () => {
    const h = buildHarness({
      transferThrows: new Error("BAD_GATEWAY"),
      finalRow: makeRow({ status: DbWithdrawalStatus.PROCESSING, providerStatus: "PENDING_BILLING" })
    });

    const view = await h.service.withdraw(USER_ID, { amountKobo: 600000, pin: "1234" }, "idem-1");

    expect(h.markPending).toHaveBeenCalledWith(WITHDRAWAL_ID, {
      nombaRef: null,
      providerStatus: "PENDING_BILLING"
    });
    expect(h.queueAdd).toHaveBeenCalledTimes(1);
    expect(h.confirmWithdrawal).not.toHaveBeenCalled();
    expect(view.status).toBe("processing");
  });

  it("on a replayed idempotency key returns the existing withdrawal without a second transfer", async () => {
    const h = buildHarness({
      requestResult: { alreadyExisted: true, status: DbWithdrawalStatus.COMPLETED },
      finalRow: makeRow({ status: DbWithdrawalStatus.COMPLETED, nombaRef: "nomba-1", completedAt: new Date() })
    });

    const view = await h.service.withdraw(USER_ID, { amountKobo: 600000, pin: "1234" }, "idem-1");

    expect(h.transferToBank).not.toHaveBeenCalled();
    expect(h.confirmWithdrawal).not.toHaveBeenCalled();
    expect(h.markPending).not.toHaveBeenCalled();
    expect(view.status).toBe("completed");
  });

  it("rejects a TIER_0 user with 403 and never touches the transfer or the ledger", async () => {
    const h = buildHarness({ user: makeUser({ tier: DbTier.TIER_0 }) });

    await expectHttp(
      h.service.withdraw(USER_ID, { amountKobo: 600000, pin: "1234" }, "idem-1"),
      403,
      "kyc tier 1 required for withdrawal"
    );
    expect(h.requestWithdrawal).not.toHaveBeenCalled();
    expect(h.transferToBank).not.toHaveBeenCalled();
  });

  it("rejects when the resolved destination is not name-match-verified", async () => {
    const h = buildHarness({ accounts: [makeAccount({ nameMatchVerified: false })] });

    await expectHttp(
      h.service.withdraw(USER_ID, { amountKobo: 600000, pin: "1234" }, "idem-1"),
      403,
      "payout account not verified"
    );
    expect(h.requestWithdrawal).not.toHaveBeenCalled();
    expect(h.transferToBank).not.toHaveBeenCalled();
  });

  it("rejects when the account name does not match the profile (defence in depth after nameMatchVerified)", async () => {
    const h = buildHarness({
      user: makeUser({ profile: { firstName: "Someone", lastName: "Else" } }),
      accounts: [makeAccount({ accountName: "Tunde Ade", nameMatchVerified: true })]
    });

    await expectHttp(
      h.service.withdraw(USER_ID, { amountKobo: 600000, pin: "1234" }, "idem-1"),
      403,
      "payout account not verified"
    );
    expect(h.transferToBank).not.toHaveBeenCalled();
  });

  it("rejects with 400 when the user has no payout account on file", async () => {
    const h = buildHarness({ accounts: [] });

    await expectHttp(
      h.service.withdraw(USER_ID, { amountKobo: 600000, pin: "1234" }, "idem-1"),
      400,
      "no payout account"
    );
    expect(h.requestWithdrawal).not.toHaveBeenCalled();
  });

  it("propagates the insufficient-balance rejection raised inside the begin transaction", async () => {
    const h = buildHarness({
      requestThrows: new HttpException("insufficient wallet balance", 402)
    });

    await expectHttp(
      h.service.withdraw(USER_ID, { amountKobo: 600000, pin: "1234" }, "idem-1"),
      402,
      "insufficient wallet balance"
    );
    expect(h.transferToBank).not.toHaveBeenCalled();
  });

  it("verifies the PIN before doing anything else and aborts when it is wrong", async () => {
    const h = buildHarness({});
    (h.service as unknown as { pin: PinService }).pin = {
      verify: jest.fn().mockRejectedValue(new HttpException("invalid pin", 401))
    } as unknown as PinService;

    await expectHttp(
      h.service.withdraw(USER_ID, { amountKobo: 600000, pin: "0000" }, "idem-1"),
      401,
      "invalid pin"
    );
    expect(h.requestWithdrawal).not.toHaveBeenCalled();
    expect(h.transferToBank).not.toHaveBeenCalled();
  });
});

describe("WithdrawService confirm/reverse delegation", () => {
  it("confirmWithdrawal delegates to the repository with a SUCCESS provider status", async () => {
    const h = buildHarness({});
    await h.service.confirmWithdrawal(WITHDRAWAL_ID, "nomba-9");
    expect(h.confirmWithdrawal).toHaveBeenCalledWith(WITHDRAWAL_ID, {
      nombaRef: "nomba-9",
      providerStatus: "SUCCESS"
    });
  });

  it("reverseWithdrawal delegates to the repository with the failure reason", async () => {
    const h = buildHarness({});
    await h.service.reverseWithdrawal(WITHDRAWAL_ID, SettlementFailureReason.ProviderDeclined);
    expect(h.reverseWithdrawal).toHaveBeenCalledWith(
      WITHDRAWAL_ID,
      SettlementFailureReason.ProviderDeclined
    );
  });
});
