#!/usr/bin/env node
// Enforces the pull-request boundary for authoritative ledger inputs.
// Existing pick/result JSON is immutable: corrections are new result files.

import { execFileSync } from "node:child_process";

import { isMainScript, REPO_ROOT, validateLedger } from "./lib.mjs";

export function analyzeLedgerDiff(output) {
  const gatePaths = [];
  const problems = [];

  for (const line of output.split("\n")) {
    if (line.trim() === "") continue;
    const [status, ...paths] = line.split("\t");
    const jsonPaths = paths.filter((path) =>
      /^(?:picks|results)\/.+\.json$/u.test(path.replaceAll("\\", "/")),
    );
    if (jsonPaths.length === 0) continue;

    if (status !== "A") {
      problems.push(
        `${jsonPaths.join(", ")} changes an existing authoritative JSON (${status}); ` +
        "pick/result files are append-only, so add a result correction file instead",
      );
      continue;
    }
    for (const path of jsonPaths) {
      const normalized = path.replaceAll("\\", "/");
      if (normalized.startsWith("picks/")) gatePaths.push(normalized);
    }
  }

  return { gatePaths, problems };
}

export function validatePullRequest(root, base, head = "HEAD", now) {
  const output = execFileSync(
    "git",
    ["-C", root, "diff", "--name-status", "--find-renames", `${base}...${head}`, "--", "picks", "results"],
    { encoding: "utf8" },
  );
  const analyzed = analyzeLedgerDiff(output);
  return [
    ...analyzed.problems,
    ...validateLedger(root, { gatePaths: analyzed.gatePaths, now }),
  ];
}

function main() {
  const [base, head = "HEAD"] = process.argv.slice(2);
  if (base === undefined) {
    console.error("usage: node scripts/validate-pr.mjs <base-revision> [head-revision]");
    process.exit(2);
  }

  const problems = validatePullRequest(REPO_ROOT, base, head);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`ERROR: ${problem}`);
    console.error(`pull request validation failed: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log("pull request validation passed: authoritative JSON is append-only and new picks meet the 2-hour gate");
}

if (isMainScript(import.meta.url)) main();
