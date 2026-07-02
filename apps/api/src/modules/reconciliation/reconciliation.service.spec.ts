import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ExceptionResolutionAction, ResolveExceptionInput } from "@paadi/contracts";
import { PaymentProviderPort, TransferResult } from "@paadi/domain";
import { ReconciliationException } from "@paadi/db";
import {
  AssignExceptionInput,
  HoldExceptionInput,
  RefundExceptionInput,
  RefundResolution,
  ReconciliationRepository
} from "../../infra/persistence/reconciliation.repository";
import { ReconciliationService } from "./reconciliation.service";

function makeException(overrides: Partial<ReconciliationException> = {}): ReconciliationException {
  return {
    id: overrides.id ?? "exc-1",
    nombaTransactionId: overrides.nombaTransactionId ?? "ntx-1",
    amountKobo: overrides.amountKobo ?? 400000n,
    reason: overrides.reason ?? "UNKNOWN_ACCOUNT",
    status: overrides.status ?? "OPEN",
    senderName: overrides.senderName ?? "Ada Lovelace",
    senderAccount: overrides.senderAccount ?? "0123456789",
    senderBank: overrides.senderBank ?? "GTBank",
    senderBankCode: overrides.senderBankCode ?? null,
    vaAccountNumber: overrides.vaAccountNumber ?? null,
    suspenseOwnerRef: overrides.suspenseOwnerRef ?? "house",
    ledgerTxnId: overrides.ledgerTxnId ?? null,
    matchedUserId: overrides.matchedUserId ?? null,
    resolvedBy: overrides.resolvedBy ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    note: overrides.note ?? null,
    refundMerchantTxRef: overrides.refundMerchantTxRef ?? null,
    refundNombaRef: overrides.refundNombaRef ?? null,
    refundStatus: overrides.refundStatus ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-07-01T00:00:00.000Z")
  } as ReconciliationException;
}

interface RepoOverrides {
  findById?: ReconciliationException | null;
  assign?: (id: string, input: AssignExceptionInput) => Promise<ReconciliationException>;
  refund?: (id: string, input: RefundExceptionInput) => Promise<RefundResolution>;
  hold?: (id: string, input: HoldExceptionInput) => Promise<ReconciliationException>;
  recordRefundOutcome?: (
    id: string,
    input: { refundStatus: string; refundNombaRef?: string }
  ) => Promise<ReconciliationException>;
  reopenAfterFailedRefund?: (id: string) => Promise<ReconciliationException>;
}

function makeRepo(overrides: RepoOverrides = {}) {
  const repo = {
    findById: jest.fn(async () =>
      overrides.findById === undefined ? makeException() : overrides.findById
    ),
    assign: jest.fn(
      overrides.assign ??
        (async (id: string, input: AssignExceptionInput) =>
          makeException({ id, status: "RESOLVED", matchedUserId: input.userId, resolvedBy: input.resolvedBy }))
    ),
    refund: jest.fn(
      overrides.refund ??
        (async (id: string, input: RefundExceptionInput): Promise<RefundResolution> => ({
          exception: makeException({ id, status: "REFUNDED", refundStatus: "PENDING" }),
          merchantTxRef: `rcx_${id}`,
          senderAccount: input.senderAccount,
          bankCode: input.bankCode,
          senderName: input.senderName,
          amountKobo: 400000
        }))
    ),
    hold: jest.fn(
      overrides.hold ??
        (async (id: string, input: HoldExceptionInput) =>
          makeException({ id, status: "OPEN", note: input.note ?? null, matchedUserId: input.matchedUserId ?? null }))
    ),
    recordRefundOutcome: jest.fn(
      overrides.recordRefundOutcome ??
        (async (id: string, input: { refundStatus: string; refundNombaRef?: string }) =>
          makeException({ id, status: "REFUNDED", refundStatus: input.refundStatus, refundNombaRef: input.refundNombaRef ?? null }))
    ),
    reopenAfterFailedRefund: jest.fn(
      overrides.reopenAfterFailedRefund ??
        (async (id: string) =>
          makeException({ id, status: "OPEN", refundStatus: "FAILED", refundMerchantTxRef: null }))
    )
  };
  return repo;
}

