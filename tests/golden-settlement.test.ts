// Ported from Pattern XI apps/platform/tests/unit/settlement-engine.test.ts.
// The normative 52-case oracle must behave identically after the move to the
// ledger. The one omitted test (case 045 preview-hash binding) covered the
// database operator workflow that the ledger replaces with PR review; see
// DESIGN.md, "What replaces the operator workflow".

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  evaluateSettlement,
  formatPublicDecimal,
  sumExactDecimals,
  type FrozenAsianHandicap,
  type SettlementFacts,
  type SettlementResult,
} from "../src/settlement/settlement-engine.ts";
import {
  buildCorrectionPreview,
  type CorrectionKind,
} from "../src/settlement/settlement-correction.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

interface GoldenCase {
  id: string;
  official: FrozenAsianHandicap;
  facts: Record<string, unknown>;
  expected: Record<string, unknown>;
}

interface GoldenDataset {
  status: string;
  normative: boolean;
  case_count: number;
  cases: GoldenCase[];
}

const dataset = JSON.parse(
  readFileSync(join(REPO_ROOT, "fixtures", "golden", "settlement-v1.json"), "utf8"),
) as GoldenDataset;

function expectedResult(value: GoldenCase): Pick<SettlementResult, "classification" | "net_return" | "record_state"> {
  const expected = value.expected;
  return {
    classification: (expected.classification ?? expected.current_classification ??
      expected.current_preview_classification ?? null) as SettlementResult["classification"],
    net_return: (expected.net_return ?? expected.current_net_return ??
      expected.current_preview_net_return ?? null) as string | null,
    record_state: expected.record_state as SettlementResult["record_state"],
  };
}

function ordinaryFacts(value: GoldenCase): SettlementFacts | undefined {
  if (typeof value.facts.match_status === "string") {
    return value.facts as unknown as SettlementFacts;
  }
  if (value.facts.initial_status === "POSTPONED") {
    return {
      match_status: "POSTPONED",
      actual_kickoff_at: value.facts.actual_kickoff_at as string,
      final_status: value.facts.final_status as "FINISHED",
      home_score: value.facts.home_score as number,
      away_score: value.facts.away_score as number,
    };
  }
  return undefined;
}

test("normative settlement v1 fixture is exactly the frozen 52-case oracle", () => {
  assert.equal(dataset.status, "NORMATIVE_OWNER_REVIEWED_PASS");
  assert.equal(dataset.normative, true);
  assert.equal(dataset.case_count, 52);
  assert.equal(dataset.cases.length, 52);
  assert.deepEqual(dataset.cases.map((value) => value.id),
    Array.from({ length: 52 }, (_, index) => `SET-PROP-${String(index + 1).padStart(3, "0")}`));
});

test("all ordinary, postponed, cancelled, abandoned, and boundary oracle cases match", () => {
  let checked = 0;
  for (const value of dataset.cases) {
    const facts = ordinaryFacts(value);
    if (facts === undefined) continue;
    checked += 1;
    const actual = evaluateSettlement(value.official, facts);
    const expected = expectedResult(value);
    assert.deepEqual(
      {
        classification: actual.classification,
        net_return: actual.net_return,
        record_state: actual.record_state,
      },
      expected,
      value.id,
    );
    if (Array.isArray(value.expected.components)) {
      assert.deepEqual(actual.components, value.expected.components, `${value.id} components`);
    }
  }
  // 47 direct cases; the 5 correction/review cases are covered below through
  // buildCorrectionPreview.
  assert.equal(checked, 47);
});

