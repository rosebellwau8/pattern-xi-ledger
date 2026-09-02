import {
  evaluateSettlement,
  type FrozenAsianHandicap,
  type SettlementFacts,
  type SettlementResult,
} from "./settlement-engine.ts";

export type CorrectionKind =
  | "SOURCE_DATA_ERROR"
  | "SETTLEMENT_LOGIC_ERROR"
  | "OFFICIAL_RESULT_CORRECTION"
  | "ADMINISTRATIVE_RESULT_CHANGE";

export interface CorrectionPreviewInput {
  official: FrozenAsianHandicap;
  priorResult: SettlementResult;
  kind: CorrectionKind;
  correctionEvidenceRefs?: Array<Record<string, unknown>> | undefined;
  correctedFacts?: SettlementFacts | undefined;
}

export function buildCorrectionPreview(input: CorrectionPreviewInput): SettlementResult {
  if (input.kind !== "SETTLEMENT_LOGIC_ERROR" &&
      (input.correctionEvidenceRefs === undefined || input.correctionEvidenceRefs.length === 0)) {
    throw new Error("CORRECTION_EVIDENCE_REQUIRED");
  }
  if (input.kind === "ADMINISTRATIVE_RESULT_CHANGE") {
    return structuredClone(input.priorResult);
  }
  if (input.correctedFacts === undefined) throw new Error("CORRECTED_FACTS_REQUIRED");
  return evaluateSettlement(input.official, input.correctedFacts);
}