function makeProvider(opts: {
  banks?: { code: string; name: string }[];
  transfer?: (merchantTxRef: string) => Promise<TransferResult>;
} = {}) {
  const listBanks = jest.fn(async () => opts.banks ?? []);
  const transferToBank = jest.fn(
    async (
      _accountNumber: string,
      _accountName: string,
      _bankCode: string,
      _amountKobo: number,
      merchantTxRef: string
    ) =>
      opts.transfer
        ? opts.transfer(merchantTxRef)
        : ({ status: "success", reference: merchantTxRef } as TransferResult)
  );
  return { listBanks, transferToBank };
}

function makeService(
  repo: ReturnType<typeof makeRepo>,
  provider: ReturnType<typeof makeProvider>
): ReconciliationService {
  return new ReconciliationService(
    repo as unknown as ReconciliationRepository,
    provider as unknown as PaymentProviderPort
  );
}

function body(overrides: Partial<ResolveExceptionInput>): ResolveExceptionInput {
  return { action: overrides.action ?? "hold", ...overrides } as ResolveExceptionInput;
}

describe("ReconciliationService.resolve", () => {
  it("throws 404 when the exception does not exist", async () => {
    const repo = makeRepo({ findById: null });
    const service = makeService(repo, makeProvider());

    await expect(
      service.resolve("missing", ExceptionResolutionAction.Hold, "admin-1", body({ action: "hold" }))
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.assign).not.toHaveBeenCalled();
    expect(repo.refund).not.toHaveBeenCalled();
    expect(repo.hold).not.toHaveBeenCalled();
  });

  it("surfaces the repository 409 when the row is no longer OPEN (assign)", async () => {
    const repo = makeRepo({
      findById: makeException({ status: "RESOLVED" }),
      assign: async () => {
        throw new ConflictException("exception already resolved");
      }
    });
    const service = makeService(repo, makeProvider());

    await expect(
      service.resolve("exc-1", ExceptionResolutionAction.Assign, "admin-1", body({ action: "assign", userId: "11111111-1111-1111-1111-111111111111" }))
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("throws 400 when assign is requested without a userId", async () => {
    const repo = makeRepo();
    const service = makeService(repo, makeProvider());

    await expect(
      service.resolve("exc-1", ExceptionResolutionAction.Assign, "admin-1", body({ action: "assign" }))
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.assign).not.toHaveBeenCalled();
  });

  it("assigns: delegates to repo.assign with userId/resolvedBy/note and returns the resolved DTO", async () => {
    const repo = makeRepo({ findById: makeException({ id: "exc-9", amountKobo: 700000n }) });
    const service = makeService(repo, makeProvider());

    const dto = await service.resolve(
      "exc-9",
      ExceptionResolutionAction.Assign,
      "admin-7",
      body({ action: "assign", userId: "22222222-2222-2222-2222-222222222222", note: "clearly Ada" })
    );

    expect(repo.assign).toHaveBeenCalledWith("exc-9", {
      userId: "22222222-2222-2222-2222-222222222222",
      resolvedBy: "admin-7",
      note: "clearly Ada"
    });
    expect(dto.status).toBe("RESOLVED");
    expect(dto.matchedUserId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("throws 409 (not refundable) when the exception has no sender account", async () => {
    const repo = makeRepo({ findById: makeException({ senderAccount: null }) });
    const service = makeService(repo, makeProvider());

    await expect(
      service.resolve("exc-1", ExceptionResolutionAction.Refund, "admin-1", body({ action: "refund" }))
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.refund).not.toHaveBeenCalled();
  });

  it("refunds: prefers an explicit bankCode, records the pending outcome, and transfers with rcx_<id>", async () => {
    const repo = makeRepo({ findById: makeException({ id: "exc-1", senderAccount: "0123456789", senderName: "Ada" }) });
    const provider = makeProvider();
    const service = makeService(repo, provider);

    const dto = await service.resolve(
      "exc-1",
      ExceptionResolutionAction.Refund,
      "admin-1",
      body({ action: "refund", bankCode: "058", note: "send it back" })
    );

    expect(provider.listBanks).not.toHaveBeenCalled();
    expect(repo.refund).toHaveBeenCalledWith("exc-1", {
      senderAccount: "0123456789",
      bankCode: "058",
      senderName: "Ada",
      resolvedBy: "admin-1",
      note: "send it back"
    });
    expect(provider.transferToBank).toHaveBeenCalledTimes(1);
    expect(provider.transferToBank).toHaveBeenCalledWith(
      "0123456789",
      "Ada",
      "058",
      400000,
      "rcx_exc-1",
      "Paadi Refund"
    );
    expect(repo.recordRefundOutcome).toHaveBeenCalledWith("exc-1", {
      refundStatus: "PENDING",
      refundNombaRef: "rcx_exc-1"
    });
    expect(dto.status).toBe("REFUNDED");
  });

  it("refunds: uses a captured senderBankCode when no explicit code is supplied", async () => {
    const repo = makeRepo({ findById: makeException({ senderBankCode: "044", senderBank: "Access" }) });
    const provider = makeProvider();
    const service = makeService(repo, provider);

    await service.resolve("exc-1", ExceptionResolutionAction.Refund, "admin-1", body({ action: "refund" }));

    expect(provider.listBanks).not.toHaveBeenCalled();
    expect(repo.refund).toHaveBeenCalledWith("exc-1", expect.objectContaining({ bankCode: "044" }));
  });

  it("refunds: maps a sender bank name to a code via listBanks (normalized) when no code is captured", async () => {
    const repo = makeRepo({ findById: makeException({ senderBank: "  GT  Bank ", senderBankCode: null }) });
    const provider = makeProvider({
      banks: [
        { code: "058", name: "GT Bank" },
        { code: "044", name: "Access Bank" }
      ]
    });
    const service = makeService(repo, provider);

    await service.resolve("exc-1", ExceptionResolutionAction.Refund, "admin-1", body({ action: "refund" }));

    expect(provider.listBanks).toHaveBeenCalledTimes(1);
    expect(repo.refund).toHaveBeenCalledWith("exc-1", expect.objectContaining({ bankCode: "058" }));
  });

  it("refunds: throws 409 when the bank name cannot be resolved to a code", async () => {
    const repo = makeRepo({ findById: makeException({ senderBank: "Unlisted MFB", senderBankCode: null }) });
    const provider = makeProvider({ banks: [{ code: "058", name: "GT Bank" }] });
    const service = makeService(repo, provider);

    await expect(
      service.resolve("exc-1", ExceptionResolutionAction.Refund, "admin-1", body({ action: "refund" }))
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.refund).not.toHaveBeenCalled();
    expect(provider.transferToBank).not.toHaveBeenCalled();
  });

  it("refunds: a thrown transfer compensates and reopens via reopenAfterFailedRefund (never a terminal REFUNDED)", async () => {
    const repo = makeRepo({ findById: makeException({ id: "exc-1", senderBankCode: "058" }) });
    const provider = makeProvider({
      transfer: async () => {
        throw new Error("nomba 500");
      }
    });
    const service = makeService(repo, provider);

    const dto = await service.resolve("exc-1", ExceptionResolutionAction.Refund, "admin-1", body({ action: "refund" }));

    expect(repo.refund).toHaveBeenCalledTimes(1);
    expect(repo.reopenAfterFailedRefund).toHaveBeenCalledWith("exc-1");
    expect(repo.recordRefundOutcome).not.toHaveBeenCalled();
    expect(dto.status).toBe("OPEN");
    expect(dto.refundStatus).toBe("FAILED");
  });

  it("refunds: a non-pending transfer status compensates and reopens (declined is a failure, not a success)", async () => {
    const repo = makeRepo({ findById: makeException({ id: "exc-1", senderBankCode: "058" }) });
    const provider = makeProvider({
      transfer: async (merchantTxRef: string) =>
        ({ status: "declined", reference: merchantTxRef } as TransferResult)
    });
    const service = makeService(repo, provider);

    const dto = await service.resolve("exc-1", ExceptionResolutionAction.Refund, "admin-1", body({ action: "refund" }));

    expect(repo.reopenAfterFailedRefund).toHaveBeenCalledWith("exc-1");
    expect(repo.recordRefundOutcome).not.toHaveBeenCalled();
    expect(dto.status).toBe("OPEN");
    expect(dto.refundStatus).toBe("FAILED");
  });

  it("refunds: a pending_billing transfer keeps the row REFUNDED and records the nomba reference", async () => {
    const repo = makeRepo({ findById: makeException({ id: "exc-1", senderBankCode: "058" }) });
    const provider = makeProvider({
      transfer: async () => ({ status: "PENDING_BILLING", reference: "nomba-ref-9" } as TransferResult)
    });
    const service = makeService(repo, provider);

    const dto = await service.resolve("exc-1", ExceptionResolutionAction.Refund, "admin-1", body({ action: "refund" }));

    expect(repo.reopenAfterFailedRefund).not.toHaveBeenCalled();
    expect(repo.recordRefundOutcome).toHaveBeenCalledWith("exc-1", {
      refundStatus: "PENDING",
      refundNombaRef: "nomba-ref-9"
    });
    expect(dto.status).toBe("REFUNDED");
  });

  it("refunds: passes an empty account name (not the narration) when senderName is null", async () => {
    const withoutSenderName = makeException({ id: "exc-1", senderAccount: "0123456789", senderBankCode: "058" });
    withoutSenderName.senderName = null;
    const repo = makeRepo({ findById: withoutSenderName });
    const provider = makeProvider();
    const service = makeService(repo, provider);

    await service.resolve("exc-1", ExceptionResolutionAction.Refund, "admin-1", body({ action: "refund" }));

    expect(repo.refund).toHaveBeenCalledWith("exc-1", expect.objectContaining({ senderName: "" }));
    expect(provider.transferToBank).toHaveBeenCalledWith(
      "0123456789",
      "",
      "058",
      400000,
      "rcx_exc-1",
      "Paadi Refund"
    );
  });

  it("holds: delegates to repo.hold (note + optional matched suggestion) and moves no money", async () => {
    const repo = makeRepo({ findById: makeException({ id: "exc-1" }) });
    const provider = makeProvider();
    const service = makeService(repo, provider);

    const dto = await service.resolve(
      "exc-1",
      ExceptionResolutionAction.Hold,
      "admin-3",
      body({ action: "hold", userId: "33333333-3333-3333-3333-333333333333", note: "investigating" })
    );

    expect(repo.hold).toHaveBeenCalledWith("exc-1", {
      resolvedBy: "admin-3",
      matchedUserId: "33333333-3333-3333-3333-333333333333",
      note: "investigating"
    });
    expect(repo.assign).not.toHaveBeenCalled();
    expect(repo.refund).not.toHaveBeenCalled();
    expect(provider.transferToBank).not.toHaveBeenCalled();
    expect(dto.status).toBe("OPEN");
  });
});

describe("ReconciliationService.listExceptions", () => {
  it("maps repo rows to DTOs and passes filters + totals through", async () => {
    const rows = [makeException({ id: "exc-a" }), makeException({ id: "exc-b" })];
    const list = jest.fn(async () => ({ items: rows, nextCursor: "exc-b" }));
    const totals = jest.fn(async () => ({ openCount: 2, openAmountKobo: 800000 }));
    const repo = { list, totals } as unknown as ReconciliationRepository;
    const service = new ReconciliationService(repo, makeProvider() as unknown as PaymentProviderPort);

    const result = await service.listExceptions({ status: "OPEN", limit: 50 });

    expect(list).toHaveBeenCalledWith({ status: "OPEN", reason: undefined, cursor: undefined, limit: 50 });
    expect(result.items.map((i) => i.id)).toEqual(["exc-a", "exc-b"]);
    expect(result.items[0].amountKobo).toBe(400000);
    expect(result.nextCursor).toBe("exc-b");
    expect(result.totals).toEqual({ openCount: 2, openAmountKobo: 800000 });
  });
});