test("contract status facts enforce the frozen postponed kickoff boundary", () => {
  const official: FrozenAsianHandicap = {
    selection: "HOME",
    line: "-0.50",
    normalized_decimal_price: "1.93",
    frozen_scheduled_kickoff_at: "2026-09-01T12:00:00Z",
  };

  assert.deepEqual(evaluateSettlement(official, {
    match_status: "FINISHED",
    actual_kickoff_at: "2026-09-03T12:00:00Z",
    regulation_completed_at: "2026-09-03T14:00:00Z",
    home_score: 1,
    away_score: 0,
  }), {
    components: [{ line: "-0.50", result: "WIN" }],
    classification: "WIN",
    net_return: "0.93",
    record_state: "SETTLED",
  });

  assert.deepEqual(evaluateSettlement(official, {
    match_status: "FINISHED",
    actual_kickoff_at: "2026-09-03T12:00:00.001Z",
    regulation_completed_at: "2026-09-03T14:00:00Z",
    home_score: 1,
    away_score: 0,
  }), {
    components: [],
    classification: "VOID",
    net_return: "0",
    record_state: "SETTLED",
  });

  assert.equal(evaluateSettlement(official, {
    match_status: "POSTPONED",
    status_determined_at: "2026-09-03T12:00:00Z",
  }).record_state, "PENDING");
  assert.equal(evaluateSettlement(official, {
    match_status: "POSTPONED",
    status_determined_at: "2026-09-03T12:00:00.001Z",
  }).classification, "VOID");
});

test("cases 046, 047, 049, and 050 cover all four append-only correction kinds", () => {
  const kinds = new Set<CorrectionKind>();
  for (const value of [dataset.cases[45]!, dataset.cases[46]!, dataset.cases[48]!, dataset.cases[49]!]) {
    const correction = value.facts.correction as Record<string, unknown>;
    const kind = correction.correction_kind as CorrectionKind;
    kinds.add(kind);
    const prior = value.facts.settled_revision_1 as Record<string, unknown>;
    const priorResult: SettlementResult = {
      components: [],
      classification: prior.classification as SettlementResult["classification"],
      net_return: prior.net_return as string,
      record_state: "SETTLED",
    };
    const score = kind === "SETTLEMENT_LOGIC_ERROR"
      ? value.facts.reviewed_score as { home: number; away: number }
      : { home: correction.home_score as number, away: correction.away_score as number };
    const preview = buildCorrectionPreview({
      official: value.official,
      priorResult,
      kind,
      correctionEvidenceRefs: kind === "SETTLEMENT_LOGIC_ERROR"
        ? undefined
        : correction.correction_evidence_refs as Array<Record<string, unknown>>,
      correctedFacts: Number.isInteger(score.home) && Number.isInteger(score.away)
        ? { match_status: "FINISHED", home_score: score.home, away_score: score.away }
        : undefined,
    });
    assert.equal(preview.classification,
      value.expected.classification ?? value.expected.current_classification, value.id);
    assert.equal(preview.net_return,
      value.expected.net_return ?? value.expected.current_net_return, value.id);
  }
  assert.deepEqual([...kinds].sort(), [
    "ADMINISTRATIVE_RESULT_CHANGE",
    "OFFICIAL_RESULT_CORRECTION",
    "SETTLEMENT_LOGIC_ERROR",
    "SOURCE_DATA_ERROR",
  ]);
});

test("administrative result changes preserve regulation settlement and logic errors need no authority proof", () => {
  const official: FrozenAsianHandicap = {
    selection: "HOME",
    line: "-0.25",
    normalized_decimal_price: "1.93",
  };
  const prior = evaluateSettlement(official, {
    match_status: "FINISHED",
    home_score: 2,
    away_score: 1,
  });
  assert.deepEqual(buildCorrectionPreview({
    official,
    priorResult: prior,
    kind: "ADMINISTRATIVE_RESULT_CHANGE",
    correctionEvidenceRefs: [{ authority_tier: "COMPETITION_AUTHORITY" }],
  }), prior);
  assert.equal(buildCorrectionPreview({
    official,
    priorResult: { ...prior, classification: "LOSS", net_return: "-1" },
    kind: "SETTLEMENT_LOGIC_ERROR",
    correctedFacts: { match_status: "FINISHED", home_score: 2, away_score: 1 },
  }).classification, "WIN");
});

test("authoritative decimal math stays exact; display is half-up and normalizes negative zero", () => {
  assert.equal(sumExactDecimals(["0.005", "0.465", "-0.5", "0.93"]), "0.9");
  assert.equal(formatPublicDecimal("0.45625"), "0.456");
  assert.equal(formatPublicDecimal("0.45650"), "0.457");
  assert.equal(formatPublicDecimal("-0.00040"), "0.000");
});
