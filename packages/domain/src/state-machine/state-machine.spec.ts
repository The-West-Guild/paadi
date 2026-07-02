import { CompletionRule, PoolState, ShareState } from "@paadi/contracts";
import {
  assertPoolTransition,
  canTransitionPool,
} from "./pool";
import {
  assertShareTransition,
  canTransitionShare,
} from "./share";
import { applyPaymentToShare, isPotFunded, nextShareState } from "./decide";

const poolAllowed: Record<PoolState, PoolState[]> = {
  draft: ["open", "cancelled"],
  open: ["funded", "expired", "cancelled"],
  funded: ["settling", "refunding"],
  settling: ["settled", "funded"],
  settled: [],
  expired: ["refunding"],
  cancelled: ["refunding"],
  refunding: ["refunded"],
  refunded: [],
};

const shareAllowed: Record<ShareState, ShareState[]> = {
  pending: ["paid", "partially_paid", "overpaid", "expired"],
  partially_paid: ["paid", "overpaid", "expired"],
  paid: ["overpaid", "refunded"],
  overpaid: ["refunded"],
  expired: [],
  refunded: [],
};

describe("pool transition map", () => {
  const states = Object.values(PoolState);

  it("matches the §4.4.1 map for every (from,to) pair", () => {
    for (const from of states) {
      for (const to of states) {
        expect(canTransitionPool(from, to)).toBe(
          poolAllowed[from].includes(to),
        );
      }
    }
  });

  it("asserts legal edges silently and throws the exact message on illegal edges", () => {
    for (const from of states) {
      for (const to of states) {
        if (poolAllowed[from].includes(to)) {
          expect(() => assertPoolTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertPoolTransition(from, to)).toThrow(
            `invalid pool transition ${from} -> ${to}`,
          );
        }
      }
    }
  });
});

describe("share transition map", () => {
  const states = Object.values(ShareState);

  it("matches the §4.4.2 (+D-N2,+D-N3) map for every (from,to) pair", () => {
    for (const from of states) {
      for (const to of states) {
        expect(canTransitionShare(from, to)).toBe(
          shareAllowed[from].includes(to),
        );
      }
    }
  });

  it("asserts legal edges silently and throws the exact message on illegal edges", () => {
    for (const from of states) {
      for (const to of states) {
        if (shareAllowed[from].includes(to)) {
          expect(() => assertShareTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertShareTransition(from, to)).toThrow(
            `invalid share transition ${from} -> ${to}`,
          );
        }
      }
    }
  });

  it("disallows pending -> refunded (a never-paid share is released, not refunded)", () => {
    expect(canTransitionShare("pending", "refunded")).toBe(false);
  });

  it("allows the first-payment-overshoot edge pending -> overpaid (D-N2)", () => {
    expect(canTransitionShare("pending", "overpaid")).toBe(true);
  });

  it("allows deadline edges pending/partially_paid -> expired (D-N3) and keeps expired terminal", () => {
    expect(canTransitionShare("pending", "expired")).toBe(true);
    expect(canTransitionShare("partially_paid", "expired")).toBe(true);
    expect(shareAllowed.expired).toHaveLength(0);
  });
});

describe("nextShareState", () => {
  it("maps zero to pending", () => {
    expect(nextShareState(5000, 0)).toBe(ShareState.Pending);
  });

  it("maps 0 < paid < share to partially_paid", () => {
    expect(nextShareState(5000, 1)).toBe(ShareState.PartiallyPaid);
    expect(nextShareState(5000, 4999)).toBe(ShareState.PartiallyPaid);
  });

  it("maps paid == share to paid", () => {
    expect(nextShareState(5000, 5000)).toBe(ShareState.Paid);
  });

  it("maps paid > share to overpaid", () => {
    expect(nextShareState(5000, 5001)).toBe(ShareState.Overpaid);
  });
});

