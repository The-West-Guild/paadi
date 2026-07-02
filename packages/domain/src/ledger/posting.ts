import { LedgerAccountKind, LedgerDirection } from "./account";
import { LedgerPosting, PostingEntry, assertBalanced } from "./ledger";

const HOUSE = "house";

export function buildCollectionPosting(input: { potId: string; amountKobo: number }): LedgerPosting {
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.PooledCash, ownerRef: HOUSE },
      direction: LedgerDirection.Debit,
      amountKobo: input.amountKobo
    },
    {
      account: { kind: LedgerAccountKind.PotLiability, ownerRef: input.potId },
      direction: LedgerDirection.Credit,
      amountKobo: input.amountKobo
    }
  ];
  assertBalanced(entries);
  return { kind: "collection", potId: input.potId, entries };
}

export function buildSuspensePosting(input: { potId: string | null; amountKobo: number }): LedgerPosting {
  const suspenseOwner = input.potId ?? HOUSE;
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.PooledCash, ownerRef: HOUSE },
      direction: LedgerDirection.Debit,
      amountKobo: input.amountKobo
    },
    {
      account: { kind: LedgerAccountKind.ExceptionsSuspense, ownerRef: suspenseOwner },
      direction: LedgerDirection.Credit,
      amountKobo: input.amountKobo
    }
  ];
  assertBalanced(entries);
  return { kind: "suspense", potId: input.potId, entries };
}

export function buildContributionPosting(input: {
  potId: string;
  shareKobo: number;
  priorPaidKobo: number;
  amountKobo: number;
}): { posting: LedgerPosting; attributedKobo: number; excessKobo: number } {
  const attributedKobo = Math.max(0, Math.min(input.shareKobo - input.priorPaidKobo, input.amountKobo));
  const excessKobo = input.amountKobo - attributedKobo;

  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.PooledCash, ownerRef: HOUSE },
      direction: LedgerDirection.Debit,
      amountKobo: input.amountKobo
    }
  ];
  if (attributedKobo > 0) {
    entries.push({
      account: { kind: LedgerAccountKind.PotLiability, ownerRef: input.potId },
      direction: LedgerDirection.Credit,
      amountKobo: attributedKobo
    });
  }
  if (excessKobo > 0) {
    entries.push({
      account: { kind: LedgerAccountKind.ExceptionsSuspense, ownerRef: input.potId },
      direction: LedgerDirection.Credit,
      amountKobo: excessKobo
    });
  }

  assertBalanced(entries);
  return { posting: { kind: "contribution", potId: input.potId, entries }, attributedKobo, excessKobo };
}

export function buildSettlementPosting(input: { potId: string; netKobo: number; feeKobo: number }): LedgerPosting {
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.PotLiability, ownerRef: input.potId },
      direction: LedgerDirection.Debit,
      amountKobo: input.netKobo + input.feeKobo
    },
    {
      account: { kind: LedgerAccountKind.SettlementPayout, ownerRef: HOUSE },
      direction: LedgerDirection.Credit,
      amountKobo: input.netKobo
    }
  ];
  if (input.feeKobo > 0) {
    entries.push({
      account: { kind: LedgerAccountKind.PlatformFee, ownerRef: HOUSE },
      direction: LedgerDirection.Credit,
      amountKobo: input.feeKobo
    });
  }
  assertBalanced(entries);
  return { kind: "settlement", potId: input.potId, entries };
}

export function buildSettlementReversePosting(input: {
  potId: string;
  netKobo: number;
  feeKobo: number;
}): LedgerPosting {
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.SettlementPayout, ownerRef: HOUSE },
      direction: LedgerDirection.Debit,
      amountKobo: input.netKobo
    },
    {
      account: { kind: LedgerAccountKind.PotLiability, ownerRef: input.potId },
      direction: LedgerDirection.Credit,
      amountKobo: input.netKobo + input.feeKobo
    }
  ];
  if (input.feeKobo > 0) {
    entries.push({
      account: { kind: LedgerAccountKind.PlatformFee, ownerRef: HOUSE },
      direction: LedgerDirection.Debit,
      amountKobo: input.feeKobo
    });
  }
  assertBalanced(entries);
  return { kind: "settlement_reversed", potId: input.potId, entries };
}

