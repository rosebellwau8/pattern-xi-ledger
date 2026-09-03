#!/usr/bin/env node
// Enforces the pull-request boundary for authoritative ledger inputs.
// Existing pick/result JSON is immutable: corrections are new result files.

import { execFileSync } from "node:child_process";

import { isMainScript, loadPicks, REPO_ROOT, validateLedger } from "./lib.mjs";
import { loadPublicationEvidence } from "./publication-evidence.mjs";

export function analyzeLedgerDiff(output) {
  const gatePaths = [];
  const resultGatePaths = [];
  const problems = [];

  for (const line of output.split("\n")) {
    if (line.trim() === "") continue;
    const [status, ...paths] = line.split("\t");
    const jsonPaths = paths.filter((path) =>
      /^(?:picks|results|publication\/(?:receipts|commitments|reveals))\/.+\.json$/u
        .test(path.replaceAll("\\", "/")),
    );
    if (jsonPaths.length === 0) continue;

    if (status !== "A") {
      problems.push(
        `${jsonPaths.join(", ")} changes an existing authoritative JSON (${status}); ` +
        "picks, results and publication evidence are append-only; use a new correction or evidence record",
      );
      continue;
    }
    for (const path of jsonPaths) {
      const normalized = path.replaceAll("\\", "/");
      if (normalized.startsWith("picks/")) gatePaths.push(normalized);
      if (normalized.startsWith("results/")) resultGatePaths.push(normalized);
    }
  }

  return { gatePaths, resultGatePaths, problems };
}

export function validatePullRequest(root, base, head = "HEAD", { now = Date.now() } = {}) {
  const output = execFileSync(
    "git",
    ["-C", root, "diff", "--name-status", "--find-renames", `${base}...${head}`, "--", "picks", "results", "publication"],
    { encoding: "utf8" },
  );
  const analyzed = analyzeLedgerDiff(output);
  const problems = [
    ...analyzed.problems,
    ...validateLedger(root, {
      resultGatePaths: analyzed.resultGatePaths,
      now,
    }),
  ];
  if (problems.length === 0) {
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
  const positional = [];
  positional.push(...args);
  const [base, head = "HEAD"] = positional;
  if (base === undefined) {
    console.error(
      "usage: node scripts/validate-pr.mjs <base-revision> [head-revision]",
    );
    process.exit(2);
  }

  let problems;
  try {
    problems = validatePullRequest(REPO_ROOT, base, head);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`ERROR: ${problem}`);
    console.error(`pull request validation failed: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(
    "pull request validation passed: authoritative JSON is append-only and every pick has " +
    "a valid two-hour public receipt or revealed batch commitment",
  );
}

if (isMainScript(import.meta.url)) main();
