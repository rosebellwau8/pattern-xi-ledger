#!/usr/bin/env node
// Validates every pick and result file, correction chains, and — with
// --gate supports explicit local validation of selected new pick files. The
// authoritative PR publication witness is enforced by validate-pr.mjs using a
// GitHub server-side job event time bound to the exact PR head SHA.

import { join } from "node:path";

import { isMainScript, REPO_ROOT, validateLedger } from "./lib.mjs";

export function runValidation(root, { gatePaths = [], resultGatePaths = [], now } = {}) {
  return validateLedger(root, { gatePaths, resultGatePaths, now });
}

function main() {
  const args = process.argv.slice(2);
  let gatePaths = [];
  const gateIndex = args.indexOf("--gate");
  if (gateIndex !== -1) {
    gatePaths = args.slice(gateIndex + 1).filter((value) => value !== "--");
  }
  const root = process.env.PATTERN_XI_LEDGER_ROOT ?? REPO_ROOT;
  const problems = runValidation(root, { gatePaths });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`ERROR: ${problem}`);
    console.error(`validation failed: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log("validation passed: picks, results, and correction chains are consistent");
}

if (isMainScript(import.meta.url)) main();
