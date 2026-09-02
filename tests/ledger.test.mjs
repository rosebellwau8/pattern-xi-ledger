// Ledger rule tests: pick/result validation, the 2-hour publication gate,
// append-only correction chains, settlement mapping, and rebuildable
// standings. All fixtures live in temporary directories so the real picks/
// tree stays clean.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LedgerError, loadPicks, loadResultChains, sha256File } from "../scripts/lib.mjs";
import { runValidation } from "../scripts/validate.mjs";
import { analyzeLedgerDiff } from "../scripts/validate-pr.mjs";
import { buildSettlements } from "../scripts/settle.mjs";
import { buildStandings } from "../scripts/standings.mjs";

const TWO_HOURS = 2 * 60 * 60 * 1000;

function makeLedger() {
  const root = mkdtempSync(join(tmpdir(), "pattern-xi-ledger-test-"));
  for (const dir of ["picks/2026", "results/2026"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  return root;
}

function writeJson(root, relativePath, data) {
  const file = join(root, relativePath);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function samplePick(overrides = {}) {
  return {
    schema: "pattern-xi.pick.v1",
    id: "2026-09-06-arsenal-chelsea-ah",
    match: "Arsenal v Chelsea",
    competition: "Premier League",
    kickoff_utc: "2026-09-06T16:30:00Z",
    market: "asian_handicap",
    selection: "HOME",
    line: "-0.75",
    published_price: "0.93",
    published_price_format: "HONG_KONG_ODDS",
    normalized_decimal_price: "1.93",
    price_source: "Pinnacle pre-match",
    ...overrides,
  };
}

test("a valid pick with Hong Kong odds passes and normalizes to decimal + 1", () => {
  const root = makeLedger();
  try {
    writeJson(root, "picks/2026/2026-09-06-arsenal-chelsea-ah.json", samplePick());
    assert.deepEqual(runValidation(root, { now: Date.parse("2026-09-06T10:00:00Z"), gatePaths: ["picks/2026/2026-09-06-arsenal-chelsea-ah.json"] }), []);
    const picks = loadPicks(root);
    assert.equal(picks.get("2026-09-06-arsenal-chelsea-ah").frozen.normalized_decimal_price, "1.93");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("decimal-odds picks must carry the identical normalized price", () => {
  const root = makeLedger();
  try {
    writeJson(root, "picks/2026/2026-09-06-arsenal-chelsea-ah.json", samplePick({
      published_price: "1.93",
      published_price_format: "DECIMAL_ODDS",
      normalized_decimal_price: "1.95",
    }));
    const problems = runValidation(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /normalized_decimal_price must be 1.93/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unknown fields, non-quarter lines, and wrong ids fail closed", () => {
  const root = makeLedger();
  try {
    writeJson(root, "picks/2026/2026-09-06-arsenal-chelsea-ah.json", samplePick({ tipster_feeling: "strong" }));
    assert.match(runValidation(root)[0], /unknown field "tipster_feeling"/u);

    writeJson(root, "picks/2026/2026-09-06-arsenal-chelsea-ah.json", samplePick({ line: "-0.60" }));
    assert.match(runValidation(root)[0], /whole\/half\/quarter line/u);

    writeJson(root, "picks/2026/2026-09-06-arsenal-chelsea-ah.json", samplePick({ id: "2026-09-07-arsenal-chelsea-ah" }));
    assert.match(runValidation(root)[0], /must look like 2026-09-06|kickoff UTC date/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the publication gate demands at least two hours before kickoff", () => {
  const root = makeLedger();
  try {
    writeJson(root, "picks/2026/2026-09-06-arsenal-chelsea-ah.json", samplePick());
    const path = "picks/2026/2026-09-06-arsenal-chelsea-ah.json";
    const exactlyTwoHours = Date.parse("2026-09-06T14:30:00Z");
    assert.deepEqual(runValidation(root, { now: exactlyTwoHours, gatePaths: [path] }), []);
    const oneMinuteShort = exactlyTwoHours + 60_000;
    const problems = runValidation(root, { now: oneMinuteShort, gatePaths: [path] });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /at least 2 hours before kickoff/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pull request diffs allow new ledger inputs and reject mutation or deletion", () => {
  assert.deepEqual(analyzeLedgerDiff([
    "A\tpicks/2026/2026-09-06-arsenal-chelsea-ah.json",
    "A\tresults/2026/2026-09-06-arsenal-chelsea-ah.json",
    "M\tREADME.md",
    "",
  ].join("\n")), {
    gatePaths: ["picks/2026/2026-09-06-arsenal-chelsea-ah.json"],
    problems: [],
  });

  const rejected = analyzeLedgerDiff([
    "M\tpicks/2026/2026-09-06-arsenal-chelsea-ah.json",
    "D\tresults/2026/2026-09-06-arsenal-chelsea-ah.json",
    "R100\tresults/2026/old.json\tresults/2026/new.json",
    "",
  ].join("\n"));
  assert.equal(rejected.gatePaths.length, 0);
  assert.equal(rejected.problems.length, 3);
  assert.match(rejected.problems[0], /append-only/u);
});

function writeResult(root, pickId, name, data) {
  const relativePath = `results/2026/${name}`;
  writeJson(root, relativePath, { schema: "pattern-xi.result.v1", pick_id: pickId, ...data });
  return sha256File(join(root, relativePath));
}

test("settlement, correction chain, and rebuildable standings work end to end", () => {
  const root = makeLedger();
  try {
    writeJson(root, "picks/2026/2026-09-06-arsenal-chelsea-ah.json", samplePick());
    writeJson(root, "picks/2026/2026-09-06-dortmund-leverkusen-ah.json", samplePick({
      id: "2026-09-06-dortmund-leverkusen-ah",
      match: "Dortmund v Leverkusen",
      kickoff_utc: "2026-09-06T13:30:00Z",
      selection: "AWAY",
      line: "+0.25",
      normalized_decimal_price: "1.95",
      published_price: "0.95",
    }));
    writeJson(root, "picks/2026/2026-09-06-marseille-lyon-ah.json", samplePick({
      id: "2026-09-06-marseille-lyon-ah",
      match: "Marseille v Lyon",
      kickoff_utc: "2026-09-06T19:00:00Z",
      line: "-0.50",
    }));

    const firstHash = writeResult(root, "2026-09-06-arsenal-chelsea-ah", "2026-09-06-arsenal-chelsea-ah.json",
      { status: "PLAYED", home_score: 2, away_score: 1 });
    writeResult(root, "2026-09-06-dortmund-leverkusen-ah", "2026-09-06-dortmund-leverkusen-ah.json",
      { status: "PLAYED", home_score: 1, away_score: 1 });
    writeResult(root, "2026-09-06-marseille-lyon-ah", "2026-09-06-marseille-lyon-ah.json",
      { status: "POSTPONED", status_determined_at: "2026-09-06T08:00:00Z" });

    assert.deepEqual(runValidation(root), []);

    const { settlements } = buildSettlements(root);
    const arsenal = settlements.get("2026-09-06-arsenal-chelsea-ah");
    // -0.75 on a 2-1 home win: the -0.50 half wins, the -1.00 half pushes.
    assert.equal(arsenal.current.classification, "HALF_WIN");
    assert.equal(arsenal.current.net_return, "0.465");
    // +0.25 for AWAY on a 1-1 draw: the +0.00 half pushes, the +0.50 half wins.
    const dortmund = settlements.get("2026-09-06-dortmund-leverkusen-ah");
    assert.equal(dortmund.current.classification, "HALF_WIN");
    assert.equal(dortmund.current.net_return, "0.475");
    assert.equal(settlements.get("2026-09-06-marseille-lyon-ah").current.record_state, "PENDING");

    const before = buildStandings(root);
    assert.equal(before.n, 2);
    assert.equal(before.classification_counts.HALF_WIN, 2);
    assert.equal(before.classification_counts.HALF_LOSS, 0);
    assert.equal(before.pending_count, 1);
    // Kickoff order: Dortmund 13:30 (+0.475), Arsenal 16:30 (+0.465).
    assert.equal(before.total_net_return, "0.94");
    assert.equal(before.roi_percent, "47.000");
    assert.equal(before.maximum_drawdown, "0");

    // An append-only correction flips the Arsenal result; the chain root is
    // preserved and the projection must rebuild from the correction head.
    const correctionHash = writeResult(root, "2026-09-06-arsenal-chelsea-ah", "2026-09-06-arsenal-chelsea-ah.r2.json",
      { status: "PLAYED", home_score: 1, away_score: 1, corrects: firstHash, note: "Official source corrected the final score." });
    assert.notEqual(correctionHash, firstHash);
    assert.deepEqual(runValidation(root), []);

    const chains = loadResultChains(root, loadPicks(root));
    assert.equal(chains.get("2026-09-06-arsenal-chelsea-ah").length, 2);

    const after = buildStandings(root);
    // 1-1 against -0.75: both the -0.50 and -1.00 halves lose.
    assert.equal(after.classification_counts.HALF_WIN, 1);
    assert.equal(after.classification_counts.LOSS, 1);
    assert.equal(after.total_net_return, "-0.525");
    assert.equal(after.n, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("correction chains reject forks, unknown parents, and no-op corrections", () => {
  const root = makeLedger();
  try {
    writeJson(root, "picks/2026/2026-09-06-arsenal-chelsea-ah.json", samplePick());
    const firstHash = writeResult(root, "2026-09-06-arsenal-chelsea-ah", "2026-09-06-arsenal-chelsea-ah.json",
      { status: "PLAYED", home_score: 2, away_score: 1 });

    writeResult(root, "2026-09-06-arsenal-chelsea-ah", "2026-09-06-arsenal-chelsea-ah.r2.json",
      { status: "PLAYED", home_score: 1, away_score: 1, corrects: firstHash });
    writeResult(root, "2026-09-06-arsenal-chelsea-ah", "2026-09-06-arsenal-chelsea-ah.r3.json",
      { status: "PLAYED", home_score: 3, away_score: 1, corrects: firstHash });
    const problems = runValidation(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /not linked into the result chain/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const root2 = makeLedger();
  try {
    writeJson(root2, "picks/2026/2026-09-06-arsenal-chelsea-ah.json", samplePick());
    const firstHash = writeResult(root2, "2026-09-06-arsenal-chelsea-ah", "2026-09-06-arsenal-chelsea-ah.json",
      { status: "PLAYED", home_score: 2, away_score: 1 });
    writeResult(root2, "2026-09-06-arsenal-chelsea-ah", "2026-09-06-arsenal-chelsea-ah.r2.json",
      { status: "PLAYED", home_score: 2, away_score: 1, corrects: firstHash });
    const problems = runValidation(root2);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /without changing any content/u);
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }
});

test("sha256File hashes exact bytes", () => {
  const root = makeLedger();
  try {
    const empty = join(root, "empty.txt");
    writeFileSync(empty, "");
    // Well-known sha256 of the empty string anchors the hashing to exact bytes.
    assert.equal(sha256File(empty), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    const withByte = join(root, "one-byte.txt");
    writeFileSync(withByte, "x");
    assert.notEqual(sha256File(withByte), sha256File(empty));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
