#!/usr/bin/env node
// Rebuilds the public standings projection from authoritative settlements.
// The projection is never a source of truth: deleting it and rerunning this
// script must reproduce it byte for byte, including after corrections.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildPerformanceProjection } from "../src/performance/performance-projection.ts";
import { isMainScript, REPO_ROOT, STANDINGS_SCHEMA } from "./lib.mjs";
import { buildSettlements } from "./settle.mjs";

export function buildStandings(root) {
  const { picks, settlements } = buildSettlements(root);
  const projectionInput = [];
  for (const [pickId, pick] of picks) {
    const record = settlements.get(pickId);
    const head = record?.current;
    const settledRevisions = head?.record_state === "SETTLED"
      ? (record?.revisions ?? []).filter((revision) => revision.result.record_state === "SETTLED").map((revision) => ({
        settlement_id: revision.result_file_sha256,
        revision: revision.revision,
        classification: revision.result.classification,
        net_return: revision.result.net_return,
      }))
      : [];
    projectionInput.push({
      pick_id: pickId,
      kickoff_utc: pick.kickoffUtc,
      normalized_decimal_price: pick.frozen.normalized_decimal_price,
      current_settlement_id: head !== undefined && head.record_state === "SETTLED"
        ? head.result_file_sha256
        : null,
      settlements: settledRevisions,
    });
  }
  const projection = buildPerformanceProjection(projectionInput);
  return {
    schema: STANDINGS_SCHEMA,
    unit_stake: "1",
    rules: "settlement-rules.v1",
    ...projection,
  };
}

export function main(root = REPO_ROOT) {
  const standings = buildStandings(root);
  const dir = join(root, "standings");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "standings.json"), `${JSON.stringify(standings, null, 2)}\n`);
  console.log(
    `standings rebuilt: ${standings.pick_count} picks, n=${standings.n}, ` +
    `pending=${standings.pending_count}, void=${standings.void_count}, ` +
    `roi=${standings.roi_percent === null ? "-" : `${standings.roi_percent}%`}`,
  );
}

if (isMainScript(import.meta.url)) main();
