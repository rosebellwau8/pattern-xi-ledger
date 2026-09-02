#!/usr/bin/env node
// Derives settlement records from picks and result chains. Classification and
// net return always come from the frozen Settlement Rules v1 engine; result
// files may only carry facts. Derived files under settlements/ are committed
// so reviewers see the computed outcome in the PR diff, and CI enforces that
// they are current (rebuild must be a no-op).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  evaluateChain,
  isMainScript,
  loadPicks,
  loadResultChains,
  REPO_ROOT,
  SETTLEMENT_SCHEMA,
} from "./lib.mjs";

export function buildSettlements(root) {
  const picks = loadPicks(root);
  const chains = loadResultChains(root, picks);
  const settlements = new Map();
  for (const [pickId, chain] of chains) {
    if (chain.length === 0) continue;
    const pick = picks.get(pickId);
    const revisions = evaluateChain(pick, chain);
    const head = revisions[revisions.length - 1];
    settlements.set(pickId, {
      schema: SETTLEMENT_SCHEMA,
      pick_id: pickId,
      kickoff_utc: pick.kickoffUtc,
      frozen: pick.frozen,
      revisions,
      current: {
        result_file: head.result_file,
        result_file_sha256: head.result_file_sha256,
        classification: head.result.classification,
        net_return: head.result.net_return,
        record_state: head.result.record_state,
      },
    });
  }
  return { picks, settlements };
}

export function main(root = REPO_ROOT) {
  const { settlements } = buildSettlements(root);
  for (const [pickId, record] of settlements) {
    const dir = join(root, "settlements", pickId.slice(0, 4));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${pickId}.json`);
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  }
  console.log(`settlements written: ${settlements.size}`);
}

if (isMainScript(import.meta.url)) main();
