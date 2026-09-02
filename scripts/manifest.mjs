#!/usr/bin/env node
// Builds an immutable, complete snapshot of the formal pick ledger at an exact
// main commit. Git author/committer timestamps are intentionally irrelevant.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isMainScript, REPO_ROOT, sha256File } from "./lib.mjs";

const MANIFEST_NAME = /^(\d{4}-\d{2}-\d{2})\.txt$/u;
const MANIFEST_ENTRY = /^([0-9a-f]{64})  (picks\/.+\.json)$/gmu;
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const MANIFEST_VERSION = "pattern-xi-ledger-manifest.v2";

function manifestNames(root) {
  const directory = join(root, "manifests");
  return existsSync(directory)
    ? readdirSync(directory).filter((name) => MANIFEST_NAME.test(name)).sort()
    : [];
}

function pickPaths(root) {
  const directory = join(root, "picks");
  if (!existsSync(directory)) return [];
  const paths = [];
  for (const year of readdirSync(directory).filter((name) => /^\d{4}$/u.test(name)).sort()) {
    for (const name of readdirSync(join(directory, year)).sort()) {
      if (name.endsWith(".json")) paths.push(`picks/${year}/${name}`);
    }
  }
  return paths;
}

export function buildManifest(root, date, mainCommitSha) {
  const epoch = /^\d{4}-\d{2}-\d{2}$/u.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== date) {
    throw new Error(`date must be YYYY-MM-DD: ${date}`);
  }
  if (typeof mainCommitSha !== "string" || COMMIT_SHA.test(mainCommitSha) === false) {
    throw new Error("main commit SHA must be a lowercase 40- or 64-character hex string");
  }
  const names = manifestNames(root);

  const latest = names.at(-1);
  if (latest !== undefined && date <= latest.slice(0, 10)) {
    throw new Error(`new manifest date ${date} must be newer than the latest manifest ${latest.slice(0, 10)}`);
  }
  const previousHash = latest === undefined ? "NONE" : sha256File(join(root, "manifests", latest));
  const paths = pickPaths(root);
  const entries = paths.map((relativePath) => `${sha256File(join(root, relativePath))}  ${relativePath}`).sort();
  return [
    `manifest_version ${MANIFEST_VERSION}`,
    `snapshot_date ${date}`,
    `main_commit_sha ${mainCommitSha}`,
    `previous_manifest_sha256 ${previousHash}`,
    `pick_count ${paths.length}`,
    ...entries,
    "",
  ].join("\n");
}

export function writeSnapshotManifest(root, date, mainCommitSha) {
  const relativePath = `manifests/${date}.txt`;
  const file = join(root, relativePath);
  mkdirSync(join(root, "manifests"), { recursive: true });
  if (existsSync(file)) return null;
  const content = buildManifest(root, date, mainCommitSha);
  writeFileSync(file, content);
  return relativePath;
}

export function main(
  root = REPO_ROOT,
  date = process.argv[2] ?? new Date().toISOString().slice(0, 10),
  mainCommitSha = process.argv[3],
) {
  const relativePath = writeSnapshotManifest(root, date, mainCommitSha);
  if (relativePath === null) {
    console.log(`snapshot manifest already exists for ${date}; nothing written`);
    return;
  }
  const count = [...readFileSync(join(root, relativePath), "utf8").matchAll(MANIFEST_ENTRY)].length;
  console.log(`complete ledger-state manifest written: ${relativePath} (${count} picks at ${mainCommitSha})`);
}

if (isMainScript(import.meta.url)) main();
