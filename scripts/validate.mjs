#!/usr/bin/env node
// Validates picks, results, correction chains and lightweight publication
// evidence. --gate remains a local preflight for selected new pick files; the
// formal two-hour rule is bound to each X receipt or batch commitment.

import { isMainScript, loadPicks, REPO_ROOT, validateLedger } from "./lib.mjs";
import { loadPublicationEvidence } from "./publication-evidence.mjs";

export function runValidation(root, {
  gatePaths = [], resultGatePaths = [], now, requirePublicationEvidence = false,
} = {}) {
  const problems = validateLedger(root, { gatePaths, resultGatePaths, now });
  if (problems.length === 0 && requirePublicationEvidence) {
    try {
      loadPublicationEvidence(root, loadPicks(root), { requireEveryPick: true });
    } catch (error) {
      problems.push(error.message);
    }
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  let gatePaths = [];
  const gateIndex = args.indexOf("--gate");
  if (gateIndex !== -1) {
    gatePaths = args.slice(gateIndex + 1).filter((value) => value !== "--");
  }
  const root = process.env.PATTERN_XI_LEDGER_ROOT ?? REPO_ROOT;
  const problems = runValidation(root, { gatePaths, requirePublicationEvidence: true });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`ERROR: ${problem}`);
    console.error(`validation failed: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log("validation passed: ledger, correction chains, and publication evidence are consistent");
}

if (isMainScript(import.meta.url)) main();
