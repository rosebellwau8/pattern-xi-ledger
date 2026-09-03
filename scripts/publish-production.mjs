#!/usr/bin/env node
// One-command solo-maintainer publishing flow:
// production export -> rendered X copy -> recorded public receipts ->
// canonical picks -> validation/derivation -> protected branch/PR.

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { importProductionExport, normalizeProductionExport } from "./import-production.mjs";
import { isMainScript, loadPicks, REPO_ROOT } from "./lib.mjs";
import { recordPublicReceipt, renderXPost } from "./publication.mjs";
import { loadPublicationEvidence } from "./publication-evidence.mjs";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

export function publicationBranchName(data, sourceBytes, receiptBytes = Buffer.alloc(0)) {
  const date = new Date(data.exported_at);
  if (Number.isNaN(date.valueOf())) throw new Error("exported_at must be an ISO timestamp");
  const digest = createHash("sha256").update(sourceBytes).update(receiptBytes).digest("hex").slice(0, 8);
  return `publish/${date.toISOString().slice(0, 10)}-${digest}`;
}

function ensureCleanMain() {
  const status = run("git", ["status", "--porcelain"], { capture: true }).trim();
  if (status !== "") throw new Error("working tree must be clean before publishing a production export");
  const branch = run("git", ["branch", "--show-current"], { capture: true }).trim();
  if (branch !== "main") throw new Error(`publishing must start on main, currently ${branch || "detached HEAD"}`);
}

function parseReceiptInput(bytes) {
  let data;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`publication receipts input is not valid JSON: ${error.message}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)
    || data.schema !== "pattern-xi.publication-receipts-input.v1" || !Array.isArray(data.receipts)) {
    throw new Error("publication receipts input must use pattern-xi.publication-receipts-input.v1 with a receipts array");
  }
  for (const key of Object.keys(data)) {
    if (key !== "schema" && key !== "receipts") throw new Error(`publication receipts input has unknown field "${key}"`);
  }
  const receipts = new Map();
  for (const [index, receipt] of data.receipts.entries()) {
    if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
      throw new Error(`publication receipts input receipts[${index}] must be an object`);
    }
    for (const key of Object.keys(receipt)) {
      if (!["pick_id", "url", "published_at"].includes(key)) {
        throw new Error(`publication receipts input receipts[${index}] has unknown field "${key}"`);
      }
    }
    if (typeof receipt.pick_id !== "string" || receipts.has(receipt.pick_id)) {
      throw new Error(`publication receipts input has an invalid or duplicate pick_id at receipts[${index}]`);
    }
    receipts.set(receipt.pick_id, receipt);
  }
  return receipts;
}

function installReceipts(root, writtenPaths, receipts, options = {}) {
  const eligibleIds = writtenPaths.map((path) => path.split("/").at(-1).replace(/\.json$/u, ""));
  for (const id of receipts.keys()) {
    if (!eligibleIds.includes(id)) throw new Error(`publication receipt references non-new or ineligible pick ${id}`);
  }
  if (receipts.size !== eligibleIds.length) {
    const missing = eligibleIds.filter((id) => !receipts.has(id));
    throw new Error(`publication receipt missing for ${missing.join(", ")}`);
  }
  return writtenPaths.map((path, index) => {
    const id = eligibleIds[index];
    const receipt = receipts.get(id);
    return recordPublicReceipt(root, path, {
      url: receipt.url,
      publishedAt: receipt.published_at,
    }, options);
  });
}

export function validatePublicationBundle(data, receiptBytes, { eligibleIds } = {}) {
  const receipts = parseReceiptInput(receiptBytes);
  const root = mkdtempSync(join(tmpdir(), "pattern-xi-publication-bundle-"));
  try {
    const imported = importProductionExport(root, data);
    const selectedPaths = eligibleIds === undefined
      ? imported.written
      : imported.written.filter((path) => eligibleIds.includes(path.split("/").at(-1).replace(/\.json$/u, "")));
    if (eligibleIds !== undefined && selectedPaths.length !== eligibleIds.length) {
      throw new Error("publication receipt eligibility does not match the production export");
    }
    installReceipts(root, selectedPaths, receipts);
    loadPublicationEvidence(root, loadPicks(root), { requireEveryPick: eligibleIds === undefined });
    return imported;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function publishProduction(sourcePath, {
  dryRun = false, autoMerge = true, receiptsPath,
} = {}) {
  const sourceBytes = readFileSync(sourcePath);
  let data;
  try {
    data = JSON.parse(sourceBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`production export is not valid JSON: ${error.message}`);
  }

  const normalized = normalizeProductionExport(data);
  const receiptBytes = receiptsPath === undefined ? undefined : readFileSync(receiptsPath);
  if (dryRun) {
    if (receiptBytes !== undefined) validatePublicationBundle(data, receiptBytes);
    const preview = importProductionExport(REPO_ROOT, data, { dryRun: true });
    const newIds = new Set(preview.written.map((path) => path.split("/").at(-1).replace(/\.json$/u, "")));
    const posts = normalized.picks
      .filter((pick) => newIds.has(pick.id))
      .map((pick) => ({ pickId: pick.id, text: renderXPost(pick) }));
    return { ...preview, branch: null, pr: null, posts };
  }
  if (receiptBytes === undefined) {
    throw new Error("--receipts is required: post the dry-run output on X, then supply the recorded status URLs and times");
  }

  ensureCleanMain();
  run("git", ["fetch", "origin", "main"]);
  run("git", ["merge", "--ff-only", "origin/main"]);
  const preview = importProductionExport(REPO_ROOT, data, { dryRun: true });
  if (preview.written.length === 0) {
    throw new Error(`no new eligible picks were generated (${preview.unchanged.length} unchanged, ${preview.skippedLate.length} late)`);
  }
  const eligibleIds = preview.written.map((path) => path.split("/").at(-1).replace(/\.json$/u, ""));
  validatePublicationBundle(data, receiptBytes, { eligibleIds });
  const branch = publicationBranchName(data, sourceBytes, receiptBytes);
  run("git", ["switch", "-c", branch]);

  const imported = importProductionExport(REPO_ROOT, data);
  const receiptFiles = installReceipts(REPO_ROOT, imported.written, parseReceiptInput(receiptBytes));
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
    `- Public X receipts: ${receiptFiles.length}`,
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
  const receiptsIndex = args.indexOf("--receipts");
  const receiptsPath = receiptsIndex === -1 ? undefined : args[receiptsIndex + 1];
  const consumed = new Set(["--dry-run", "--no-auto-merge", "--receipts", receiptsPath]);
  const source = args.find((arg) => !consumed.has(arg));
  if (source === undefined) {
    console.error("usage: node scripts/publish-production.mjs [--dry-run] [--no-auto-merge] [--receipts <receipts.json>] <export.json>");
    process.exit(2);
  }
  try {
    const result = publishProduction(source, { dryRun, autoMerge, receiptsPath });
    for (const skipped of result.skippedLate) console.warn(`SKIP LATE: ${skipped.match} (${skipped.reason})`);
    if (dryRun) {
      console.log(`dry run: ${result.written.length} new, ${result.unchanged.length} unchanged, ${result.skippedLate.length} late`);
      for (const post of result.posts) console.log(`\n--- ${post.pickId} ---\n${post.text}`);
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
