#!/usr/bin/env node
// Converts the production system's public export into canonical ledger picks.
// The boundary is deliberately narrow: model patterns and internal notes never
// cross into the public repository.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ExactDecimal } from "../src/settlement/exact-decimal.ts";
import { isMainScript, PICK_SCHEMA, REPO_ROOT, validatePickObject } from "./lib.mjs";

const EXPORT_SCHEMA = "production-public-export.v1";
const TWO_HOURS = 2 * 60 * 60 * 1000;

function fail(message) {
  throw new Error(`production export: ${message}`);
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value.trim();
}

function instant(value, label) {
  const text = nonEmpty(value, label);
  const epoch = Date.parse(text);
  if (!Number.isFinite(epoch)) fail(`${label} must be an ISO timestamp`);
  return epoch;
}

function cleanTeam(value, label) {
  let team = nonEmpty(value, label);
  team = team.replace(/^\[[^\]]+\]\s*/u, "").replace(/\s*\[[^\]]+\]$/u, "").trim();
  if (team === "") fail(`${label} is empty after removing ranking annotations`);
  return team;
}

export function zonedLocalToUtc(value, timeZone) {
  const local = nonEmpty(value, "kickoff.local");
  const zone = nonEmpty(timeZone, "kickoff.timezone");
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/u.exec(local);
  if (match === null) fail("kickoff.local must match YYYY-MM-DD HH:mm");
  const target = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: 0,
  };
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
  } catch {
    fail(`kickoff.timezone is not supported: ${JSON.stringify(zone)}`);
  }

  const targetEpochLikeUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0);
  let candidate = targetEpochLikeUtc;
  const partsAt = (epoch) => Object.fromEntries(
    formatter.formatToParts(new Date(epoch))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = partsAt(candidate);
    const shownEpochLikeUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
    candidate += targetEpochLikeUtc - shownEpochLikeUtc;
  }
  const verified = partsAt(candidate);
  if (["year", "month", "day", "hour", "minute", "second"].some((key) => verified[key] !== target[key])) {
    fail(`kickoff.local is not a real, unambiguous time in ${zone}: ${local}`);
  }
  return new Date(candidate).toISOString().replace(".000Z", "Z");
}

