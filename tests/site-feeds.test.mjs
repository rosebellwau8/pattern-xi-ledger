import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  buildPicksFeed,
  buildResultsFeed,
  buildSite,
  buildSitemap,
} from "../scripts/build-site.mjs";

const SITE_URL = "https://rosebellwau8.github.io/pattern-xi-ledger";

function makeLedger() {
  const root = mkdtempSync(join(tmpdir(), "pattern-xi-feeds-test-"));
  for (const directory of ["picks/2026", "results/2026", "standings"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeJson(root, "config/formal-window.json", { start_utc: null, end_utc: null });
  return root;
}

function writeJson(root, relativePath, value) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(root, relativePath) {
  return createHash("sha256").update(readFileSync(join(root, relativePath))).digest("hex");
}

// Pending pick whose content needs XML/HTML escaping.
function fixtureUpcoming(root) {
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

// Settled win: home -1.00 at 2.00, finished 2-0.
function fixtureWin(root) {
  const id = "2026-09-01-fixture-bbbb2222-ah";
  writeJson(root, `picks/2026/${id}.json`, {
    schema: "pattern-xi.pick.v1",
    id,
    match: "Eastside Rovers v Westham Athletic",
    competition: "Championship Qualifier",
    kickoff_utc: "2026-09-01T18:00:00Z",
    market: "asian_handicap",
    selection: "HOME",
    line: "-1.00",
    published_price: "2.00",
    published_price_format: "DECIMAL_ODDS",
    normalized_decimal_price: "2.00",
    price_source: "Pinnacle pre-match",
  });
  writeJson(root, `results/2026/${id}.json`, {
    schema: "pattern-xi.result.v1",
    pick_id: id,
    status: "PLAYED",
    home_score: 2,
    away_score: 0,
  });
  return id;
}

function guidCount(xml, guid) {
  return xml.split(`<guid isPermaLink="true">${guid}</guid>`).length - 1;
}

test("feeds, sitemap, robots, 404, favicon and og image are generated one-way from the ledger", () => {
  const root = makeLedger();
  try {
    const upcomingId = fixtureUpcoming(root);
    const winId = fixtureWin(root);
    buildSite(root);

    const picksFeed = readFileSync(join(root, "site-dist/feeds/picks.xml"), "utf8");
    const resultsFeed = readFileSync(join(root, "site-dist/feeds/results.xml"), "utf8");

    // Picks feed: every pick, newest first, XML-escaped, absolute GUIDs.
    assert.match(picksFeed, /<\?xml version="1\.0" encoding="UTF-8"\?>/u);
    assert.match(picksFeed, /<rss version="2\.0">/u);
    assert.match(picksFeed, /Pattern XI — Picks \(shadow run\)/u);
    assert.match(picksFeed, /North &lt;United&gt; v South &amp; City/u);
    assert.equal(guidCount(picksFeed, `${SITE_URL}/picks/${upcomingId}.html`), 1);
    assert.equal(guidCount(picksFeed, `${SITE_URL}/picks/${winId}.html`), 1);
    const newest = picksFeed.indexOf(`${SITE_URL}/picks/${upcomingId}.html`);
    const oldest = picksFeed.indexOf(`${SITE_URL}/picks/${winId}.html`);
    assert.ok(newest < oldest, "picks feed is newest first");
    for (const match of picksFeed.matchAll(/<pubDate>([^<]+)<\/pubDate>/gu)) {
      assert.ok(!Number.isNaN(Date.parse(match[1])), `pubDate must parse: ${match[1]}`);
    }

    // Results feed: settled picks only, outcome from the frozen engine.
    assert.match(resultsFeed, /Pattern XI — Results \(shadow run\)/u);
    assert.equal(guidCount(resultsFeed, `${SITE_URL}/picks/${winId}.html`), 1);
    assert.doesNotMatch(resultsFeed, new RegExp(upcomingId, "u"));
    assert.match(resultsFeed, /— Won</u);
    assert.match(resultsFeed, /Settled by the frozen Settlement Rules v1 engine/u);

    // Sitemap covers every generated page; robots points back at it.
    const sitemap = readFileSync(join(root, "site-dist/sitemap.xml"), "utf8");
    for (const path of ["index.html", "track-record.html", "verification.html", `picks/${upcomingId}.html`, `picks/${winId}.html`]) {
      assert.match(sitemap, new RegExp(`<loc>${SITE_URL}/${path.replace(/\./g, "\\.")}</loc>`, "u"));
    }
    const robots = readFileSync(join(root, "site-dist/robots.txt"), "utf8");
    assert.match(robots, /User-agent: \*/u);
    assert.match(robots, new RegExp(`Sitemap: ${SITE_URL}/sitemap\\.xml`, "u"));

    // 404 page: noindex, absolute links only (served at arbitrary depth).
    const notFound = readFileSync(join(root, "site-dist/404.html"), "utf8");
    assert.match(notFound, /<meta name="robots" content="noindex">/u);
    assert.match(notFound, /Page not found/u);
    assert.doesNotMatch(notFound, /href="(?!https:|#)[^"]+"/u);

    // Brand assets exist with real signatures.
    assert.match(readFileSync(join(root, "site-dist/favicon.svg"), "utf8"), /<svg/u);
    const ogImage = readFileSync(join(root, "site-dist/og-image.png"));
    assert.deepEqual([...ogImage.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(ogImage.length > 1000, "og image should carry real content");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a result correction updates the feed item in place and never duplicates the guid", () => {
  const root = makeLedger();
  try {
    const winId = fixtureWin(root);
    buildSite(root);
    const before = readFileSync(join(root, "site-dist/feeds/results.xml"), "utf8");
    assert.equal(guidCount(before, `${SITE_URL}/picks/${winId}.html`), 1);
    assert.match(before, /— Won</u);

    // Correction: the recorded score was mis-transcribed; official result 1-1.
    // HOME -1.00 at 1-1 is a loss by one after the handicap (engine-computed).
    // Ledger chain convention: the first correction file is numbered .r2.
    writeJson(root, `results/2026/${winId}.r2.json`, {
      schema: "pattern-xi.result.v1",
      pick_id: winId,
      status: "PLAYED",
      home_score: 1,
      away_score: 1,
      corrects: sha256File(root, `results/2026/${winId}.json`),
      correction_kind: "SOURCE_DATA_ERROR",
      note: "Feed guid-stability fixture: official score corrected.",
      evidence_refs: ["https://example.test/authority"],
    });
    buildSite(root);
    const after = readFileSync(join(root, "site-dist/feeds/results.xml"), "utf8");
    assert.equal(guidCount(after, `${SITE_URL}/picks/${winId}.html`), 1, "correction must not duplicate the item");
    assert.match(after, /— Lost</u, "item content reflects the corrected settlement");
    assert.doesNotMatch(after, /— Won</u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pages carry canonical, Open Graph, X card, favicon and RSS autodiscovery", () => {
  const root = makeLedger();
  try {
    const upcomingId = fixtureUpcoming(root);
    buildSite(root);

    const index = readFileSync(join(root, "site-dist/index.html"), "utf8");
    assert.match(index, new RegExp(`<link rel="canonical" href="${SITE_URL}/index\\.html">`, "u"));
    assert.match(index, new RegExp(`<link rel="icon" type="image/svg\\+xml" href="favicon\\.svg">`, "u"));
    assert.match(index, new RegExp(`<link rel="alternate" type="application/rss\\+xml" title="Pattern XI — Picks \\(RSS\\)" href="feeds/picks\\.xml">`, "u"));
    assert.match(index, new RegExp(`<link rel="alternate" type="application/rss\\+xml" title="Pattern XI — Results \\(RSS\\)" href="feeds/results\\.xml">`, "u"));
    assert.match(index, new RegExp(`<meta property="og:url" content="${SITE_URL}/index\\.html">`, "u"));
    assert.match(index, new RegExp(`<meta property="og:image" content="${SITE_URL}/og-image\\.png">`, "u"));
    assert.match(index, /<meta name="twitter:card" content="summary_large_image">/u);

    const pick = readFileSync(join(root, `site-dist/picks/${upcomingId}.html`), "utf8");
    assert.match(pick, new RegExp(`<link rel="canonical" href="${SITE_URL}/picks/${upcomingId}\\.html">`, "u"));
    assert.match(pick, new RegExp(`href="\\.\\./feeds/picks\\.xml"`, "u"), "deeper pages reach the feeds through relative prefixes");

    for (const path of ["index.html", "track-record.html", "verification.html", `picks/${upcomingId}.html`, "404.html"]) {
      const html = readFileSync(join(root, "site-dist", path), "utf8");
      assert.doesNotMatch(html, /<script/u, `${path} must stay free of client-side scripts`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("feed generation is deterministic for a fixed ledger state", () => {
  const root = makeLedger();
  try {
    fixtureUpcoming(root);
    fixtureWin(root);
    buildPicksFeed;
    const build = () => {
      const window = { start_utc: null, end_utc: null };
      const picks = [
        { id: "2026-09-06-fixture-1a2b3c4d-ah", kickoffEpoch: Date.parse("2026-09-06T16:30:00Z"), kickoffUtc: "2026-09-06T16:30:00Z", frozen: { selection: "AWAY", line: "-0.75", normalized_decimal_price: "1.97" }, data: { match: "North <United> v South & City", competition: "Premier Division", published_price_format: "HONG_KONG_ODDS", price_source: "Crown" } },
        { id: "2026-09-01-fixture-bbbb2222-ah", kickoffEpoch: Date.parse("2026-09-01T18:00:00Z"), kickoffUtc: "2026-09-01T18:00:00Z", frozen: { selection: "HOME", line: "-1.00", normalized_decimal_price: "2" }, data: { match: "Eastside Rovers v Westham Athletic", competition: "Championship Qualifier", published_price_format: "DECIMAL_ODDS", price_source: "Pinnacle pre-match" } },
      ];
      const settlements = new Map([
        ["2026-09-01-fixture-bbbb2222-ah", { current: { classification: "WIN", net_return: "1", record_state: "SETTLED" } }],
      ]);
      return {
        picks: buildPicksFeed(picks, settlements, window),
        results: buildResultsFeed(picks, settlements, window),
        sitemap: buildSitemap(picks),
      };
    };
    const first = build();
    const second = build();
    assert.equal(first.picks, second.picks);
    assert.equal(first.results, second.results);
    assert.equal(first.sitemap, second.sitemap);
    // The real committed build must agree with the same ledger state.
    buildSite(root);
    assert.equal(readFileSync(join(root, "site-dist/feeds/picks.xml"), "utf8"), first.picks);
    assert.equal(readFileSync(join(root, "site-dist/feeds/results.xml"), "utf8"), first.results);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
