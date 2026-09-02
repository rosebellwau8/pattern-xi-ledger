import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { buildSite } from "../scripts/build-site.mjs";

function makeLedger() {
  const root = mkdtempSync(join(tmpdir(), "pattern-xi-site-test-"));
  for (const directory of ["picks/2026", "results/2026", "standings"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  return root;
}

function writeJson(root, relativePath, value) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(root) {
  const id = "2026-09-06-fixture-1a2b3c4d-ah";
  writeJson(root, `picks/2026/${id}.json`, {
    schema: "pattern-xi.pick.v1",
    id,
    match: "North <United> v South & City",
    competition: "Premier Division",
    kickoff_utc: "2026-09-06T16:30:00Z",
    market: "asian_handicap",
    selection: "AWAY",
    line: "-0.75",
    published_price: "0.97",
    published_price_format: "HONG_KONG_ODDS",
    normalized_decimal_price: "1.97",
    price_source: "Crown",
  });
  return id;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function outputDigest(root) {
  const files = walk(join(root, "site-dist")).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.slice(root.length));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

test("homepage is an English data-first publication with escaped pick content", () => {
  const root = makeLedger();
  try {
    fixture(root);
    buildSite(root);
    const html = readFileSync(join(root, "site-dist/index.html"), "utf8");

    assert.match(html, /<html lang="en-GB">/u);
    assert.match(html, /Upcoming picks/u);
    assert.match(html, /North &lt;United&gt; v South &amp; City/u);
    assert.doesNotMatch(html, /North <United>/u);
    assert.match(html, />Away<\/dd>/u);
    assert.match(html, />−0\.75<\/dd>/u);
    assert.match(html, /0\.97/u);
    assert.ok(html.indexOf("Upcoming picks") < html.indexOf("How the ledger works"));
    assert.doesNotMatch(html, /historical_matches|result_distribution|public_note/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated site is deterministic and every local link resolves", () => {
  const root = makeLedger();
  try {
    const id = fixture(root);
    buildSite(root);
    const first = outputDigest(root);
    buildSite(root);
    assert.equal(outputDigest(root), first);

    const detail = readFileSync(join(root, `site-dist/picks/${id}.html`), "utf8");
    assert.match(detail, /href="\.\.\/index\.html"/u);
    assert.match(detail, /href="\.\.\/track-record\.html"/u);
    assert.match(detail, /href="\.\.\/verification\.html"/u);

    for (const file of walk(join(root, "site-dist")).filter((path) => path.endsWith(".html"))) {
      const html = readFileSync(file, "utf8");
      for (const match of html.matchAll(/href="([^"]+)"/gu)) {
        const href = match[1];
        if (/^(?:https?:|mailto:|#)/u.test(href)) continue;
        const target = resolve(dirname(file), href.split(/[?#]/u)[0]);
        assert.ok(existsSync(target), `${file} links to missing ${href}`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
