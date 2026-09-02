// Shared ledger loading, validation, and settlement-mapping logic.
// Fail-closed by convention: unknown fields, malformed values, and broken
// correction chains are hard errors, never warnings.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ExactDecimal } from "../src/settlement/exact-decimal.ts";
import { evaluateSettlement } from "../src/settlement/settlement-engine.ts";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PICK_SCHEMA = "pattern-xi.pick.v1";
export const RESULT_SCHEMA = "pattern-xi.result.v1";
export const SETTLEMENT_SCHEMA = "pattern-xi.settlement.v1";
export const STANDINGS_SCHEMA = "pattern-xi.standings.v1";

const PICK_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UTC_STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u;
const LINE = /^([+-]?)(\d+)\.(\d{2})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const PRICE = /^(\d+)(?:\.(\d+))?$/u;

const STATUSES = new Set(["PLAYED", "POSTPONED", "CANCELLED", "ABANDONED"]);
const DISPOSITIONS = new Set([
  "RESUMED_SAME_FIXTURE",
  "REPLAYED_FROM_ZERO",
  "ABANDONED_FINAL",
  "UNKNOWN",
]);
const CORRECTION_KINDS = new Set([
  "SOURCE_DATA_ERROR",
  "SETTLEMENT_LOGIC_ERROR",
  "OFFICIAL_RESULT_CORRECTION",
  "ADMINISTRATIVE_RESULT_CHANGE",
]);

export class LedgerError extends Error {}

function fail(message) {
  throw new LedgerError(message);
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function parseUtcStamp(value, label) {
  if (typeof value !== "string") fail(`${label} must be a UTC timestamp string`);
  const match = UTC_STAMP.exec(value);
  if (match === null) fail(`${label} must match YYYY-MM-DDTHH:MM:SS[.mmm]Z: ${JSON.stringify(value)}`);
  const epoch = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]),
    Number((match[7] ?? "").padEnd(3, "0")),
  );
  const round = new Date(epoch);
  if (round.getUTCFullYear() !== Number(match[1]) || round.getUTCMonth() !== Number(match[2]) - 1
    || round.getUTCDate() !== Number(match[3]) || round.getUTCHours() !== Number(match[4])
    || round.getUTCMinutes() !== Number(match[5]) || round.getUTCSeconds() !== Number(match[6])
    || round.getUTCMilliseconds() !== Number((match[7] ?? "").padEnd(3, "0"))) {
    fail(`${label} is not a real UTC instant: ${JSON.stringify(value)}`);
  }
  return epoch;
}

function parsePrice(value, label) {
  if (typeof value !== "string" || PRICE.exec(value) === null) {
    fail(`${label} must be a decimal string without sign or exponent: ${JSON.stringify(value)}`);
  }
  return ExactDecimal.parse(value);
}

function requireString(data, key, label) {
  const value = data[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function checkNoExtras(data, allowed, label) {
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) fail(`${label} has unknown field "${key}"`);
  }
}

