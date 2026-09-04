import assert from "node:assert/strict";
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
  return root;
}

function write(root, relativePath, content) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

const MAIN_SHA_A = "0123456789abcdef0123456789abcdef01234567";
const MAIN_SHA_B = "89abcdef0123456789abcdef0123456789abcdef";

test("manifest is a versioned complete ledger-state snapshot bound to main", () => {
  const root = makeRoot();
  try {
    const first = write(root, "picks/2026/a.json", "first\n");
    const second = write(root, "picks/2026/b.json", "second\n");
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
    const firstPath = writeSnapshotManifest(root, "2026-09-03", MAIN_SHA_A);
    assert.equal(firstPath, "manifests/2026-09-03.txt");
    assert.equal(writeSnapshotManifest(root, "2026-09-03", MAIN_SHA_A), null);

    write(root, "picks/2026/b.json", "second\n");
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
    const relativePath = writeSnapshotManifest(root, "2026-09-03", MAIN_SHA_A);
    const before = readFileSync(join(root, relativePath), "utf8");
    assert.match(before, /^pick_count 0$/mu);
    assert.equal(writeSnapshotManifest(root, "2026-09-03", MAIN_SHA_A), null);
    assert.equal(readFileSync(join(root, relativePath), "utf8"), before);
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
