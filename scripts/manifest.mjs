#!/usr/bin/env node
// Builds the daily manifest: the sha256 of every pick file first committed on
// the target UTC date, plus the hash of the previous manifest, forming a hash
// chain. OpenTimestamps then anchors the manifest into the Bitcoin blockchain;
// combined with the Git history this proves each pick existed before kickoff.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isMainScript, REPO_ROOT, sha256File } from "./lib.mjs";

function creationUtcDate(root, relativePath) {
  const output = execFileSync("git", [
    "-C", root, "log", "--diff-filter=A", "--format=%ad", "--date=format:%Y-%m-%d", "--", relativePath,
  ], { encoding: "utf8" });
  const dates = output.trim().split("\n").filter((line) => line !== "");
  if (dates.length === 0) return null;
  return dates[dates.length - 1];
}

export function buildManifest(root, date, { git = true } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.exec(date)) throw new Error(`date must be YYYY-MM-DD: ${date}`);
  const picksDir = join(root, "picks");
  const created = [];
  const years = readdirSync(picksDir).filter((name) => /^\d{4}$/u.exec(name)).sort();
  for (const year of years) {
    for (const name of readdirSync(join(picksDir, year)).sort()) {
      if (!name.endsWith(".json")) continue;
      const relativePath = `picks/${year}/${name}`;
      if (git) {
        const createdOn = creationUtcDate(root, relativePath);
        if (createdOn !== date) continue;
      }
      created.push(`${sha256File(join(root, relativePath))}  ${relativePath}`);
    }
  }
  if (created.length === 0) return null;

  let previousHash = "NONE";
  const manifests = existsSync(join(root, "manifests"))
    ? readdirSync(join(root, "manifests")).filter((name) => /^\d{4}-\d{2}-\d{2}\.txt$/u.exec(name)).sort()
    : [];
  const earlier = manifests.filter((name) => name.slice(0, 10) < date);
  if (earlier.length > 0) {
    previousHash = sha256File(join(root, "manifests", earlier[earlier.length - 1]));
  }
  return [
    `# pattern-xi manifest ${date}`,
    `# previous_manifest_sha256 ${previousHash}`,
    ...created.sort(),
    "",
  ].join("\n");
}

export function main(root = REPO_ROOT) {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const content = buildManifest(root, date);
  if (content === null) {
    console.log(`no picks were first committed on ${date}; no manifest written`);
    return;
  }
  const file = join(root, "manifests", `${date}.txt`);
  writeFileSync(file, content);
  console.log(`manifest written: manifests/${date}.txt (${content.split("\n").length - 3} picks)`);
}

if (isMainScript(import.meta.url)) main();
