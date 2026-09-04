#!/usr/bin/env node
// Enforces the pull-request boundary for authoritative ledger inputs.
// Existing pick/result JSON is immutable: corrections are new result files.

import { execFileSync } from "node:child_process";

import { isMainScript, parseUtcStamp, REPO_ROOT, validateLedger } from "./lib.mjs";

const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function parsePublicationWitness(value) {
  if (value === undefined) throw new Error("GitHub publication witness time is required");
  return parseUtcStamp(value, "GitHub publication witness time");
}

export function validateExpectedHeadSha(actualHeadSha, expectedHeadSha) {
  if (typeof actualHeadSha !== "string" || COMMIT_SHA.test(actualHeadSha) === false) {
    throw new Error("checked-out head must be a lowercase 40- or 64-character commit SHA");
  }
  if (typeof expectedHeadSha !== "string" || COMMIT_SHA.test(expectedHeadSha) === false) {
    throw new Error("expected head must be a lowercase 40- or 64-character commit SHA");
  }
  if (actualHeadSha !== expectedHeadSha) {
    throw new Error(
      `GitHub PR head ${expectedHeadSha} does not match the checked-out head ${actualHeadSha}`,
    );
  }
}

export function analyzeLedgerDiff(output) {
  const gatePaths = [];
  const resultGatePaths = [];
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
      if (normalized.startsWith("results/")) resultGatePaths.push(normalized);
    }
  }

  return { gatePaths, resultGatePaths, problems };
}

export function validatePullRequest(root, base, head = "HEAD", witness = {}) {
  const now = parsePublicationWitness(witness.witnessTime);
  const actualHeadSha = execFileSync("git", ["-C", root, "rev-parse", head], { encoding: "utf8" }).trim();
  validateExpectedHeadSha(actualHeadSha, witness.expectedHeadSha);
  const output = execFileSync(
    "git",
    ["-C", root, "diff", "--name-status", "--find-renames", `${base}...${head}`, "--", "picks", "results"],
    { encoding: "utf8" },
  );
  const analyzed = analyzeLedgerDiff(output);
  return [
    ...analyzed.problems,
    ...validateLedger(root, {
      gatePaths: analyzed.gatePaths,
      resultGatePaths: analyzed.resultGatePaths,
      now,
    }),
  ];
}

function main() {
  const args = process.argv.slice(2);
  const positional = [];
  let witnessTime;
  let expectedHeadSha;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--witness-time") witnessTime = args[++index];
    else if (argument === "--expected-head-sha") expectedHeadSha = args[++index];
    else positional.push(argument);
  }
  const [base, head = "HEAD"] = positional;
  if (base === undefined) {
    console.error(
      "usage: node scripts/validate-pr.mjs <base-revision> [head-revision] " +
      "--witness-time <GitHub-UTC-time> --expected-head-sha <sha>",
    );
    process.exit(2);
  }

  let problems;
  try {
    problems = validatePullRequest(REPO_ROOT, base, head, { witnessTime, expectedHeadSha });
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
    `pull request validation passed for ${expectedHeadSha}: authoritative JSON is append-only ` +
    `and new picks meet the 2-hour gate at GitHub event time ${witnessTime}`,
  );
}

if (isMainScript(import.meta.url)) main();