export function validatePickObject(data, label, relativePath) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) fail(`${label} must be a JSON object`);
  if (data.schema !== PICK_SCHEMA) fail(`${label}.schema must be "${PICK_SCHEMA}"`);
  checkNoExtras(data, [
    "schema", "id", "match", "competition", "kickoff_utc", "market", "selection",
    "line", "published_price", "published_price_format", "normalized_decimal_price",
    "price_source", "note",
  ], label);

  const id = requireString(data, "id", label);
  if (PICK_ID.exec(id) === null) fail(`${label}.id must look like 2026-09-06-arsenal-chelsea-ah: ${id}`);

  const kickoff = requireString(data, "kickoff_utc", label);
  const kickoffEpoch = parseUtcStamp(kickoff, `${label}.kickoff_utc`);
  if (!id.startsWith(kickoff.slice(0, 10))) {
    fail(`${label}.id must start with the kickoff UTC date ${kickoff.slice(0, 10)}`);
  }
  if (relativePath !== undefined) {
    const normalized = relativePath.replaceAll(sep, "/");
    const expected = `picks/${id.slice(0, 4)}/${id}.json`;
    if (normalized !== expected) fail(`${label} path must be ${expected}, found ${normalized}`);
  }

  requireString(data, "match", label);
  requireString(data, "competition", label);
  if (data.market !== "asian_handicap") fail(`${label}.market must be "asian_handicap"`);
  if (data.selection !== "HOME" && data.selection !== "AWAY") fail(`${label}.selection must be HOME or AWAY`);

  const line = requireString(data, "line", label);
  const lineMatch = LINE.exec(line);
  if (lineMatch === null) fail(`${label}.line must look like -0.75 or +1.00: ${JSON.stringify(line)}`);
  const cents = BigInt(lineMatch[1] === "-" ? -1n : 1n)
    * (BigInt(lineMatch[2]) * 100n + BigInt(lineMatch[3]));
  if (cents % 25n !== 0n) fail(`${label}.line must be a whole/half/quarter line: ${line}`);

  const format = requireString(data, "published_price_format", label);
  if (format !== "DECIMAL_ODDS" && format !== "HONG_KONG_ODDS") {
    fail(`${label}.published_price_format must be DECIMAL_ODDS or HONG_KONG_ODDS`);
  }
  const published = parsePrice(requireString(data, "published_price", label), `${label}.published_price`);
  const normalized = parsePrice(
    requireString(data, "normalized_decimal_price", label),
    `${label}.normalized_decimal_price`,
  );
  const expectedNormalized = format === "DECIMAL_ODDS"
    ? published
    : published.add(ExactDecimal.parse("1"));
  if (normalized.compare(expectedNormalized) !== 0) {
    fail(`${label}.normalized_decimal_price must be ${expectedNormalized.toString()} for ${format} input ${published.toString()}`);
  }
  if (normalized.compare(ExactDecimal.parse("1")) <= 0) {
    fail(`${label}.normalized_decimal_price must be greater than 1`);
  }

  requireString(data, "price_source", label);
  if (data.note !== undefined && typeof data.note !== "string") fail(`${label}.note must be a string`);

  return { kickoffEpoch, normalized: normalized.toString(), line, selection: data.selection, id };
}

