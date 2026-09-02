import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildManifest, writePendingManifest } from "../scripts/manifest.mjs";
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

test("manifest includes every unanchored pick without trusting commit timestamps", () => {
  const root = makeRoot();
  try {
    const first = write(root, "picks/2026/a.json", "first\n");
    const second = write(root, "picks/2026/b.json", "second\n");
    const content = buildManifest(root, "2026-09-03");
    assert.match(content, /# pattern-xi manifest 2026-09-03/u);
    assert.match(content, /# previous_manifest_sha256 NONE/u);
    assert.match(content, new RegExp(`${sha256File(first)}  picks/2026/a\\.json`, "u"));
    assert.match(content, new RegExp(`${sha256File(second)}  picks/2026/b\\.json`, "u"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("later manifests include only missing picks and chain to the previous bytes", () => {
  const root = makeRoot();
  try {
    write(root, "picks/2026/a.json", "first\n");
    const firstPath = writePendingManifest(root, "2026-09-03");
    assert.equal(firstPath, "manifests/2026-09-03.txt");
    assert.equal(writePendingManifest(root, "2026-09-03"), null);

    write(root, "picks/2026/b.json", "second\n");
    const content = buildManifest(root, "2026-09-04");
    assert.doesNotMatch(content, /picks\/2026\/a\.json/u);
    assert.match(content, /picks\/2026\/b\.json/u);
    assert.match(content, new RegExp(`# previous_manifest_sha256 ${sha256File(join(root, firstPath))}`, "u"));
    writePendingManifest(root, "2026-09-04");

    assert.throws(() => {
      write(root, "picks/2026/c.json", "third\n");
      buildManifest(root, "2026-09-03");
    }, /newer than the latest manifest/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest files are byte-stable after creation", () => {
  const root = makeRoot();
  try {
    write(root, "picks/2026/a.json", "first\n");
    const relativePath = writePendingManifest(root, "2026-09-03");
    const before = readFileSync(join(root, relativePath), "utf8");
    assert.equal(writePendingManifest(root, "2026-09-03"), null);
    assert.equal(readFileSync(join(root, relativePath), "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