export function buildPayoutClearedPosting(input: { netKobo: number }): LedgerPosting {
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.SettlementPayout, ownerRef: HOUSE },
      direction: LedgerDirection.Debit,
      amountKobo: input.netKobo
    },
    {
      account: { kind: LedgerAccountKind.PooledCash, ownerRef: HOUSE },
      direction: LedgerDirection.Credit,
      amountKobo: input.netKobo
    }
  ];
  assertBalanced(entries);
  return { kind: "payout_cleared", entries };
}

export function buildWalletSettlementPosting(input: {
  potId: string;
  creatorId: string;
  amountKobo: number;
}): LedgerPosting {
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.PotLiability, ownerRef: input.potId },
      direction: LedgerDirection.Debit,
      amountKobo: input.amountKobo
    },
    {
      account: { kind: LedgerAccountKind.UserWallet, ownerRef: input.creatorId },
      direction: LedgerDirection.Credit,
      amountKobo: input.amountKobo
    }
  ];
  assertBalanced(entries);
  return { kind: "wallet_settlement", potId: input.potId, entries };
}

export function buildRefundPosting(input: {
  potId: string;
  fromSuspense: boolean;
  amountKobo: number;
}): LedgerPosting {
  const entries: PostingEntry[] = [
    {
      account: {
        kind: input.fromSuspense ? LedgerAccountKind.ExceptionsSuspense : LedgerAccountKind.PotLiability,
        ownerRef: input.potId
      },
      direction: LedgerDirection.Debit,
      amountKobo: input.amountKobo
    },
    {
      account: { kind: LedgerAccountKind.RefundsPayable, ownerRef: input.potId },
      direction: LedgerDirection.Credit,
      amountKobo: input.amountKobo
    }
  ];
  assertBalanced(entries);
  return { kind: "refund", potId: input.potId, entries };
}

export function buildRefundClearedPosting(input: { potId: string; amountKobo: number }): LedgerPosting {
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.RefundsPayable, ownerRef: input.potId },
      direction: LedgerDirection.Debit,
      amountKobo: input.amountKobo
    },
    {
      account: { kind: LedgerAccountKind.PooledCash, ownerRef: HOUSE },
      direction: LedgerDirection.Credit,
      amountKobo: input.amountKobo
    }
  ];
  assertBalanced(entries);
  return { kind: "refund_cleared", potId: input.potId, entries };
}

export function buildWalletCreditPosting(input: { userId: string; amountKobo: number }): LedgerPosting {
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.PooledCash, ownerRef: HOUSE },
      direction: LedgerDirection.Debit,
      amountKobo: input.amountKobo
    },
    {
      account: { kind: LedgerAccountKind.UserWallet, ownerRef: input.userId },
      direction: LedgerDirection.Credit,
      amountKobo: input.amountKobo
    }
  ];
  assertBalanced(entries);
  return { kind: "wallet_credit", potId: null, entries };
}

export function buildWalletContributionPosting(input: {
  payerUserId: string;
  potId: string;
  shareKobo: number;
  priorPaidKobo: number;
  amountKobo: number;
}): { posting: LedgerPosting; attributedKobo: number; excessKobo: number } {
  const attributedKobo = Math.max(0, Math.min(input.shareKobo - input.priorPaidKobo, input.amountKobo));
  const excessKobo = input.amountKobo - attributedKobo;

  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.UserWallet, ownerRef: input.payerUserId },
      direction: LedgerDirection.Debit,
      amountKobo: input.amountKobo
    }
  ];
  if (attributedKobo > 0) {
    entries.push({
      account: { kind: LedgerAccountKind.PotLiability, ownerRef: input.potId },
      direction: LedgerDirection.Credit,
      amountKobo: attributedKobo
    });
  }
  if (excessKobo > 0) {
    entries.push({
      account: { kind: LedgerAccountKind.ExceptionsSuspense, ownerRef: input.potId },
      direction: LedgerDirection.Credit,
      amountKobo: excessKobo
    });
  }

  assertBalanced(entries);
  return { posting: { kind: "wallet_contribution", potId: input.potId, entries }, attributedKobo, excessKobo };
}