export function validateResultObject(data, label) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) fail(`${label} must be a JSON object`);
  if (data.schema !== RESULT_SCHEMA) fail(`${label}.schema must be "${RESULT_SCHEMA}"`);
  checkNoExtras(data, [
    "schema", "pick_id", "status", "home_score", "away_score", "final_status",
    "actual_kickoff_at", "regulation_completed_at", "status_determined_at",
    "interruption_disposition", "corrects", "correction_kind", "evidence_refs", "note",
  ], label);

  const pickId = requireString(data, "pick_id", label);
  if (PICK_ID.exec(pickId) === null) fail(`${label}.pick_id is not a pick id: ${pickId}`);
  if (!STATUSES.has(data.status)) {
    fail(`${label}.status must be one of ${[...STATUSES].join(", ")}`);
  }

  const hasHomeScore = data.home_score !== undefined;
  const hasAwayScore = data.away_score !== undefined;
  if (hasHomeScore !== hasAwayScore) fail(`${label} must record home_score and away_score together`);
  const hasScores = hasHomeScore && hasAwayScore;
  if (hasScores) {
    for (const key of ["home_score", "away_score"]) {
      if (!Number.isInteger(data[key]) || data[key] < 0) fail(`${label}.${key} must be a non-negative integer`);
    }
  }

  if (data.final_status !== undefined) {
    if (data.status !== "POSTPONED") fail(`${label}.final_status is only valid for POSTPONED`);
    if (data.final_status !== "FINISHED") fail(`${label}.final_status must be FINISHED`);
  }

  for (const key of ["actual_kickoff_at", "regulation_completed_at", "status_determined_at"]) {
    if (data[key] !== undefined) parseUtcStamp(data[key], `${label}.${key}`);
  }

  if (data.interruption_disposition !== undefined) {
    if (data.status !== "ABANDONED") fail(`${label}.interruption_disposition is only valid for ABANDONED`);
    if (!DISPOSITIONS.has(data.interruption_disposition)) {
      fail(`${label}.interruption_disposition must be one of ${[...DISPOSITIONS].join(", ")}`);
    }
    if (data.interruption_disposition === "RESUMED_SAME_FIXTURE" && data.regulation_completed_at === undefined) {
      fail(`${label}.regulation_completed_at is required when resuming the same fixture`);
    }
    if (data.interruption_disposition === "UNKNOWN" && data.status_determined_at === undefined) {
      fail(`${label}.status_determined_at is required when the disposition is UNKNOWN`);
    }
  } else if (data.status === "ABANDONED") {
    fail(`${label}.interruption_disposition is required when status is ABANDONED`);
  }

  if (data.status === "PLAYED" && !hasScores) {
    fail(`${label}.home_score and away_score are required when status is PLAYED`);
  }
  if (data.status === "POSTPONED") {
    if (data.final_status === "FINISHED") {
      if (data.actual_kickoff_at === undefined) fail(`${label}.actual_kickoff_at is required for a completed postponed match`);
      if (!hasScores) fail(`${label}.home_score and away_score are required for a completed postponed match`);
    } else if (hasScores) {
      fail(`${label} may only record postponed scores when final_status is FINISHED`);
    }
  }
  if (data.status === "ABANDONED") {
    if (data.actual_kickoff_at === undefined) fail(`${label}.actual_kickoff_at is required when status is ABANDONED`);
    if (data.interruption_disposition === "RESUMED_SAME_FIXTURE") {
      if (!hasScores) fail(`${label}.home_score and away_score are required when an abandoned fixture resumes`);
    } else if (hasScores) {
      fail(`${label} may only record abandoned scores when the same fixture resumes`);
    }
  }
  if (data.status === "CANCELLED" && hasScores) fail(`${label} may not record scores when status is CANCELLED`);

  if (data.status === "POSTPONED" && data.actual_kickoff_at === undefined
    && data.final_status === undefined && data.status_determined_at === undefined) {
    fail(`${label}.status_determined_at is required for a postponed match without a new kickoff`);
  }

  if (data.corrects !== undefined) {
    if (typeof data.corrects !== "string" || SHA256.exec(data.corrects) === null) {
      fail(`${label}.corrects must be a lowercase sha256 hex string`);
    }
    if (typeof data.note !== "string" || data.note.trim() === "") {
      fail(`${label}.note must be a non-empty string for a correction`);
    }
    if (!CORRECTION_KINDS.has(data.correction_kind)) {
      fail(`${label}.correction_kind must be one of ${[...CORRECTION_KINDS].join(", ")}`);
    }
    if (data.evidence_refs !== undefined && (!Array.isArray(data.evidence_refs)
      || data.evidence_refs.some((value) => typeof value !== "string" || value.trim() === ""))) {
      fail(`${label}.evidence_refs must be an array of non-empty strings`);
    }
    if (data.correction_kind !== "SETTLEMENT_LOGIC_ERROR"
      && (!Array.isArray(data.evidence_refs) || data.evidence_refs.length === 0)) {
      fail(`${label}.evidence_refs must contain at least one source for ${data.correction_kind}`);
    }
  } else if (data.correction_kind !== undefined || data.evidence_refs !== undefined) {
    fail(`${label}.correction_kind and evidence_refs are only valid with corrects`);
  }
  if (data.note !== undefined && typeof data.note !== "string") fail(`${label}.note must be a string`);

  return { pickId, status: data.status };
}

function jsonFilesUnder(root, dir) {
  const absoluteDir = join(root, dir);
  const found = [];
  let entries;
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const child = join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      found.push(...jsonFilesUnder(root, `${dir}/${entry.name}`));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      found.push(child);
    } else if (entry.isFile() && entry.name !== ".gitkeep") {
      fail(`unexpected non-JSON file in ${dir}: ${entry.name}`);
    }
  }
  return found;
}

