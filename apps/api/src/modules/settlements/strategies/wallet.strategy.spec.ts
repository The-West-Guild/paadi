import { SettlementType } from "@paadi/contracts";
import {
  BeginSettlementResult,
  SettlementContext,
  SettlementsRepository
} from "../../../infra/persistence/settlements.repository";
import { SettlementOutcomeRecorder, makeSettlementsFake } from "./settlements-fake";
import { WalletStrategy } from "./wallet.strategy";

function context(overrides: Partial<SettlementContext> = {}): SettlementContext {
  return {
    potId: "pot-1",
    creatorId: "user-1",
    settlementType: SettlementType.Wallet,
    collectedKobo: 1200000,
    feeKobo: 0,
    completionRule: "progressive",
    payoutAccountId: null,
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

function build(recorder?: SettlementOutcomeRecorder) {
  const rec = recorder ?? makeSettlementsFake();
  const strategy = new WalletStrategy(rec.repo as unknown as SettlementsRepository);
  return { strategy, recorder: rec };
}

describe("WalletStrategy", () => {
  it("finalizes a settled outcome with no external dispatch (pot_liability -> user_wallet move)", async () => {
    const { strategy, recorder } = build();

    const result = await strategy.dispatch(begin(context()));

    expect(result.status).toBe("settled");
    expect(recorder.finalizeCalls).toHaveLength(1);
    expect(recorder.finalizeCalls[0]).toMatchObject({ potId: "pot-1" });
    expect(recorder.finalizeCalls[0].outcome).toMatchObject({
      kind: "settled",
      netKobo: 1200000,
      vendToken: null,
      vendUnits: null,
      nombaRef: null,
      providerStatus: null
    });
    expect(recorder.failCalls).toHaveLength(0);
  });

  it("passes the net amount (collected minus fee) as the wallet credit", async () => {
    const { strategy, recorder } = build();

    await strategy.dispatch(begin(context({ collectedKobo: 1200000, feeKobo: 2000 })));

    expect(recorder.finalizeCalls[0].outcome.netKobo).toBe(1198000);
  });
});

describe("SettlementsService strategy selection", () => {
  it("routes each settlement type to its strategy and short-circuits an already-terminal pot", async () => {
    const billCalls: BeginSettlementResult[] = [];
    const bankCalls: BeginSettlementResult[] = [];
    const walletCalls: BeginSettlementResult[] = [];
    const dispatcher = (sink: BeginSettlementResult[]) => ({
      dispatch: jest.fn(async (b: BeginSettlementResult) => {
        sink.push(b);
        return { settlementId: b.settlementId, status: "settled" as const };
      })
    });
    const bill = dispatcher(billCalls);
    const bank = dispatcher(bankCalls);
    const wallet = dispatcher(walletCalls);

    const beginResults = new Map<string, BeginSettlementResult>([
      ["bill-pot", begin(context({ potId: "bill-pot", settlementType: SettlementType.BillPayment }))],
      ["bank-pot", begin(context({ potId: "bank-pot", settlementType: SettlementType.BankPayout }))],
      ["wallet-pot", begin(context({ potId: "wallet-pot", settlementType: SettlementType.Wallet }))],
      [
        "done-pot",
        {
          settlementId: "stl-done",
          merchantTxRef: "settle:done-pot",
          alreadyTerminal: true,
          context: context({ potId: "done-pot" })
        }
      ]
    ]);
    const settlements = {
      beginSettlement: jest.fn(async (potId: string) => beginResults.get(potId))
    };

    const { SettlementsService } = await import("../settlements.service");
    const service = new SettlementsService(
      settlements as never,
      bill as never,
      bank as never,
      wallet as never
    );

    expect((await service.settle("bill-pot", SettlementType.BillPayment)).status).toBe("settled");
    expect((await service.settle("bank-pot", SettlementType.BankPayout)).status).toBe("settled");
    expect((await service.settle("wallet-pot", SettlementType.Wallet)).status).toBe("settled");
    const noop = await service.settle("done-pot", SettlementType.BillPayment);

    expect(billCalls.map((b) => b.context.potId)).toEqual(["bill-pot"]);
    expect(bankCalls.map((b) => b.context.potId)).toEqual(["bank-pot"]);
    expect(walletCalls.map((b) => b.context.potId)).toEqual(["wallet-pot"]);
    expect(noop).toEqual({ settlementId: "stl-done", status: "noop" });
    expect(bill.dispatch).toHaveBeenCalledTimes(1);
  });
});
