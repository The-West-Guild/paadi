import { LedgerDirection } from "./account";
import { LedgerPosting, PostingEntry, assertBalanced } from "./ledger";
import {
  buildExceptionAssignmentPosting,
  buildExceptionRefundPosting,
  buildPayoutClearedPosting,
  buildRefundClearedPosting,
  buildRefundPosting,
  buildSettlementPosting,
  buildWalletContributionPosting,
  buildWalletSettlementPosting,
  buildWithdrawalClearedPosting,
  buildWithdrawalPosting,
  buildWithdrawalReversePosting
} from "./posting";

function findLeg(posting: LedgerPosting, kind: string, ownerRef: string): PostingEntry | undefined {
  return posting.entries.find((e) => e.account.kind === kind && e.account.ownerRef === ownerRef);
}

describe("buildSettlementPosting", () => {
  it("debits pot_liability and credits settlement_payout for the net when no fee", () => {
    const posting = buildSettlementPosting({ potId: "P", netKobo: 18000, feeKobo: 0 });

    expect(posting.kind).toBe("settlement");
    expect(posting.potId).toBe("P");
    expect(posting.entries).toHaveLength(2);
    expect(findLeg(posting, "pot_liability", "P")).toEqual({
      account: { kind: "pot_liability", ownerRef: "P" },
      direction: LedgerDirection.Debit,
      amountKobo: 18000
    });
    expect(findLeg(posting, "settlement_payout", "house")).toEqual({
      account: { kind: "settlement_payout", ownerRef: "house" },
      direction: LedgerDirection.Credit,
      amountKobo: 18000
    });
    expect(findLeg(posting, "platform_fee", "house")).toBeUndefined();
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("adds a conditional platform_fee credit and debits pot_liability for net+fee", () => {
    const posting = buildSettlementPosting({ potId: "P", netKobo: 18000, feeKobo: 200 });

    expect(posting.entries).toHaveLength(3);
    expect(findLeg(posting, "pot_liability", "P")?.amountKobo).toBe(18200);
    expect(findLeg(posting, "settlement_payout", "house")?.amountKobo).toBe(18000);
    expect(findLeg(posting, "platform_fee", "house")).toEqual({
      account: { kind: "platform_fee", ownerRef: "house" },
      direction: LedgerDirection.Credit,
      amountKobo: 200
    });
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildPayoutClearedPosting", () => {
  it("debits settlement_payout and credits pooled_cash for the net (stage two)", () => {
    const posting = buildPayoutClearedPosting({ netKobo: 18000 });

    expect(posting.kind).toBe("payout_cleared");
    expect(posting.entries).toHaveLength(2);
    expect(findLeg(posting, "settlement_payout", "house")?.amountKobo).toBe(18000);
    expect(findLeg(posting, "pooled_cash", "house")?.amountKobo).toBe(18000);
    expect(findLeg(posting, "settlement_payout", "house")?.direction).toBe(LedgerDirection.Debit);
    expect(findLeg(posting, "pooled_cash", "house")?.direction).toBe(LedgerDirection.Credit);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildSettlementPosting + buildPayoutClearedPosting net to zero", () => {
  it("leaves settlement_payout flat once both stages post (no fee)", () => {
    const stage1 = buildSettlementPosting({ potId: "P", netKobo: 18000, feeKobo: 0 });
    const stage2 = buildPayoutClearedPosting({ netKobo: 18000 });
    const legs = [...stage1.entries, ...stage2.entries].filter(
      (e) => e.account.kind === "settlement_payout"
    );
    const net = legs.reduce(
      (acc, e) => acc + (e.direction === LedgerDirection.Credit ? e.amountKobo : -e.amountKobo),
      0
    );
    expect(net).toBe(0);
  });
});

describe("buildWalletSettlementPosting", () => {
  it("debits pot_liability and credits the creator's user_wallet (single stage)", () => {
    const posting = buildWalletSettlementPosting({ potId: "P", creatorId: "U", amountKobo: 18000 });

    expect(posting.kind).toBe("wallet_settlement");
    expect(posting.potId).toBe("P");
    expect(posting.entries).toHaveLength(2);
    expect(findLeg(posting, "pot_liability", "P")).toEqual({
      account: { kind: "pot_liability", ownerRef: "P" },
      direction: LedgerDirection.Debit,
      amountKobo: 18000
    });
    expect(findLeg(posting, "user_wallet", "U")).toEqual({
      account: { kind: "user_wallet", ownerRef: "U" },
      direction: LedgerDirection.Credit,
      amountKobo: 18000
    });
    expect(findLeg(posting, "settlement_payout", "house")).toBeUndefined();
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildRefundPosting", () => {
  it("debits pot_liability when the refund draws from the pot's held liability", () => {
    const posting = buildRefundPosting({ potId: "P", fromSuspense: false, amountKobo: 5000 });

    expect(posting.kind).toBe("refund");
    expect(posting.potId).toBe("P");
    expect(findLeg(posting, "pot_liability", "P")?.amountKobo).toBe(5000);
    expect(findLeg(posting, "exceptions_suspense", "P")).toBeUndefined();
    expect(findLeg(posting, "refunds_payable", "P")).toEqual({
      account: { kind: "refunds_payable", ownerRef: "P" },
      direction: LedgerDirection.Credit,
      amountKobo: 5000
    });
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("debits exceptions_suspense when fromSuspense draws the over-collection excess", () => {
    const posting = buildRefundPosting({ potId: "P", fromSuspense: true, amountKobo: 2000 });

    expect(findLeg(posting, "exceptions_suspense", "P")?.amountKobo).toBe(2000);
    expect(findLeg(posting, "exceptions_suspense", "P")?.direction).toBe(LedgerDirection.Debit);
    expect(findLeg(posting, "pot_liability", "P")).toBeUndefined();
    expect(findLeg(posting, "refunds_payable", "P")?.amountKobo).toBe(2000);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildRefundClearedPosting", () => {
  it("debits refunds_payable and credits pooled_cash for the net (stage two)", () => {
    const posting = buildRefundClearedPosting({ potId: "P", amountKobo: 5000 });

    expect(posting.kind).toBe("refund_cleared");
    expect(posting.potId).toBe("P");
    expect(findLeg(posting, "refunds_payable", "P")?.amountKobo).toBe(5000);
    expect(findLeg(posting, "refunds_payable", "P")?.direction).toBe(LedgerDirection.Debit);
    expect(findLeg(posting, "pooled_cash", "house")?.amountKobo).toBe(5000);
    expect(findLeg(posting, "pooled_cash", "house")?.direction).toBe(LedgerDirection.Credit);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildRefundPosting + buildRefundClearedPosting net to zero", () => {
  it("leaves refunds_payable flat once both refund stages post", () => {
    const stage1 = buildRefundPosting({ potId: "P", fromSuspense: false, amountKobo: 5000 });
    const stage2 = buildRefundClearedPosting({ potId: "P", amountKobo: 5000 });
    const legs = [...stage1.entries, ...stage2.entries].filter(
      (e) => e.account.kind === "refunds_payable"
    );
    const net = legs.reduce(
      (acc, e) => acc + (e.direction === LedgerDirection.Credit ? e.amountKobo : -e.amountKobo),
      0
    );
    expect(net).toBe(0);
  });
});

describe("buildExceptionAssignmentPosting", () => {
  it("debits house exceptions_suspense and credits the target user_wallet", () => {
    const posting = buildExceptionAssignmentPosting({ userId: "U", amountKobo: 400000 });

    expect(posting.kind).toBe("exception_assignment");
    expect(posting.potId).toBeNull();
    expect(posting.entries).toHaveLength(2);
    expect(findLeg(posting, "exceptions_suspense", "house")).toEqual({
      account: { kind: "exceptions_suspense", ownerRef: "house" },
      direction: LedgerDirection.Debit,
      amountKobo: 400000
    });
    expect(findLeg(posting, "user_wallet", "U")).toEqual({
      account: { kind: "user_wallet", ownerRef: "U" },
      direction: LedgerDirection.Credit,
      amountKobo: 400000
    });
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("draws the suspense leg from a pot-scoped owner when suspenseOwnerRef is supplied", () => {
    const posting = buildExceptionAssignmentPosting({
      userId: "U",
      amountKobo: 7500,
      suspenseOwnerRef: "pot-42"
    });

    expect(findLeg(posting, "exceptions_suspense", "pot-42")?.direction).toBe(LedgerDirection.Debit);
    expect(findLeg(posting, "exceptions_suspense", "house")).toBeUndefined();
    expect(findLeg(posting, "user_wallet", "U")?.amountKobo).toBe(7500);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildExceptionRefundPosting", () => {
  it("debits house exceptions_suspense and credits house pooled_cash (draws the pool back down)", () => {
    const posting = buildExceptionRefundPosting({ amountKobo: 250000 });

    expect(posting.kind).toBe("exception_refund");
    expect(posting.potId).toBeNull();
    expect(posting.entries).toHaveLength(2);
    expect(findLeg(posting, "exceptions_suspense", "house")).toEqual({
      account: { kind: "exceptions_suspense", ownerRef: "house" },
      direction: LedgerDirection.Debit,
      amountKobo: 250000
    });
    expect(findLeg(posting, "pooled_cash", "house")).toEqual({
      account: { kind: "pooled_cash", ownerRef: "house" },
      direction: LedgerDirection.Credit,
      amountKobo: 250000
    });
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("draws the suspense leg from a pot-scoped owner while crediting house pooled_cash", () => {
    const posting = buildExceptionRefundPosting({ amountKobo: 9000, suspenseOwnerRef: "pot-7" });

    expect(findLeg(posting, "exceptions_suspense", "pot-7")?.direction).toBe(LedgerDirection.Debit);
    expect(findLeg(posting, "exceptions_suspense", "house")).toBeUndefined();
    expect(findLeg(posting, "pooled_cash", "house")?.amountKobo).toBe(9000);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildWalletContributionPosting", () => {
  it("debits the payer user_wallet and credits pot_liability for the full share when exact, leaving pooled_cash untouched", () => {
    const { posting, attributedKobo, excessKobo } = buildWalletContributionPosting({
      payerUserId: "U",
      potId: "P",
      shareKobo: 250000,
      priorPaidKobo: 0,
      amountKobo: 250000
    });

    expect(posting.kind).toBe("wallet_contribution");
    expect(posting.potId).toBe("P");
    expect(attributedKobo).toBe(250000);
    expect(excessKobo).toBe(0);
    expect(posting.entries).toHaveLength(2);
    expect(findLeg(posting, "user_wallet", "U")).toEqual({
      account: { kind: "user_wallet", ownerRef: "U" },
      direction: LedgerDirection.Debit,
      amountKobo: 250000
    });
    expect(findLeg(posting, "pot_liability", "P")).toEqual({
      account: { kind: "pot_liability", ownerRef: "P" },
      direction: LedgerDirection.Credit,
      amountKobo: 250000
    });
    expect(findLeg(posting, "pooled_cash", "house")).toBeUndefined();
    expect(findLeg(posting, "exceptions_suspense", "P")).toBeUndefined();
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("attributes to the remaining share and parks the excess in exceptions_suspense on an overpay", () => {
    const { posting, attributedKobo, excessKobo } = buildWalletContributionPosting({
      payerUserId: "U",
      potId: "P",
      shareKobo: 300000,
      priorPaidKobo: 100000,
      amountKobo: 250000
    });

    expect(attributedKobo).toBe(200000);
    expect(excessKobo).toBe(50000);
    expect(posting.entries).toHaveLength(3);
    expect(findLeg(posting, "user_wallet", "U")?.amountKobo).toBe(250000);
    expect(findLeg(posting, "pot_liability", "P")?.amountKobo).toBe(200000);
    expect(findLeg(posting, "exceptions_suspense", "P")).toEqual({
      account: { kind: "exceptions_suspense", ownerRef: "P" },
      direction: LedgerDirection.Credit,
      amountKobo: 50000
    });
    expect(findLeg(posting, "pooled_cash", "house")).toBeUndefined();
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("routes the whole amount to exceptions_suspense when the share is already fully paid", () => {
    const { posting, attributedKobo, excessKobo } = buildWalletContributionPosting({
      payerUserId: "U",
      potId: "P",
      shareKobo: 100000,
      priorPaidKobo: 100000,
      amountKobo: 40000
    });

    expect(attributedKobo).toBe(0);
    expect(excessKobo).toBe(40000);
    expect(findLeg(posting, "pot_liability", "P")).toBeUndefined();
    expect(findLeg(posting, "exceptions_suspense", "P")?.amountKobo).toBe(40000);
    expect(findLeg(posting, "user_wallet", "U")?.amountKobo).toBe(40000);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildWithdrawalPosting", () => {
  it("debits user_wallet for net+fee and credits settlement_payout for net when no fee", () => {
    const posting = buildWithdrawalPosting({ userId: "U", netKobo: 600000, feeKobo: 0 });

    expect(posting.kind).toBe("withdrawal");
    expect(posting.potId).toBeNull();
    expect(posting.entries).toHaveLength(2);
    expect(findLeg(posting, "user_wallet", "U")).toEqual({
      account: { kind: "user_wallet", ownerRef: "U" },
      direction: LedgerDirection.Debit,
      amountKobo: 600000
    });
    expect(findLeg(posting, "settlement_payout", "house")).toEqual({
      account: { kind: "settlement_payout", ownerRef: "house" },
      direction: LedgerDirection.Credit,
      amountKobo: 600000
    });
    expect(findLeg(posting, "platform_fee", "house")).toBeUndefined();
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("adds a conditional platform_fee credit and debits user_wallet for net+fee when feeKobo > 0", () => {
    const posting = buildWithdrawalPosting({ userId: "U", netKobo: 600000, feeKobo: 5000 });

    expect(posting.entries).toHaveLength(3);
    expect(findLeg(posting, "user_wallet", "U")?.amountKobo).toBe(605000);
    expect(findLeg(posting, "settlement_payout", "house")?.amountKobo).toBe(600000);
    expect(findLeg(posting, "platform_fee", "house")).toEqual({
      account: { kind: "platform_fee", ownerRef: "house" },
      direction: LedgerDirection.Credit,
      amountKobo: 5000
    });
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildWithdrawalClearedPosting", () => {
  it("debits settlement_payout and credits pooled_cash for the net (stage two, cash truly leaves)", () => {
    const posting = buildWithdrawalClearedPosting({ netKobo: 600000 });

    expect(posting.kind).toBe("withdrawal_cleared");
    expect(posting.potId).toBeNull();
    expect(posting.entries).toHaveLength(2);
    expect(findLeg(posting, "settlement_payout", "house")?.amountKobo).toBe(600000);
    expect(findLeg(posting, "settlement_payout", "house")?.direction).toBe(LedgerDirection.Debit);
    expect(findLeg(posting, "pooled_cash", "house")?.amountKobo).toBe(600000);
    expect(findLeg(posting, "pooled_cash", "house")?.direction).toBe(LedgerDirection.Credit);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });
});

describe("buildWithdrawalPosting + buildWithdrawalClearedPosting net to zero", () => {
  it("leaves settlement_payout flat once both withdrawal stages post (no fee)", () => {
    const stage1 = buildWithdrawalPosting({ userId: "U", netKobo: 600000, feeKobo: 0 });
    const stage2 = buildWithdrawalClearedPosting({ netKobo: 600000 });
    const legs = [...stage1.entries, ...stage2.entries].filter(
      (e) => e.account.kind === "settlement_payout"
    );
    const net = legs.reduce(
      (acc, e) => acc + (e.direction === LedgerDirection.Credit ? e.amountKobo : -e.amountKobo),
      0
    );
    expect(net).toBe(0);
  });
});

describe("buildWithdrawalReversePosting", () => {
  it("debits settlement_payout and credits the user_wallet for net when no fee (un-earmark)", () => {
    const posting = buildWithdrawalReversePosting({ userId: "U", netKobo: 600000, feeKobo: 0 });

    expect(posting.kind).toBe("withdrawal_reversed");
    expect(posting.potId).toBeNull();
    expect(posting.entries).toHaveLength(2);
    expect(findLeg(posting, "settlement_payout", "house")).toEqual({
      account: { kind: "settlement_payout", ownerRef: "house" },
      direction: LedgerDirection.Debit,
      amountKobo: 600000
    });
    expect(findLeg(posting, "user_wallet", "U")).toEqual({
      account: { kind: "user_wallet", ownerRef: "U" },
      direction: LedgerDirection.Credit,
      amountKobo: 600000
    });
    expect(findLeg(posting, "platform_fee", "house")).toBeUndefined();
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("debits the platform_fee leg alongside settlement_payout and credits user_wallet for net+fee when feeKobo > 0", () => {
    const posting = buildWithdrawalReversePosting({ userId: "U", netKobo: 600000, feeKobo: 5000 });

    expect(posting.entries).toHaveLength(3);
    expect(findLeg(posting, "settlement_payout", "house")?.amountKobo).toBe(600000);
    expect(findLeg(posting, "platform_fee", "house")).toEqual({
      account: { kind: "platform_fee", ownerRef: "house" },
      direction: LedgerDirection.Debit,
      amountKobo: 5000
    });
    expect(findLeg(posting, "user_wallet", "U")?.amountKobo).toBe(605000);
    expect(() => assertBalanced(posting.entries)).not.toThrow();
  });

  it("round-trips: withdrawal then reverse returns user_wallet to its pre-withdraw net (fee included)", () => {
    const hold = buildWithdrawalPosting({ userId: "U", netKobo: 600000, feeKobo: 5000 });
    const reverse = buildWithdrawalReversePosting({ userId: "U", netKobo: 600000, feeKobo: 5000 });
    const walletLegs = [...hold.entries, ...reverse.entries].filter(
      (e) => e.account.kind === "user_wallet"
    );
    const walletNet = walletLegs.reduce(
      (acc, e) => acc + (e.direction === LedgerDirection.Credit ? e.amountKobo : -e.amountKobo),
      0
    );
    const payoutLegs = [...hold.entries, ...reverse.entries].filter(
      (e) => e.account.kind === "settlement_payout"
    );
    const payoutNet = payoutLegs.reduce(
      (acc, e) => acc + (e.direction === LedgerDirection.Credit ? e.amountKobo : -e.amountKobo),
      0
    );
    expect(walletNet).toBe(0);
    expect(payoutNet).toBe(0);
  });
});