function normalizeLine(value, label) {
  const text = nonEmpty(value, label);
  if (!/^[+-]?\d+(?:\.\d+)?$/u.test(text)) fail(`${label} must be a decimal handicap`);
  const numeric = Number(text);
  const cents = Math.round(numeric * 100);
  if (!Number.isFinite(numeric) || Math.abs(numeric * 100 - cents) > 1e-9 || cents % 25 !== 0) {
    fail(`${label} must be a whole/half/quarter handicap`);
  }
  const sign = cents < 0 ? "-" : cents > 0 ? "+" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function fixtureId(kickoffUtc, competition, homeTeam, awayTeam) {
  const fixtureKey = JSON.stringify([kickoffUtc, competition, homeTeam, awayTeam]);
  const digest = createHash("sha256").update(fixtureKey).digest("hex").slice(0, 12);
  return `${kickoffUtc.slice(0, 10)}-fixture-${digest}-ah`;
}

export function normalizeProductionExport(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) fail("root must be an object");
  if (data.schema !== EXPORT_SCHEMA) fail(`schema must be ${EXPORT_SCHEMA}`);
  const exportedAt = instant(data.exported_at, "exported_at");
  if (!Array.isArray(data.matches)) fail("matches must be an array");

  const picks = [];
  const skipped = [];
  const seenIds = new Set();
  for (const [index, match] of data.matches.entries()) {
    const label = `matches[${index}]`;
    if (match === null || typeof match !== "object" || Array.isArray(match)) fail(`${label} must be an object`);
    const competition = nonEmpty(match.league, `${label}.league`);
    const homeTeam = cleanTeam(match.home_team, `${label}.home_team`);
    const awayTeam = cleanTeam(match.away_team, `${label}.away_team`);
    if (match.kickoff === null || typeof match.kickoff !== "object") fail(`${label}.kickoff must be an object`);
    const kickoffUtc = zonedLocalToUtc(match.kickoff.local, match.kickoff.timezone);
    const kickoffEpoch = Date.parse(kickoffUtc);
    const market = match.asian_handicap;
    if (market === null || typeof market !== "object" || Array.isArray(market)) fail(`${label}.asian_handicap must be an object`);
    if (market.market !== "full_time_asian_handicap") fail(`${label}.asian_handicap.market must be full_time_asian_handicap`);
    const selection = market.recommendation === "主队" || market.recommendation === "HOME" ? "HOME"
      : market.recommendation === "客队" || market.recommendation === "AWAY" ? "AWAY"
      : fail(`${label}.asian_handicap.recommendation must be 主队, 客队, HOME, or AWAY`);
    const line = normalizeLine(market.recommended_handicap, `${label}.asian_handicap.recommended_handicap`);
    const publishedPrice = nonEmpty(market.recommended_water_raw, `${label}.asian_handicap.recommended_water_raw`);
    let normalizedPrice;
    try {
      normalizedPrice = ExactDecimal.parse(publishedPrice).add(ExactDecimal.parse("1")).toString();
    } catch {
      fail(`${label}.asian_handicap.recommended_water_raw must be a plain decimal Hong Kong price`);
    }
    const observedAt = instant(market.observed_at, `${label}.asian_handicap.observed_at`);
    if (observedAt > exportedAt) fail(`${label}.asian_handicap.observed_at may not be after exported_at`);

    const id = fixtureId(kickoffUtc, competition, homeTeam, awayTeam);
    if (seenIds.has(id)) fail(`${label} duplicates fixture ${id}`);
    seenIds.add(id);
    if (kickoffEpoch - exportedAt < TWO_HOURS) {
      skipped.push({ id, match: `${homeTeam} v ${awayTeam}`, reason: "less than 2 hours remained at exported_at" });
      continue;
    }

    const pick = {
      schema: PICK_SCHEMA,
      id,
      match: `${homeTeam} v ${awayTeam}`,
      competition,
      kickoff_utc: kickoffUtc,
      market: "asian_handicap",
      selection,
      line,
      published_price: publishedPrice,
      published_price_format: "HONG_KONG_ODDS",
      normalized_decimal_price: normalizedPrice,
      price_source: nonEmpty(market.provider, `${label}.asian_handicap.provider`),
    };
    validatePickObject(pick, label, `picks/${id.slice(0, 4)}/${id}.json`);
    picks.push(pick);
  }
  return { exportedAt: new Date(exportedAt).toISOString(), picks, skipped };
}

export function importProductionExport(root, data, { dryRun = false } = {}) {
  const normalized = normalizeProductionExport(data);
  const written = [];
  const unchanged = [];
  for (const pick of normalized.picks) {
    const relativePath = `picks/${pick.id.slice(0, 4)}/${pick.id}.json`;
    const file = join(root, relativePath);
    const content = `${JSON.stringify(pick, null, 2)}\n`;
    if (existsSync(file)) {
      if (readFileSync(file, "utf8") !== content) fail(`${relativePath} conflicts with existing ledger content`);
      unchanged.push(relativePath);
      continue;
    }
    written.push(relativePath);
    if (!dryRun) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }
  return { written, unchanged, skippedLate: normalized.skipped };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const source = args.find((arg) => arg !== "--dry-run");
  if (source === undefined) {
    console.error("usage: node scripts/import-production.mjs [--dry-run] <export.json|->");
    process.exit(2);
  }
  const text = source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    console.error(`production export is not valid JSON: ${error.message}`);
    process.exit(1);
  }
  try {
    const result = importProductionExport(REPO_ROOT, data, { dryRun });
    for (const skipped of result.skippedLate) console.warn(`SKIP LATE: ${skipped.match} (${skipped.reason})`);
    console.log(`${dryRun ? "would write" : "written"}: ${result.written.length}; unchanged: ${result.unchanged.length}; late: ${result.skippedLate.length}`);
    for (const path of result.written) console.log(path);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (isMainScript(import.meta.url)) main();

