import { SettlementFailureReason } from "@paadi/contracts";
import {
  FinalizeSettlementResult,
  SettlementOutcome
} from "../../../infra/persistence/settlements.repository";

export interface FinalizeCall {
  potId: string;
  outcome: SettlementOutcome;
}

export interface FailCall {
  potId: string;
  reason: SettlementFailureReason;
}

export interface SettlementOutcomeRecorder {
  repo: {
    finalizeSettlement: jest.Mock<Promise<FinalizeSettlementResult>, [string, SettlementOutcome]>;
    failSettlement: jest.Mock<Promise<void>, [string, SettlementFailureReason]>;
  };
  finalizeCalls: FinalizeCall[];
  failCalls: FailCall[];
}

export function makeSettlementsFake(settlementId = "stl-1"): SettlementOutcomeRecorder {
  const finalizeCalls: FinalizeCall[] = [];
  const failCalls: FailCall[] = [];

  const finalizeSettlement = jest.fn(async (potId: string, outcome: SettlementOutcome) => {
    finalizeCalls.push({ potId, outcome });
    return {
      settlementId,
      status: outcome.kind === "pending" ? "PROCESSING" : "COMPLETED",
      awaitingConfirmation: outcome.kind === "pending"
    } as unknown as FinalizeSettlementResult;
  });

  const failSettlement = jest.fn(async (potId: string, reason: SettlementFailureReason) => {
    failCalls.push({ potId, reason });
  });

  return { repo: { finalizeSettlement, failSettlement }, finalizeCalls, failCalls };
}
