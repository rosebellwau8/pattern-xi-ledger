#!/usr/bin/env node
// Builds an immutable manifest containing every pick that is not present in a
// previous manifest. This intentionally does not trust Git author/committer
// timestamps: a late workflow run simply catches up on the next UTC batch.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isMainScript, REPO_ROOT, sha256File } from "./lib.mjs";

const MANIFEST_NAME = /^(\d{4}-\d{2}-\d{2})\.txt$/u;
const MANIFEST_ENTRY = /^([0-9a-f]{64})  (picks\/.+\.json)$/gmu;

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

function anchoredPaths(root, names) {
  const anchored = new Set();
  for (const name of names) {
    const content = readFileSync(join(root, "manifests", name), "utf8");
    for (const match of content.matchAll(MANIFEST_ENTRY)) anchored.add(match[2]);
  }
  return anchored;
}

export function buildManifest(root, date) {
  const epoch = /^\d{4}-\d{2}-\d{2}$/u.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== date) {
    throw new Error(`date must be YYYY-MM-DD: ${date}`);
  }
  const names = manifestNames(root);
  const anchored = anchoredPaths(root, names);
  const pending = pickPaths(root).filter((path) => !anchored.has(path));
  if (pending.length === 0) return null;

  const latest = names.at(-1);
  if (latest !== undefined && date <= latest.slice(0, 10)) {
    throw new Error(`new manifest date ${date} must be newer than the latest manifest ${latest.slice(0, 10)}`);
  }
  const previousHash = latest === undefined ? "NONE" : sha256File(join(root, "manifests", latest));
  const entries = pending.map((relativePath) => `${sha256File(join(root, relativePath))}  ${relativePath}`).sort();
  return [
    `# pattern-xi manifest ${date}`,
    `# previous_manifest_sha256 ${previousHash}`,
    ...entries,
    "",
  ].join("\n");
}

export function writePendingManifest(root, date) {
  const content = buildManifest(root, date);
  if (content === null) return null;
  const relativePath = `manifests/${date}.txt`;
  const file = join(root, relativePath);
  mkdirSync(join(root, "manifests"), { recursive: true });
  if (existsSync(file)) throw new Error(`${relativePath} already exists and manifests are immutable`);
  writeFileSync(file, content);
  return relativePath;
}

export function main(root = REPO_ROOT, date = process.argv[2] ?? new Date().toISOString().slice(0, 10)) {
  const relativePath = writePendingManifest(root, date);
  if (relativePath === null) {
    console.log("all picks are already represented in a manifest; nothing written");
    return;
  }
  const count = [...readFileSync(join(root, relativePath), "utf8").matchAll(MANIFEST_ENTRY)].length;
  console.log(`manifest written: ${relativePath} (${count} picks)`);
}

if (isMainScript(import.meta.url)) main();