describe("applyPaymentToShare", () => {
  it("under: a partial first payment lands fully on the share", () => {
    expect(
      applyPaymentToShare({ shareKobo: 5000, priorPaidKobo: 0, amountKobo: 1500 }),
    ).toEqual({
      from: ShareState.Pending,
      to: ShareState.PartiallyPaid,
      newPaidKobo: 1500,
      attributedKobo: 1500,
      excessKobo: 0,
    });
  });

  it("exact: a first payment that meets the share lands fully, no excess", () => {
    expect(
      applyPaymentToShare({ shareKobo: 5000, priorPaidKobo: 0, amountKobo: 5000 }),
    ).toEqual({
      from: ShareState.Pending,
      to: ShareState.Paid,
      newPaidKobo: 5000,
      attributedKobo: 5000,
      excessKobo: 0,
    });
  });

  it("over: a first payment that overshoots attributes the share and spills the rest (D-N2)", () => {
    expect(
      applyPaymentToShare({ shareKobo: 2000, priorPaidKobo: 0, amountKobo: 2500 }),
    ).toEqual({
      from: ShareState.Pending,
      to: ShareState.Overpaid,
      newPaidKobo: 2500,
      attributedKobo: 2000,
      excessKobo: 500,
    });
  });

  it("completes a partially-paid share exactly", () => {
    expect(
      applyPaymentToShare({
        shareKobo: 3000,
        priorPaidKobo: 1500,
        amountKobo: 1500,
      }),
    ).toEqual({
      from: ShareState.PartiallyPaid,
      to: ShareState.Paid,
      newPaidKobo: 3000,
      attributedKobo: 1500,
      excessKobo: 0,
    });
  });

  it("overpays an already-paid share: attributes nothing, spills all to excess", () => {
    expect(
      applyPaymentToShare({
        shareKobo: 5000,
        priorPaidKobo: 5000,
        amountKobo: 800,
      }),
    ).toEqual({
      from: ShareState.Paid,
      to: ShareState.Overpaid,
      newPaidKobo: 5800,
      attributedKobo: 0,
      excessKobo: 800,
    });
  });

  it("throws on a non-positive amount", () => {
    expect(() =>
      applyPaymentToShare({ shareKobo: 5000, priorPaidKobo: 0, amountKobo: 0 }),
    ).toThrow();
    expect(() =>
      applyPaymentToShare({
        shareKobo: 5000,
        priorPaidKobo: 0,
        amountKobo: -100,
      }),
    ).toThrow();
  });

  it("throws on an illegal edge (further inflow after overpaid)", () => {
    expect(() =>
      applyPaymentToShare({
        shareKobo: 2000,
        priorPaidKobo: 2500,
        amountKobo: 100,
      }),
    ).toThrow("invalid share transition overpaid -> overpaid");
  });
});

describe("isPotFunded — progressive", () => {
  const rule = CompletionRule.Progressive;

  it("funds when collected equals target", () => {
    expect(
      isPotFunded({
        completionRule: rule,
        collectedKobo: 10000,
        targetKobo: 10000,
        shareStates: [],
      }),
    ).toBe(true);
  });

  it("funds when collected exceeds target", () => {
    expect(
      isPotFunded({
        completionRule: rule,
        collectedKobo: 10001,
        targetKobo: 10000,
        shareStates: [],
      }),
    ).toBe(true);
  });

  it("does not fund below target", () => {
    expect(
      isPotFunded({
        completionRule: rule,
        collectedKobo: 9999,
        targetKobo: 10000,
        shareStates: [],
      }),
    ).toBe(false);
  });

  it("is not tripped by overpayment alone (collected is attributed-only, excess in suspense)", () => {
    expect(
      isPotFunded({
        completionRule: rule,
        collectedKobo: 6000,
        targetKobo: 10000,
        shareStates: [ShareState.Overpaid, ShareState.Pending],
      }),
    ).toBe(false);
  });
});

describe("isPotFunded — all_or_nothing", () => {
  const rule = CompletionRule.AllOrNothing;

  it("funds only when every share is paid or overpaid", () => {
    expect(
      isPotFunded({
        completionRule: rule,
        collectedKobo: 0,
        targetKobo: 10000,
        shareStates: [ShareState.Paid, ShareState.Overpaid],
      }),
    ).toBe(true);
  });

  it("is blocked by a partially_paid share", () => {
    expect(
      isPotFunded({
        completionRule: rule,
        collectedKobo: 10000,
        targetKobo: 10000,
        shareStates: [ShareState.Paid, ShareState.PartiallyPaid],
      }),
    ).toBe(false);
  });

  it("is blocked by a pending share", () => {
    expect(
      isPotFunded({
        completionRule: rule,
        collectedKobo: 10000,
        targetKobo: 10000,
        shareStates: [ShareState.Paid, ShareState.Pending],
      }),
    ).toBe(false);
  });

  it("is blocked by an expired share", () => {
    expect(
      isPotFunded({
        completionRule: rule,
        collectedKobo: 10000,
        targetKobo: 10000,
        shareStates: [ShareState.Paid, ShareState.Expired],
      }),
    ).toBe(false);
  });

  it("does not fund an empty share set", () => {
    expect(
      isPotFunded({
        completionRule: rule,
        collectedKobo: 0,
        targetKobo: 0,
        shareStates: [],
      }),
    ).toBe(false);
  });
});
