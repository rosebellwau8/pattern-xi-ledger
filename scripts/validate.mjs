#!/usr/bin/env node
// Validates every pick and result file, correction chains, and — with
// --gate — the publication rule for newly added pick files: a pick must be
// visible in the public PR at least 2 hours before kickoff. The gate compares
// against the machine clock; on GitHub Actions that clock is the platform's.

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
