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
const SHADOW = { start_utc: null, end_utc: null };
// Exactly 90 days, as the declaration rules require. Covers the win pick's
// kickoff (2026-09-01T18:00Z); excludes the December pick.
const FORMAL = { start_utc: "2026-09-01T00:00:00Z", end_utc: "2026-11-30T00:00:00Z" };

function makeLedger(window = SHADOW) {
  const root = mkdtempSync(join(tmpdir(), "pattern-xi-feeds-test-"));
  for (const directory of ["picks/2026", "results/2026", "standings"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeJson(root, "config/formal-window.json", window);
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

// Pending pick whose content needs XML/HTML escaping; kickoff outside the
// FORMAL window (December).
function fixtureUpcoming(root) {
  const id = "2026-12-15-fixture-1a2b3c4d-ah";
  writeJson(root, `picks/2026/${id}.json`, {
    schema: "pattern-xi.pick.v1",
    id,
    match: "North <United> v South & City",
    competition: "Premier Division",
    kickoff_utc: "2026-12-15T16:30:00Z",
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

// Settled win: home -1.00 at 2.00, finished 2-0; inside the FORMAL window.
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

test("shadow run: channels exist but distribution item count is zero, and no pubDate is fabricated", () => {
  const root = makeLedger(SHADOW);
  try {
    fixtureUpcoming(root);
    fixtureWin(root);
    buildSite(root);

    for (const feed of ["feeds/picks.xml", "feeds/results.xml"]) {
      const xml = readFileSync(join(root, "site-dist", feed), "utf8");
      assert.match(xml, /<\?xml version="1\.0" encoding="UTF-8"\?>/u);
      assert.match(xml, /<rss version="2\.0" xmlns:pxi=/u);
      assert.match(xml, /Pattern XI — .*(shadow run)/u);
      assert.doesNotMatch(xml, /<item>/u, `${feed} must carry zero distribution items in the shadow run`);
      assert.doesNotMatch(xml, /<pubDate/u, "kickoff must never masquerade as pubDate");
      assert.match(xml, /deliberately carries zero items/u);
    }

    // Sitemap: static indexable pages only; no pick details in the shadow run.
    const sitemap = readFileSync(join(root, "site-dist/sitemap.xml"), "utf8");
    for (const path of ["index.html", "track-record.html", "verification.html"]) {
      assert.match(sitemap, new RegExp(`<loc>${SITE_URL}/${path.replace(/\./g, "\\.")}</loc>`, "u"));
    }
    assert.doesNotMatch(sitemap, /picks\//u);

    // Static pages stay indexable; no robots restriction on them.
    assert.doesNotMatch(readFileSync(join(root, "site-dist/index.html"), "utf8"), /name="robots"/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formal window: only in-window records enter the feeds and the sitemap", () => {
  const root = makeLedger(FORMAL);
  try {
    const upcomingId = fixtureUpcoming(root);
    const winId = fixtureWin(root);
    buildSite(root);

    const picksFeed = readFileSync(join(root, "site-dist/feeds/picks.xml"), "utf8");
    const resultsFeed = readFileSync(join(root, "site-dist/feeds/results.xml"), "utf8");

    assert.equal(guidCount(picksFeed, `${SITE_URL}/picks/${winId}.html`), 1);
    assert.doesNotMatch(picksFeed, new RegExp(upcomingId, "u"), "out-of-window pick must stay out of the feed");
    assert.doesNotMatch(picksFeed, /<pubDate/u, "no fabricated publication date");
    assert.match(picksFeed, new RegExp(`<pxi:kickoffUtc>2026-09-01T18:00:00Z</pxi:kickoffUtc>`, "u"), "kickoff stays machine-readable as an explicit event-time extension");

    assert.equal(guidCount(resultsFeed, `${SITE_URL}/picks/${winId}.html`), 1);
    assert.match(resultsFeed, /current result state/u);
    assert.match(resultsFeed, /not a re-delivery event/u);

    const sitemap = readFileSync(join(root, "site-dist/sitemap.xml"), "utf8");
    assert.match(sitemap, new RegExp(`<loc>${SITE_URL}/picks/${winId}\\.html</loc>`, "u"), "in-window pick belongs in the sitemap");
    assert.doesNotMatch(sitemap, new RegExp(upcomingId, "u"), "out-of-window pick must stay out of the sitemap");

    // Indexability: in-window detail is indexable; out-of-window detail is
    // noindex,follow but stays live, public and canonical.
    const win = readFileSync(join(root, `site-dist/picks/${winId}.html`), "utf8");
    assert.doesNotMatch(win, /name="robots"/u);
    const waiting = readFileSync(join(root, `site-dist/picks/${upcomingId}.html`), "utf8");
    assert.match(waiting, /<meta name="robots" content="noindex,follow">/u);
    assert.match(waiting, new RegExp(`<link rel="canonical" href="${SITE_URL}/picks/${upcomingId}\\.html">`, "u"));
    assert.match(waiting, /North &lt;United&gt; v South &amp; City/u, "out-of-window detail stays public and complete");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a result correction updates the feed item in place and never duplicates the guid", () => {
  const root = makeLedger(FORMAL);
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
  const root = makeLedger(FORMAL);
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
  const root = makeLedger(FORMAL);
  try {
    fixtureWin(root);
    const picks = [
      { id: "2026-09-01-fixture-bbbb2222-ah", kickoffEpoch: Date.parse("2026-09-01T18:00:00Z"), kickoffUtc: "2026-09-01T18:00:00Z", frozen: { selection: "HOME", line: "-1.00", normalized_decimal_price: "2" }, data: { match: "Eastside Rovers v Westham Athletic", competition: "Championship Qualifier", published_price_format: "DECIMAL_ODDS", price_source: "Pinnacle pre-match" } },
      { id: "2026-12-15-fixture-1a2b3c4d-ah", kickoffEpoch: Date.parse("2026-12-15T16:30:00Z"), kickoffUtc: "2026-12-15T16:30:00Z", frozen: { selection: "AWAY", line: "-0.75", normalized_decimal_price: "1.97" }, data: { match: "North <United> v South & City", competition: "Premier Division", published_price_format: "HONG_KONG_ODDS", price_source: "Crown" } },
    ];
    const settlements = new Map([
      ["2026-09-01-fixture-bbbb2222-ah", { current: { classification: "WIN", net_return: "1", record_state: "SETTLED" } }],
    ]);
    const build = () => ({
      picks: buildPicksFeed(picks, settlements, FORMAL),
      results: buildResultsFeed(picks, settlements, FORMAL),
      sitemap: buildSitemap(picks, FORMAL),
    });
    const first = build();
    const second = build();
    assert.equal(first.picks, second.picks);
    assert.equal(first.results, second.results);
    assert.equal(first.sitemap, second.sitemap);

    // The committed build (same ledger state) must match the builders byte for
    // byte: the December pick is out-of-window and never appears.
    buildSite(root);
    assert.equal(readFileSync(join(root, "site-dist/feeds/picks.xml"), "utf8"), first.picks);
    assert.equal(readFileSync(join(root, "site-dist/feeds/results.xml"), "utf8"), first.results);
    assert.equal(readFileSync(join(root, "site-dist/sitemap.xml"), "utf8"), first.sitemap);
    assert.doesNotMatch(first.picks, /<pubDate/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
