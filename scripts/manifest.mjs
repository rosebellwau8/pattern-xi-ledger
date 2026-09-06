#!/usr/bin/env node
// Builds an immutable, complete snapshot of the formal pick ledger at an exact
// main commit. Git author/committer timestamps are intentionally irrelevant.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { isMainScript, parseUtcStamp, REPO_ROOT, sha256File } from "./lib.mjs";

const MANIFEST_NAME = /^(\d{4}-\d{2}-\d{2})(?:T\d{6}Z)?\.txt$/u;
const MANIFEST_ENTRY = /^([0-9a-f]{64})  (picks\/.+\.json)$/gmu;
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const MANIFEST_VERSION = "pattern-xi-ledger-manifest.v2";

function manifestNames(root) {
  const directory = join(root, "manifests");
  return existsSync(directory)
    ? readdirSync(directory).filter((name) => MANIFEST_NAME.test(name)).sort()
    : [];
}

function pickEntries(root, commit) {
  const git = (args) => execFileSync("git", ["-C", root, ...args], {
    maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    if (git(["cat-file", "-t", commit]).toString().trim() !== "commit") throw new Error("not a commit");
  } catch {
    throw new Error(`main commit SHA must identify an existing commit: ${commit}`);
  }
  return git(["ls-tree", "-r", "-z", commit, "--", "picks"]).toString("utf8").split("\0")
    .filter(Boolean).flatMap((entry) => {
      const tab = entry.indexOf("\t");
      const path = entry.slice(tab + 1);
      if (!path.endsWith(".json")) return [];
      const [mode, type, oid] = entry.slice(0, tab).split(" ");
      if (!/^picks\/\d{4}\/[a-z0-9-]+\.json$/u.test(path)
        || type !== "blob" || !["100644", "100755"].includes(mode)) {
        throw new Error(`invalid pick entry in declared commit: ${path}`);
      }
      const digest = createHash("sha256").update(git(["cat-file", "blob", oid])).digest("hex");
      return [`${digest}  ${path}`];
    }).sort();
}

function snapshotInfo(value) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)) {
    parseUtcStamp(value, "snapshot UTC time");
    return { date: value.slice(0, 10), time: value, stem: value.replaceAll(":", "") };
  }
  const date = value;
  const epoch = /^\d{4}-\d{2}-\d{2}$/u.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== date) {
    throw new Error(`snapshot must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ: ${date}`);
  }
  return { date, time: null, stem: date };
}

export function buildManifest(root, date, mainCommitSha) {
  const snapshot = snapshotInfo(date);
  if (typeof mainCommitSha !== "string" || COMMIT_SHA.test(mainCommitSha) === false) {
    throw new Error("main commit SHA must be a lowercase 40- or 64-character hex string");
  }
  const names = manifestNames(root);

  const latest = names.at(-1);
  if (latest !== undefined && snapshot.stem <= latest.slice(0, -4)) {
    throw new Error(`new manifest date ${date} must be newer than the latest manifest ${latest}`);
  }
  const previousHash = latest === undefined ? "NONE" : sha256File(join(root, "manifests", latest));
  const entries = pickEntries(root, mainCommitSha);
  return [
    `manifest_version ${MANIFEST_VERSION}`,
    `snapshot_date ${snapshot.date}`,
    ...(snapshot.time === null ? [] : [`snapshot_time_utc ${snapshot.time}`]),
    `main_commit_sha ${mainCommitSha}`,
    `previous_manifest_sha256 ${previousHash}`,
    `pick_count ${entries.length}`,
    ...entries,
    "",
  ].join("\n");
}

export function writeSnapshotManifest(root, date, mainCommitSha) {
  const relativePath = `manifests/${snapshotInfo(date).stem}.txt`;
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