export function buildWithdrawalPosting(input: {
  userId: string;
  netKobo: number;
  feeKobo: number;
}): LedgerPosting {
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.UserWallet, ownerRef: input.userId },
      direction: LedgerDirection.Debit,
      amountKobo: input.netKobo + input.feeKobo
    },
    {
      account: { kind: LedgerAccountKind.SettlementPayout, ownerRef: HOUSE },
      direction: LedgerDirection.Credit,
      amountKobo: input.netKobo
    }
  ];
  if (input.feeKobo > 0) {
    entries.push({
      account: { kind: LedgerAccountKind.PlatformFee, ownerRef: HOUSE },
      direction: LedgerDirection.Credit,
      amountKobo: input.feeKobo
    });
  }
  assertBalanced(entries);
  return { kind: "withdrawal", potId: null, entries };
}

export function buildWithdrawalClearedPosting(input: { netKobo: number }): LedgerPosting {
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.SettlementPayout, ownerRef: HOUSE },
      direction: LedgerDirection.Debit,
      amountKobo: input.netKobo
    },
    {
      account: { kind: LedgerAccountKind.PooledCash, ownerRef: HOUSE },
      direction: LedgerDirection.Credit,
      amountKobo: input.netKobo
    }
  ];
  assertBalanced(entries);
  return { kind: "withdrawal_cleared", potId: null, entries };
}

export function buildWithdrawalReversePosting(input: {
  userId: string;
  netKobo: number;
  feeKobo: number;
}): LedgerPosting {
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.SettlementPayout, ownerRef: HOUSE },
      direction: LedgerDirection.Debit,
      amountKobo: input.netKobo
    }
  ];
  if (input.feeKobo > 0) {
    entries.push({
      account: { kind: LedgerAccountKind.PlatformFee, ownerRef: HOUSE },
      direction: LedgerDirection.Debit,
      amountKobo: input.feeKobo
    });
  }
  entries.push({
    account: { kind: LedgerAccountKind.UserWallet, ownerRef: input.userId },
    direction: LedgerDirection.Credit,
    amountKobo: input.netKobo + input.feeKobo
  });
  assertBalanced(entries);
  return { kind: "withdrawal_reversed", potId: null, entries };
}

export function buildExceptionAssignmentPosting(input: {
  userId: string;
  amountKobo: number;
  suspenseOwnerRef?: string;
}): LedgerPosting {
  const suspenseOwner = input.suspenseOwnerRef ?? HOUSE;
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.ExceptionsSuspense, ownerRef: suspenseOwner },
      direction: LedgerDirection.Debit,
      amountKobo: input.amountKobo
    },
    {
      account: { kind: LedgerAccountKind.UserWallet, ownerRef: input.userId },
      direction: LedgerDirection.Credit,
      amountKobo: input.amountKobo
    }
  ];
  assertBalanced(entries);
  return { kind: "exception_assignment", potId: null, entries };
}

export function buildExceptionRefundPosting(input: {
  amountKobo: number;
  suspenseOwnerRef?: string;
}): LedgerPosting {
  const suspenseOwner = input.suspenseOwnerRef ?? HOUSE;
  const entries: PostingEntry[] = [
    {
      account: { kind: LedgerAccountKind.ExceptionsSuspense, ownerRef: suspenseOwner },
      direction: LedgerDirection.Debit,
      amountKobo: input.amountKobo
    },
    {
      account: { kind: LedgerAccountKind.PooledCash, ownerRef: HOUSE },
      direction: LedgerDirection.Credit,
      amountKobo: input.amountKobo
    }
  ];
  assertBalanced(entries);
  return { kind: "exception_refund", potId: null, entries };
}