function readJson(absolutePath, relativePath) {
  let raw;
  try {
    raw = readFileSync(absolutePath, "utf8");
  } catch (error) {
    fail(`cannot read ${relativePath}: ${error.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
  }
  return { data, raw };
}

export function loadPicks(root) {
  const picks = new Map();
  for (const absolutePath of jsonFilesUnder(root, "picks")) {
    const relativePath = absolutePath.slice(root.length + 1);
    const { data } = readJson(absolutePath, relativePath);
    const info = validatePickObject(data, relativePath, relativePath.replaceAll(sep, "/"));
    if (picks.has(info.id)) fail(`duplicate pick id ${info.id}`);
    picks.set(info.id, {
      id: info.id,
      path: relativePath.replaceAll(sep, "/"),
      absolutePath,
      kickoffEpoch: info.kickoffEpoch,
      kickoffUtc: data.kickoff_utc,
      frozen: {
        selection: info.selection,
        line: info.line,
        normalized_decimal_price: info.normalized,
        frozen_scheduled_kickoff_at: data.kickoff_utc,
      },
      data,
    });
  }
  return picks;
}

// Loads every result chain: root result file <pick_id>.json, then corrections
// <pick_id>.rN.json linked by `corrects` holding the sha256 of the exact bytes
// of the file being corrected. Chains must be linear and contradiction-free.
export function loadResultChains(root, picks) {
  const chains = new Map();
  const byHash = new Map();
  const files = jsonFilesUnder(root, "results");

  const parsed = [];
  for (const absolutePath of files) {
    const relativePath = absolutePath.slice(root.length + 1).replaceAll(sep, "/");
    const { data } = readJson(absolutePath, relativePath);
    const info = validateResultObject(data, relativePath);
    if (!picks.has(info.pickId)) fail(`${relativePath} references unknown pick ${info.pickId}`);
    const hash = sha256File(absolutePath);
    if (byHash.has(hash)) fail(`${relativePath} duplicates the exact bytes of ${byHash.get(hash)}`);
    byHash.set(hash, relativePath);
    parsed.push({ relativePath, absolutePath, data, pickId: info.pickId, hash });
  }

  for (const pickId of picks.keys()) chains.set(pickId, []);

  const roots = new Map();
  for (const file of parsed) {
    if (file.data.corrects === undefined) {
      const expectedName = `results/${file.pickId.slice(0, 4)}/${file.pickId}.json`;
      if (file.relativePath !== expectedName) {
        fail(`the first result for ${file.pickId} must be ${expectedName}, found ${file.relativePath}`);
      }
      if (roots.has(file.pickId)) fail(`duplicate first result for ${file.pickId}`);
      roots.set(file.pickId, file);
    }
  }
  for (const file of parsed) {
    if (file.data.corrects === undefined) continue;
    if (!roots.has(file.pickId)) {
      fail(`${file.relativePath} corrects a chain with no root result file for ${file.pickId}`);
    }
  }

  for (const [pickId, rootFile] of roots) {
    const chain = [rootFile];
    const correctedHashes = new Set();
    let current = rootFile;
    for (;;) {
      const next = parsed.find((file) => file.data.corrects === current.hash);
      if (next === undefined) break;
      if (next.pickId !== pickId) {
        fail(`${next.relativePath} corrects a file of pick ${pickId} but declares pick ${next.pickId}`);
      }
      const expectedName = `results/${pickId.slice(0, 4)}/${pickId}.r${chain.length + 1}.json`;
      if (next.relativePath !== expectedName) {
        fail(`revision ${chain.length + 1} for ${pickId} must be ${expectedName}, found ${next.relativePath}`);
      }
      if (correctedHashes.has(current.hash)) fail(`result chain for ${pickId} forks at ${current.relativePath}`);
      correctedHashes.add(current.hash);
      const parentContent = { ...current.data };
      const childContent = { ...next.data };
      for (const content of [parentContent, childContent]) {
        delete content.corrects;
        delete content.correction_kind;
        delete content.evidence_refs;
        delete content.note;
      }
      if (JSON.stringify(parentContent) === JSON.stringify(childContent)
        && next.data.correction_kind !== "SETTLEMENT_LOGIC_ERROR") {
        fail(`${next.relativePath} corrects ${current.relativePath} without changing any result facts`);
      }
      chain.push(next);
      current = next;
    }
    for (const file of parsed) {
      if (file.pickId === pickId && !chain.includes(file)) {
        fail(`${file.relativePath} is not linked into the result chain of ${file.pickId}`);
      }
    }
    chains.set(pickId, chain);
  }
  return chains;
}

// Maps a ledger result record onto the frozen Settlement Rules v1 facts that
// evaluateSettlement consumes. The ledger never writes a classification; the
// engine derives it.
export function factsForResult(data) {
  switch (data.status) {
    case "PLAYED":
      return {
        match_status: "FINISHED",
        home_score: data.home_score,
        away_score: data.away_score,
        ...(data.actual_kickoff_at !== undefined ? { actual_kickoff_at: data.actual_kickoff_at } : {}),
      };
    case "POSTPONED":
      return {
        match_status: "POSTPONED",
        ...(data.actual_kickoff_at !== undefined ? { actual_kickoff_at: data.actual_kickoff_at } : {}),
        ...(data.final_status !== undefined ? { final_status: data.final_status } : {}),
        ...(data.home_score !== undefined ? { home_score: data.home_score } : {}),
        ...(data.away_score !== undefined ? { away_score: data.away_score } : {}),
        ...(data.status_determined_at !== undefined ? { status_determined_at: data.status_determined_at } : {}),
      };
    case "CANCELLED":
      return { match_status: "CANCELLED" };
    case "ABANDONED":
      return {
        match_status: "ABANDONED",
        actual_kickoff_at: data.actual_kickoff_at,
        interruption_disposition: data.interruption_disposition,
        ...(data.home_score !== undefined ? { home_score: data.home_score } : {}),
        ...(data.away_score !== undefined ? { away_score: data.away_score } : {}),
        ...(data.regulation_completed_at !== undefined ? { regulation_completed_at: data.regulation_completed_at } : {}),
        ...(data.status_determined_at !== undefined ? { status_determined_at: data.status_determined_at } : {}),
      };
    default:
      fail(`unknown status ${data.status}`);
  }
}

export function evaluateChain(pick, chain) {
  return chain.map((file, index) => {
    const facts = factsForResult(file.data);
    const result = evaluateSettlement(pick.frozen, facts);
    return {
      revision: index + 1,
      result_file: file.relativePath,
      result_file_sha256: file.hash,
      facts,
      result,
    };
  });
}

export function validateLedger(root, options = {}) {
  const problems = [];
  const collect = (fn) => {
    try {
      fn();
    } catch (error) {
      if (error instanceof LedgerError) problems.push(error.message);
      else problems.push(`${error.message}`);
    }
  };

  let picks;
  collect(() => { picks = loadPicks(root); });
  if (picks === undefined) return problems;

  collect(() => { loadResultChains(root, picks); });

  if (options.gatePaths !== undefined && options.gatePaths.length > 0) {
    const now = options.now ?? Date.now();
    const minimum = 2 * 60 * 60 * 1000;
    for (const gatePath of options.gatePaths) {
      collect(() => {
        const absolutePath = join(root, gatePath);
        const { data } = readJson(absolutePath, gatePath);
        const info = validatePickObject(data, gatePath, gatePath.replaceAll(sep, "/"));
        if (!picks.has(info.id)) throw new LedgerError(`${gatePath} not found among loaded picks`);
        const remaining = info.kickoffEpoch - now;
        if (remaining < minimum) {
          throw new LedgerError(
            `${gatePath} must be published at least 2 hours before kickoff; ` +
            `${Math.floor(remaining / 60000)} minutes remain`,
          );
        }
      });
    }
  }
  if (options.resultGatePaths !== undefined && options.resultGatePaths.length > 0) {
    const now = options.now ?? Date.now();
    for (const resultPath of options.resultGatePaths) {
      collect(() => {
        const { data } = readJson(join(root, resultPath), resultPath);
        const info = validateResultObject(data, resultPath);
        const pick = picks.get(info.pickId);
        if (pick === undefined) throw new LedgerError(`${resultPath} references unknown pick ${info.pickId}`);
        if (now < pick.kickoffEpoch) {
          throw new LedgerError(`${resultPath} may not be published before kickoff ${pick.kickoffUtc}`);
        }
      });
    }
  }
  return problems;
}

export function isMainScript(importMetaUrl) {
  if (process.argv[1] === undefined) return false;
  return importMetaUrl === pathToFileURL(resolve(process.argv[1])).href;
}
