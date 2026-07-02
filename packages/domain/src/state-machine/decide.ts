import { CompletionRule, ShareState } from "@paadi/contracts";
import { assertShareTransition } from "./share";

export function nextShareState(
  shareKobo: number,
  newPaidKobo: number,
): ShareState {
  if (newPaidKobo <= 0) {
    return ShareState.Pending;
  }
  if (newPaidKobo < shareKobo) {
    return ShareState.PartiallyPaid;
  }
  if (newPaidKobo === shareKobo) {
    return ShareState.Paid;
  }
  return ShareState.Overpaid;
}

export function applyPaymentToShare(input: {
  shareKobo: number;
  priorPaidKobo: number;
  amountKobo: number;
}): {
  from: ShareState;
  to: ShareState;
  newPaidKobo: number;
  attributedKobo: number;
  excessKobo: number;
} {
  if (!(input.amountKobo > 0)) {
    throw new Error("amountKobo must be a positive integer");
  }

  const from = nextShareState(input.shareKobo, input.priorPaidKobo);
  const newPaidKobo = input.priorPaidKobo + input.amountKobo;
  const to = nextShareState(input.shareKobo, newPaidKobo);
  assertShareTransition(from, to);

  const remainingKobo = Math.max(0, input.shareKobo - input.priorPaidKobo);
  const attributedKobo = Math.min(remainingKobo, input.amountKobo);
  const excessKobo = input.amountKobo - attributedKobo;

  return { from, to, newPaidKobo, attributedKobo, excessKobo };
}

export function isPotFunded(input: {
  completionRule: CompletionRule;
  collectedKobo: number;
  targetKobo: number;
  shareStates: ShareState[];
}): boolean {
  if (input.completionRule === CompletionRule.AllOrNothing) {
    return (
      input.shareStates.length > 0 &&
      input.shareStates.every(
        (s) => s === ShareState.Paid || s === ShareState.Overpaid,
      )
    );
  }

  return input.collectedKobo >= input.targetKobo;
}
