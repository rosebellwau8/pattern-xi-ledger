import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildManifest, writeSnapshotManifest } from "../scripts/manifest.mjs";
import { sha256File } from "../scripts/lib.mjs";

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "pattern-xi-manifest-test-"));
  mkdirSync(join(root, "picks/2026"), { recursive: true });
  mkdirSync(join(root, "manifests"), { recursive: true });
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Manifest test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "core.autocrlf", "false");
  return root;
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commitPicks(root) {
  git(root, "add", "picks");
  git(root, "commit", "--allow-empty", "-m", "Snapshot input");
  return git(root, "rev-parse", "HEAD");
}

function write(root, relativePath, content) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}


test("manifest is a versioned complete ledger-state snapshot bound to main", () => {
  const root = makeRoot();
  try {
    const first = write(root, "picks/2026/a.json", "first\n");
    const second = write(root, "picks/2026/b.json", "second\n");
    const MAIN_SHA_A = commitPicks(root);
    const content = buildManifest(root, "2026-09-03", MAIN_SHA_A);
    assert.match(content, /^manifest_version pattern-xi-ledger-manifest\.v2$/mu);
    assert.match(content, /^snapshot_date 2026-09-03$/mu);
    assert.match(content, new RegExp(`^main_commit_sha ${MAIN_SHA_A}$`, "mu"));
    assert.match(content, /^previous_manifest_sha256 NONE$/mu);
    assert.match(content, /^pick_count 2$/mu);
    assert.match(content, new RegExp(`${sha256File(first)}  picks/2026/a\\.json`, "u"));
    assert.match(content, new RegExp(`${sha256File(second)}  picks/2026/b\\.json`, "u"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every later manifest repeats the complete pick ledger and chains to previous bytes", () => {
  const root = makeRoot();
  try {
    write(root, "picks/2026/a.json", "first\n");
    const MAIN_SHA_A = commitPicks(root);
    const firstPath = writeSnapshotManifest(root, "2026-09-03", MAIN_SHA_A);
    assert.equal(firstPath, "manifests/2026-09-03.txt");
    assert.equal(writeSnapshotManifest(root, "2026-09-03", MAIN_SHA_A), null);

    write(root, "picks/2026/b.json", "second\n");
    const MAIN_SHA_B = commitPicks(root);
    const content = buildManifest(root, "2026-09-04", MAIN_SHA_B);
    assert.match(content, /picks\/2026\/a\.json/u);
    assert.match(content, /picks\/2026\/b\.json/u);
    assert.match(content, new RegExp(`^previous_manifest_sha256 ${sha256File(join(root, firstPath))}$`, "mu"));
    assert.match(content, new RegExp(`^main_commit_sha ${MAIN_SHA_B}$`, "mu"));
    assert.match(content, /^pick_count 2$/mu);
    writeSnapshotManifest(root, "2026-09-04", MAIN_SHA_B);

    assert.throws(() => {
      write(root, "picks/2026/c.json", "third\n");
      buildManifest(root, "2026-09-03", MAIN_SHA_B);
    }, /newer than the latest manifest/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest files are byte-stable after creation, including an empty ledger", () => {
  const root = makeRoot();
  try {
    const MAIN_SHA_A = commitPicks(root);
    const relativePath = writeSnapshotManifest(root, "2026-09-03", MAIN_SHA_A);
    const before = readFileSync(join(root, relativePath), "utf8");
    assert.match(before, /^pick_count 0$/mu);
    assert.equal(writeSnapshotManifest(root, "2026-09-03", MAIN_SHA_A), null);
    assert.equal(readFileSync(join(root, relativePath), "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest binds declared commit blobs despite dirty files, untracked picks and CRLF checkout", () => {
  const root = makeRoot();
  try {
    write(root, "picks/2026/a.json", "committed\n");
    const commit = commitPicks(root);
    const expected = buildManifest(root, "2026-09-06", commit);
    git(root, "config", "core.autocrlf", "true");
    write(root, "picks/2026/a.json", "committed\r\n");
    write(root, "picks/2026/untracked.json", "untracked\n");
    assert.equal(buildManifest(root, "2026-09-06", commit), expected);
    write(root, "picks/2026/a.json", "tampered\n");
    assert.equal(buildManifest(root, "2026-09-06", commit), expected);
    assert.throws(() => buildManifest(root, "2026-09-06", "a".repeat(40)), /existing commit/u);
    const blob = git(root, "rev-parse", `${commit}:picks/2026/a.json`);
    assert.throws(() => buildManifest(root, "2026-09-06", blob), /existing commit/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest rejects an invalid main commit SHA", () => {
  const root = makeRoot();
  try {
    assert.throws(() => buildManifest(root, "2026-09-03", "not-a-sha"), /main commit SHA/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manual same-day snapshots append to the daily chain without replacing prior evidence", () => {
  const root = makeRoot();
  try {
    write(root, "picks/2026/a.json", "first\n");
    const first = commitPicks(root);
    const daily = writeSnapshotManifest(root, "2026-09-06", first);
    const dailyHash = sha256File(join(root, daily));
    write(root, "picks/2026/b.json", "second\n");
    const second = commitPicks(root);
    const manual = writeSnapshotManifest(root, "2026-09-06T20:30:00Z", second);
    assert.equal(manual, "manifests/2026-09-06T203000Z.txt");
    const text = readFileSync(join(root, manual), "utf8");
    assert.match(text, new RegExp(`previous_manifest_sha256 ${dailyHash}`, "u"));
    assert.match(text, new RegExp(`main_commit_sha ${second}`, "u"));
    assert.match(text, /snapshot_time_utc 2026-09-06T20:30:00Z/u);
    assert.match(text, /pick_count 2/u);
    assert.equal(sha256File(join(root, daily)), dailyHash);
    assert.equal(writeSnapshotManifest(root, "2026-09-06T20:30:00Z", second), null);
    assert.throws(() => buildManifest(root, "2026-09-06T20:29:59Z", second), /newer than/u);
    assert.throws(() => buildManifest(root, "2026-09-06T25:00:00Z", second), /real UTC instant/u);
    assert.match(buildManifest(root, "2026-09-07", second),
      new RegExp(`previous_manifest_sha256 ${sha256File(join(root, manual))}`, "u"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
