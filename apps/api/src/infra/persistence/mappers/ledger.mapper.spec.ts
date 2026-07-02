import { LedgerDirection } from "@paadi/domain";
import { toLedgerEntryView, LedgerEntryQueryRow } from "./ledger.mapper";

describe("toLedgerEntryView", () => {
  const row: LedgerEntryQueryRow = {
    entryId: "e1",
    transactionId: "t1",
    direction: LedgerDirection.Credit,
    amountKobo: 500000n,
    kind: "user_wallet",
    refType: "wallet_settlement",
    refId: "pot-1",
    memo: null,
    potId: "pot-1",
    occurredAt: new Date("2026-07-01T00:00:00Z")
  };

  it("carries potId through so statement/activity pot enrichment works", () => {
    const view = toLedgerEntryView(row, "user-1");
    expect(view.potId).toBe("pot-1");
    expect(view.ownerRef).toBe("user-1");
    expect(view.amountKobo).toBe(500000);
    expect(view.kind).toBe("user_wallet");
    expect(view.refType).toBe("wallet_settlement");
    expect(view.direction).toBe(LedgerDirection.Credit);
  });

  it("preserves a null potId for house/non-pot postings", () => {
    const view = toLedgerEntryView({ ...row, potId: null }, "house");
    expect(view.potId).toBeNull();
  });
});
