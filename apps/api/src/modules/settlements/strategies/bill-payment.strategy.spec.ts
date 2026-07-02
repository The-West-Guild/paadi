import { BillerCategory, MeterType, SettlementFailureReason, SettlementType } from "@paadi/contracts";
import { BillPaymentResult } from "@paadi/domain";
import {
  BeginSettlementResult,
  SettlementContext,
  SettlementsRepository
} from "../../../infra/persistence/settlements.repository";
import { BillerRegistry } from "../../../integrations/nomba/biller.registry";
import { SettlementOutcomeRecorder, makeSettlementsFake } from "./settlements-fake";
import { BillPaymentStrategy } from "./bill-payment.strategy";

function context(overrides: Partial<SettlementContext> = {}): SettlementContext {
  return {
    potId: "pot-1",
    creatorId: "user-1",
    settlementType: SettlementType.BillPayment,
    collectedKobo: 1800000,
    feeKobo: 0,
    completionRule: "progressive",
    payoutAccountId: null,
    billerCategory: BillerCategory.Electricity,
    billerProductCode: "ikeja",
    billerCustomerId: "0102030405",
    meterType: MeterType.Prepaid,
    billerMeta: { meterType: "PREPAID" },
    ...overrides
  };
}

function begin(ctx: SettlementContext): BeginSettlementResult {
  return { settlementId: "stl-1", merchantTxRef: "settle:pot-1", alreadyTerminal: false, context: ctx };
}

function makeBillers(result: BillPaymentResult, requiredFields: string[] = ["meterType"]) {
  const vend = jest.fn(async () => result);
  const adapter = { vend, requiredFields: () => requiredFields };
  const get = jest.fn(() => adapter);
  return { billers: { get } as unknown as BillerRegistry, vend, get, adapter };
}

function build(opts: {
  recorder?: SettlementOutcomeRecorder;
  result?: BillPaymentResult;
  requiredFields?: string[];
}) {
  const recorder = opts.recorder ?? makeSettlementsFake();
  const { billers, vend, get } = makeBillers(
    opts.result ?? { vendToken: "1234-5678-9012", units: "95.4" },
    opts.requiredFields
  );
  const strategy = new BillPaymentStrategy(
    recorder.repo as unknown as SettlementsRepository,
    billers
  );
  return { strategy, recorder, vend, get };
}

describe("BillPaymentStrategy", () => {
  it("vends with the net amount and captures electricity vendToken + vendUnits onto a settled outcome", async () => {
    const { strategy, recorder, vend } = build({ result: { vendToken: "1234-5678-9012", units: "95.4" } });

    const result = await strategy.dispatch(begin(context()));

    expect(result.status).toBe("settled");
    expect(vend).toHaveBeenCalledWith(
      { providerCode: "ikeja", customerId: "0102030405", meta: { meterType: "PREPAID" } },
      1800000,
      "settle:pot-1"
    );
    expect(recorder.finalizeCalls).toHaveLength(1);
    const outcome = recorder.finalizeCalls[0].outcome;
    expect(outcome.kind).toBe("settled");
    expect(outcome).toMatchObject({ netKobo: 1800000, vendToken: "1234-5678-9012", vendUnits: "95.4" });
    expect(recorder.failCalls).toHaveLength(0);
  });

  it("accepts a token-less cable vend by mapping the empty token to null", async () => {
    const { strategy, recorder } = build({ result: { vendToken: "" }, requiredFields: [] });

    await strategy.dispatch(
      begin(context({ billerCategory: BillerCategory.Cable, billerMeta: {}, meterType: null }))
    );

    const outcome = recorder.finalizeCalls[0].outcome;
    expect(outcome).toMatchObject({ vendToken: null, vendUnits: null });
  });

  it("nets the platform fee out of the vend amount when feeKobo > 0", async () => {
    const { strategy, vend } = build({});

    await strategy.dispatch(begin(context({ collectedKobo: 1800000, feeKobo: 5000 })));

    expect(vend).toHaveBeenCalledWith(expect.anything(), 1795000, "settle:pot-1");
  });

  it("fails with biller_fields_missing and does not vend when the category is absent", async () => {
    const { strategy, recorder, vend } = build({});

    const result = await strategy.dispatch(begin(context({ billerCategory: null })));

    expect(result.status).toBe("noop");
    expect(vend).not.toHaveBeenCalled();
    expect(recorder.failCalls).toEqual([
      { potId: "pot-1", reason: SettlementFailureReason.BillerFieldsMissing }
    ]);
  });

  it("fails with biller_fields_missing when a required meta field is missing", async () => {
    const { strategy, recorder, vend } = build({ requiredFields: ["meterType"] });

    const result = await strategy.dispatch(begin(context({ billerMeta: {} })));

    expect(result.status).toBe("noop");
    expect(vend).not.toHaveBeenCalled();
    expect(recorder.failCalls[0].reason).toBe(SettlementFailureReason.BillerFieldsMissing);
  });

  it("fails permanently when the structured product code or customer id is missing", async () => {
    const { strategy, recorder, vend } = build({});

    await strategy.dispatch(begin(context({ billerCustomerId: null })));

    expect(vend).not.toHaveBeenCalled();
    expect(recorder.failCalls[0].reason).toBe(SettlementFailureReason.BillerFieldsMissing);
  });

  it("fails with gateway and re-throws when the vend call throws (transient)", async () => {
    const recorder = makeSettlementsFake();
    const { billers, vend } = makeBillers({ vendToken: "x" });
    vend.mockRejectedValueOnce(new Error("nomba 502"));
    const strategy = new BillPaymentStrategy(
      recorder.repo as unknown as SettlementsRepository,
      billers
    );

    await expect(strategy.dispatch(begin(context()))).rejects.toThrow("nomba 502");
    expect(recorder.failCalls).toEqual([{ potId: "pot-1", reason: SettlementFailureReason.Gateway }]);
    expect(recorder.finalizeCalls).toHaveLength(0);
  });
});
