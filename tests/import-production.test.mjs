import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { importProductionExport, normalizeProductionExport } from "../scripts/import-production.mjs";
import { runValidation } from "../scripts/validate.mjs";

function sampleExport() {
  return {
    schema: "production-public-export.v1",
    exported_at: "2026-09-02T08:16:09.393094+00:00",
    matches: [
      {
        league: "日职联",
        kickoff: { local: "2026-09-02 18:00", timezone: "Asia/Shanghai" },
        home_team: "[20]千叶市原",
        away_team: "冈山绿雉[13]",
        patterns: [{ historical_matches: 7, note: "private-pattern" }],
        public_note: "private-note",
        asian_handicap: {
          recommendation: "客队",
          price_basis: "LIVE_ENRICHMENT",
          provider: "Crown",
          market: "full_time_asian_handicap",
          line_raw: "受让半球",
          observed_at: "2026-09-02T08:11:54.186701+00:00",
          recommended_handicap: "-0.5",
          recommended_water_raw: "0.97",
        },
      },
      {
        league: "罗杯",
        kickoff: { local: "2026-09-02 21:00", timezone: "Asia/Shanghai" },
        home_team: "米尼罗尔",
        away_team: "阿拉德联队[罗甲14]",
        patterns: [{ historical_matches: 2, note: "private-pattern" }],
        public_note: "private-note",
        asian_handicap: {
          recommendation: "客队",
          price_basis: "LIVE_ENRICHMENT",
          provider: "Crown",
          market: "full_time_asian_handicap",
          line_raw: "受让半球/一球",
          observed_at: "2026-09-02T08:12:00.158526+00:00",
          recommended_handicap: "-0.75",
          recommended_water_raw: "0.82",
        },
      },
    ],
  };
}

test("production v1 maps only final public fields and skips picks inside two hours", () => {
  const normalized = normalizeProductionExport(sampleExport());
  assert.equal(normalized.picks.length, 1);
  assert.equal(normalized.skipped.length, 1);
  assert.match(normalized.skipped[0].reason, /less than 2 hours/u);

  const pick = normalized.picks[0];
  assert.equal(pick.kickoff_utc, "2026-09-02T13:00:00Z");
  assert.equal(pick.match, "米尼罗尔 v 阿拉德联队");
  assert.equal(pick.selection, "AWAY");
  assert.equal(pick.line, "-0.75");
  assert.equal(pick.published_price, "0.82");
  assert.equal(pick.normalized_decimal_price, "1.82");
  assert.equal(pick.price_source, "Crown");
  assert.match(pick.id, /^2026-09-02-fixture-[0-9a-f]{12}-ah$/u);
  assert.equal("patterns" in pick, false);
  assert.equal("public_note" in pick, false);
  assert.equal(JSON.stringify(pick).includes("private-pattern"), false);
});

test("import is idempotent, validates generated picks, and rejects conflicts", () => {
  const root = mkdtempSync(join(tmpdir(), "pattern-xi-import-test-"));
  try {
    const first = importProductionExport(root, sampleExport());
    assert.equal(first.written.length, 1);
    assert.equal(first.skippedLate.length, 1);
    assert.deepEqual(runValidation(root), []);

    const second = importProductionExport(root, sampleExport());
    assert.equal(second.written.length, 0);
    assert.equal(second.unchanged.length, 1);

    const relativePath = first.written[0];
    const file = join(root, relativePath);
    const changed = JSON.parse(readFileSync(file, "utf8"));
    changed.published_price = "0.83";
    writeFileSync(file, `${JSON.stringify(changed, null, 2)}\n`);
    assert.throws(() => importProductionExport(root, sampleExport()), /conflicts with existing/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dry run performs no writes and invalid export data fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "pattern-xi-import-test-"));
  try {
    const result = importProductionExport(root, sampleExport(), { dryRun: true });
    assert.equal(result.written.length, 1);
    assert.equal(existsSync(join(root, result.written[0])), false);

    const invalid = sampleExport();
    invalid.matches[1].asian_handicap.recommended_handicap = "-0.6";
    assert.throws(() => normalizeProductionExport(invalid), /whole\/half\/quarter/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

