#!/usr/bin/env node
// One-command solo-maintainer publishing flow:
// production export -> canonical picks -> validation/derivation -> branch/PR
// -> GitHub auto-merge after the protected Ledger integrity check succeeds.

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { importProductionExport } from "./import-production.mjs";
import { isMainScript, REPO_ROOT } from "./lib.mjs";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

export function publicationBranchName(data, sourceBytes) {
  const date = new Date(data.exported_at);
  if (Number.isNaN(date.valueOf())) throw new Error("exported_at must be an ISO timestamp");
  const digest = createHash("sha256").update(sourceBytes).digest("hex").slice(0, 8);
  return `publish/${date.toISOString().slice(0, 10)}-${digest}`;
}

function ensureCleanMain() {
  const status = run("git", ["status", "--porcelain"], { capture: true }).trim();
  if (status !== "") throw new Error("working tree must be clean before publishing a production export");
  const branch = run("git", ["branch", "--show-current"], { capture: true }).trim();
  if (branch !== "main") throw new Error(`publishing must start on main, currently ${branch || "detached HEAD"}`);
}

export function publishProduction(sourcePath, { dryRun = false, autoMerge = true } = {}) {
  const sourceBytes = readFileSync(sourcePath);
  let data;
  try {
    data = JSON.parse(sourceBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`production export is not valid JSON: ${error.message}`);
  }

  if (dryRun) return { ...importProductionExport(REPO_ROOT, data, { dryRun: true }), branch: null, pr: null };

  ensureCleanMain();
  run("git", ["fetch", "origin", "main"]);
  run("git", ["merge", "--ff-only", "origin/main"]);
  const preview = importProductionExport(REPO_ROOT, data, { dryRun: true });
  if (preview.written.length === 0) {
    throw new Error(`no new eligible picks were generated (${preview.unchanged.length} unchanged, ${preview.skippedLate.length} late)`);
  }
  const branch = publicationBranchName(data, sourceBytes);
  run("git", ["switch", "-c", branch]);

  const imported = importProductionExport(REPO_ROOT, data);
  run(process.execPath, ["scripts/validate.mjs"]);
  run(process.execPath, ["scripts/settle.mjs"]);
  run(process.execPath, ["scripts/standings.mjs"]);
  // The command starts from a verified-clean tree, so staging all changes can
  // only capture files produced by this import/derivation run. This also
  // records deletion of any stale derived settlement files.
  run("git", ["add", "--all"]);
  const staged = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: REPO_ROOT });
  if (staged.error !== undefined || (staged.status !== 0 && staged.status !== 1)) {
    throw new Error(`unable to inspect staged production changes: ${staged.error?.message ?? `git exited ${staged.status}`}`);
  }
  if (staged.status === 0) throw new Error("production import produced no staged changes");

  const date = data.exported_at.slice(0, 10);
  run("git", ["commit", "-m", `publish: add eligible picks from ${date}`]);
  run("git", ["push", "--set-upstream", "origin", branch]);
  const body = [
    "Automated production export handoff.",
    "",
    `- New picks: ${imported.written.length}`,
    `- Late picks skipped: ${imported.skippedLate.length}`,
    "- Internal production patterns were not imported.",
    "- Merge is gated by Ledger integrity.",
  ].join("\n");
  const pr = run("gh", [
    "pr", "create", "--base", "main", "--head", branch,
    "--title", `publish: ${imported.written.length} pick${imported.written.length === 1 ? "" : "s"} from ${date}`,
    "--body", body,
  ], { capture: true }).trim();
  if (autoMerge) run("gh", ["pr", "merge", "--auto", "--merge", pr]);
  return { ...imported, branch, pr };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const autoMerge = !args.includes("--no-auto-merge");
  const source = args.find((arg) => !arg.startsWith("--"));
  if (source === undefined) {
    console.error("usage: node scripts/publish-production.mjs [--dry-run] [--no-auto-merge] <export.json>");
    process.exit(2);
  }
  try {
    const result = publishProduction(source, { dryRun, autoMerge });
    for (const skipped of result.skippedLate) console.warn(`SKIP LATE: ${skipped.match} (${skipped.reason})`);
    if (dryRun) {
      console.log(`dry run: ${result.written.length} new, ${result.unchanged.length} unchanged, ${result.skippedLate.length} late`);
    } else {
      console.log(`pull request: ${result.pr}`);
      console.log(autoMerge ? "auto-merge armed; GitHub will merge after required checks pass" : "auto-merge disabled");
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (isMainScript(import.meta.url)) main();
