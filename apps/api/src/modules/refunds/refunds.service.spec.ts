import { PaymentProviderPort, RefundResult, RefundTransactionInput } from "@paadi/domain";
import {
  BeginRefundResult,
  RecordRefundInput,
  RefundTarget,
  RefundsRepository
} from "../../infra/persistence/refunds.repository";
import { RefundsService } from "./refunds.service";

function target(overrides: Partial<RefundTarget> = {}): RefundTarget {
  return {
    refundId: `rf-${overrides.paymentId ?? "1"}`,
    merchantTxRef: `refund:${overrides.paymentId ?? "p1"}`,
    paymentId: overrides.paymentId ?? "p1",
    nombaTransactionId: overrides.nombaTransactionId ?? "ntx-1",
    amountKobo: overrides.amountKobo ?? 300000,
    ...overrides
  };
}

interface RecorderState {
  refundCalls: RefundTransactionInput[];
  clearedCalls: RecordRefundInput[];
  failedCalls: { refundId: string; reason: string }[];
}

function makeRepo(targets: RefundTarget[]) {
  const state: RecorderState = { refundCalls: [], clearedCalls: [], failedCalls: [] };
  const repo = {
    beginRefund: jest.fn(async (potId: string): Promise<BeginRefundResult> => ({ potId, targets })),
    recordRefundCleared: jest.fn(async (input: RecordRefundInput) => {
      state.clearedCalls.push(input);
    }),
    recordRefundFailed: jest.fn(async (refundId: string, reason: string) => {
      state.failedCalls.push({ refundId, reason });
    })
  };
  return { repo: repo as unknown as RefundsRepository, state };
}

function makeProvider(impl: (input: RefundTransactionInput) => Promise<RefundResult>) {
  const refundTransaction = jest.fn(impl);
  return { provider: { refundTransaction } as unknown as PaymentProviderPort, refundTransaction };
}

describe("RefundsService.refundPot", () => {
  it("clears one refund per target against the original nombaTransactionId and tallies refunded", async () => {
    const targets = [
      target({ paymentId: "p1", nombaTransactionId: "ntx-1", amountKobo: 300000 }),
      target({ paymentId: "p2", nombaTransactionId: "ntx-2", amountKobo: 200000 })
    ];
    const { repo, state } = makeRepo(targets);
    const { provider, refundTransaction } = makeProvider(async (input) => ({
      success: true,
      nombaRef: `ref-${input.transactionId}`
    }));
    const service = new RefundsService(repo, provider);

    const result = await service.refundPot("pot-1", "deadline_missed");

    expect(result).toEqual({ potId: "pot-1", attempted: 2, refunded: 2, failed: 0 });
    expect(refundTransaction).toHaveBeenNthCalledWith(1, { transactionId: "ntx-1", amountKobo: 300000 });
    expect(refundTransaction).toHaveBeenNthCalledWith(2, { transactionId: "ntx-2", amountKobo: 200000 });
    expect(state.clearedCalls).toEqual([
      { potId: "pot-1", refundId: "rf-p1", nombaRef: "ref-ntx-1" },
      { potId: "pot-1", refundId: "rf-p2", nombaRef: "ref-ntx-2" }
    ]);
    expect(state.failedCalls).toHaveLength(0);
  });

  it("refunds an over-collecting payment for its full amount against the original transaction", async () => {
    const targets = [target({ paymentId: "p9", nombaTransactionId: "ntx-9", amountKobo: 350000 })];
    const { repo, state } = makeRepo(targets);
    const { provider, refundTransaction } = makeProvider(async () => ({ success: true, nombaRef: "ref-x" }));
    const service = new RefundsService(repo, provider);

    await service.refundPot("pot-2", "over_collection");

    expect(refundTransaction).toHaveBeenCalledWith({ transactionId: "ntx-9", amountKobo: 350000 });
    expect(state.clearedCalls).toEqual([{ potId: "pot-2", refundId: "rf-p9", nombaRef: "ref-x" }]);
  });

  it("marks a declined refund FAILED with provider_declined and counts it as failed", async () => {
    const targets = [target({ paymentId: "p1" })];
    const { repo, state } = makeRepo(targets);
    const { provider } = makeProvider(async () => ({ success: false }));
    const service = new RefundsService(repo, provider);

    const result = await service.refundPot("pot-3", "cancelled");

    expect(result).toEqual({ potId: "pot-3", attempted: 1, refunded: 0, failed: 1 });
    expect(state.failedCalls).toEqual([{ refundId: "rf-p1", reason: "provider_declined" }]);
    expect(state.clearedCalls).toHaveLength(0);
  });

  it("marks a thrown refund FAILED with gateway and continues with the remaining targets", async () => {
    const targets = [
      target({ paymentId: "p1", nombaTransactionId: "ntx-1" }),
      target({ paymentId: "p2", nombaTransactionId: "ntx-2" })
    ];
    const { repo, state } = makeRepo(targets);
    const refundTransaction = jest.fn(async (input: RefundTransactionInput) => {
      if (input.transactionId === "ntx-1") {
        throw new Error("nomba 500");
      }
      return { success: true, nombaRef: "ref-2" } as RefundResult;
    });
    const service = new RefundsService(
      repo,
      { refundTransaction } as unknown as PaymentProviderPort
    );

    const result = await service.refundPot("pot-4", "deadline_missed");

    expect(result).toEqual({ potId: "pot-4", attempted: 2, refunded: 1, failed: 1 });
    expect(state.failedCalls).toEqual([{ refundId: "rf-p1", reason: "gateway" }]);
    expect(state.clearedCalls).toEqual([{ potId: "pot-4", refundId: "rf-p2", nombaRef: "ref-2" }]);
  });

  it("no-ops cleanly when there are no refund targets (nothing collected)", async () => {
    const { repo } = makeRepo([]);
    const { provider, refundTransaction } = makeProvider(async () => ({ success: true }));
    const service = new RefundsService(repo, provider);

    const result = await service.refundPot("pot-5", "deadline_missed");

    expect(result).toEqual({ potId: "pot-5", attempted: 0, refunded: 0, failed: 0 });
    expect(refundTransaction).not.toHaveBeenCalled();
  });

  it("passes null nombaRef through when the provider omits a reference", async () => {
    const targets = [target({ paymentId: "p1" })];
    const { repo, state } = makeRepo(targets);
    const { provider } = makeProvider(async () => ({ success: true }));
    const service = new RefundsService(repo, provider);

    await service.refundPot("pot-6", "cancelled");

    expect(state.clearedCalls[0].nombaRef).toBeNull();
  });
});
