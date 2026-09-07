#!/usr/bin/env node
// Builds the static public site into site-dist/. Pure Node, no framework, no
// client JavaScript, no network, no webfonts. Output is deterministic: the
// same ledger state always produces byte-identical pages, which is what lets
// CI enforce that the committed site is current.
//
// Visual system: the dark dashboard design (approved 2026-09-02 mockups for
// the overview, full-record and verification pages). The mockups were static
// zero-state snapshots; this generator ports their structure and styling and
// binds every figure back to ledger data:
//   - "90-Day Performance (Public)" and the "Official Picks" KPI count only
//     the declared formal verification window; during the
//     shadow run they correctly read zero.
//   - every other panel (upcoming table, curve, record page) renders the
//     whole current ledger, however the formal window is set.
// All copy is English (en-GB): the site faces a UK audience.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";

import { isMainScript, REPO_ROOT, sha256File } from "./lib.mjs";
import { buildSettlements } from "./settle.mjs";
import { buildStandings } from "./standings.mjs";
import { buildPerformanceProjection } from "../src/performance/performance-projection.ts";
import { formatPublicDecimal } from "../src/settlement/settlement-engine.ts";
import { inFormalWindow, loadFormalWindow, validateFormalWindow } from "./formal-window.mjs";

const REPO_URL = "https://github.com/rosebellwau8/pattern-xi-ledger";

// Public origin of the static site. Used only for absolute references that
// external systems require (canonical URLs, Open Graph/Twitter cards, feed
// <link> targets, sitemap URLs, og:image). Every in-page navigation link
// stays relative so the site keeps working from any mirror path.
const SITE_URL = "https://rosebellwau8.github.io/pattern-xi-ledger";

// RSS-style public distribution interface (master prompt #9, amended Gate O3).
// Feeds are generated one-way from the ledger by this build; they are never an
// input to settlement, standings or any evidence layer.
//
// Distribution contract (safe by default):
//   - During the shadow run (formal-window null/null) the channels exist but
//     carry ZERO items: shadow/synthetic records stay public and auditable on
//     their own URLs, yet nothing may flow towards automated distribution.
//   - After a formal window declaration, items are exactly the records with
//     kickoff inside [start_utc, end_utc).
//   - pubDate is deliberately NOT emitted: the frozen pick schema carries no
//     publication timestamp, Git timestamps are not evidence, and kickoff is
//     event time - not publication time. Kickoff stays machine-readable via
//     the <pxi:kickoffUtc> extension and human-readable in the description.
//   - results.xml is a current-state feed: a correction updates the item in
//     place (GUID = permanent detail URL) and is NOT a re-delivery event.
// No build-time clock is consulted anywhere; builds stay byte-deterministic.
function modeLabel(window) {
  return window.start_utc === null ? "shadow run" : "formal window";
}

function xmlItem({ title, link, description, kickoffUtc }) {
  return `    <item>
      <title>${esc(title)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="true">${esc(link)}</guid>
      <pxi:kickoffUtc>${esc(kickoffUtc)}</pxi:kickoffUtc>
      <description>${esc(description)}</description>
    </item>`;
}

function rssChannel({ kind, window, items }) {
  const mode = modeLabel(window);
  const distributionNote = items.length === 0
    ? `Distribution contract: during the ${mode} this channel deliberately carries zero items; shadow and synthetic records remain publicly auditable on their own pages but are not distribution-eligible.`
    : "Distribution contract: items are exactly the records whose kickoff falls inside the declared formal verification window.";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:pxi="https://rosebellwau8.github.io/pattern-xi-ledger/ns">
  <channel>
    <title>Pattern XI — ${kind} (${mode})</title>
    <link>${SITE_URL}/</link>
    <description>Public, prospective, auditable football Asian-handicap ${kind.toLowerCase()} from the Pattern XI ledger. ${distributionNote} Prospective publication is proven by the public PR + Ledger integrity witness — see ${SITE_URL}/verification.html. Settlements are computed by the frozen Settlement Rules v1 engine. The results feed represents current result state: a correction updates an item in place and is not a re-delivery event.</description>
    <language>en-GB</language>
${items.join("\n")}
  </channel>
</rss>
`;
}

export function buildPicksFeed(orderedPicks, settlements, window) {
  const items = [...orderedPicks]
    .filter((pick) => inFormalWindow(pick, window))
    .sort((left, right) => right.kickoffEpoch - left.kickoffEpoch || right.id.localeCompare(left.id))
    .map((pick) => {
      const current = settlements.get(pick.id)?.current;
      const state = current === undefined
        ? "Awaiting result."
        : `${OUTCOME_EN[current.classification] ?? current.classification}.`;
      return xmlItem({
        title: `${pick.data.match} — ${selectionLabel(pick.frozen)}`,
        link: `${SITE_URL}/picks/${pick.id}.html`,
        description: `${pick.data.competition}. Kickoff ${pick.kickoffUtc}. Asian handicap ${pick.frozen.selection} ${pick.frozen.line} @ ${pick.frozen.normalized_decimal_price} (${pick.data.published_price_format}). Price source: ${pick.data.price_source}. ${state}`,
        kickoffUtc: pick.kickoffUtc,
      });
    });
  return rssChannel({ kind: "Picks", window, items });
}

export function buildResultsFeed(orderedPicks, settlements, window) {
  const items = [...orderedPicks]
    .filter((pick) => settlements.get(pick.id)?.current !== undefined && inFormalWindow(pick, window))
    .sort((left, right) => right.kickoffEpoch - left.kickoffEpoch || right.id.localeCompare(left.id))
    .map((pick) => {
      const current = settlements.get(pick.id).current;
      const outcome = OUTCOME_EN[current.classification] ?? current.classification;
      const net = current.net_return === null ? "void — excluded from returns" : `net ${current.net_return} units`;
      return xmlItem({
        title: `${pick.data.match} — ${outcome}`,
        link: `${SITE_URL}/picks/${pick.id}.html`,
        description: `${pick.data.competition}. Kickoff ${pick.kickoffUtc}. Asian handicap ${pick.frozen.selection} ${pick.frozen.line} @ ${pick.frozen.normalized_decimal_price}. Settled by the frozen Settlement Rules v1 engine: ${outcome} (${net}). Facts and any corrections live in the append-only ledger.`,
        kickoffUtc: pick.kickoffUtc,
      });
    });
  return rssChannel({ kind: "Results", window, items });
}

export function buildSitemap(orderedPicks, window) {
  // Only indexable pages: the static surfaces plus formal-window pick details.
  // Shadow/synthetic pick pages stay live and public, but stay out of the
  // sitemap and carry noindex - search engines must not promote rehearsal
  // records as Pattern XI content.
  const urls = [
    "index.html",
    "track-record.html",
    "verification.html",
    ...orderedPicks.filter((pick) => inFormalWindow(pick, window)).map((pick) => `picks/${pick.id}.html`),
  ].map((path) => `  <url><loc>${SITE_URL}/${path}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

export function buildRobots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0d110f"/>
  <rect x="3" y="3" width="58" height="58" rx="11" fill="none" stroke="#364039" stroke-width="2"/>
  <text x="32" y="42" font-family="Georgia, serif" font-size="26" font-weight="bold" fill="#6fce91" text-anchor="middle">XI</text>
</svg>
`;

function build404Page() {
  // Served by GitHub Pages for every missing path at any depth, so every link
  // must be absolute - relative navigation would break under nested URLs.
  const home = `${SITE_URL}/`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Page not found · Pattern XI</title>
<link rel="canonical" href="${home}404.html">
<link rel="icon" type="image/svg+xml" href="${home}favicon.svg">
<style>${STYLE}</style>
</head>
<body>
<main id="main" class="wrap page-main" style="min-height:60vh;display:flex;flex-direction:column;justify-content:center">
  <h1>Page not found</h1>
  <p class="muted">The ledger is append-only, but this URL is not part of it.</p>
  <p>
    <a class="btn" href="${home}index.html">Overview</a> ·
    <a class="btn" href="${home}track-record.html">Full Record</a> ·
    <a class="btn" href="${home}verification.html">Verify It Yourself</a>
  </p>
</main>
</body>
</html>
`;
}

// Deterministic 1200x630 brand image for Open Graph / X cards: dark pitch
// gradient, a thin frame, and the block-letter "XI" monogram. Rendered from
// code (no fonts, no network, no clock) so every build produces identical
// bytes. PNG encoding is hand-rolled (zlib + CRC32) to keep the repo
// dependency-free.
function renderOgImagePng() {
  const width = 1200;
  const height = 630;
  const pixels = Buffer.alloc(width * height * 4);
  const top = [12, 16, 14];
  const bottom = [16, 24, 21];
  for (let y = 0; y < height; y += 1) {
    const t = y / (height - 1);
    const base = top.map((channel, index) => Math.round(channel + (bottom[index] - channel) * t));
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = base[0];
      pixels[offset + 1] = base[1];
      pixels[offset + 2] = base[2];
      pixels[offset + 3] = 255;
    }
  }
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
  };
  const frame = [54, 64, 57];
  for (let x = 24; x < width - 24; x += 1) {
    set(x, 24, frame);
    set(x, 25, frame);
    set(x, height - 26, frame);
    set(x, height - 25, frame);
  }
  for (let y = 24; y < height - 24; y += 1) {
    set(24, y, frame);
    set(25, y, frame);
    set(width - 26, y, frame);
    set(width - 25, y, frame);
  }
  // Block-letter monogram "XI" on a hand-defined grid (rows of on-cells).
  const glyphs = {
    X: ["X...X", "X...X", ".X.X.", "..X..", ".X.X.", "X...X", "X...X"],
    I: ["XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "XXXXX"],
  };
  const cell = 44;
  const gap = 2;
  const gridWidth = (5 + gap + 5) * cell;
  const gridHeight = 7 * cell;
  const originX = Math.floor((width - gridWidth) / 2);
  const originY = Math.floor((height - gridHeight) / 2) - 20;
  const green = [111, 206, 145];
  const cream = [238, 232, 215];
  let cursor = originX;
  for (const letter of ["X", "I"]) {
    const rows = glyphs[letter];
    const color = letter === "X" ? green : cream;
    for (let row = 0; row < rows.length; row += 1) {
      for (let column = 0; column < rows[row].length; column += 1) {
        if (rows[row][column] !== "X") continue;
        for (let dy = 0; dy < cell; dy += 1) {
          for (let dx = 0; dx < cell; dx += 1) {
            set(cursor + column * cell + dx, originY + row * cell + dy, color);
          }
        }
      }
    }
    cursor += (5 + gap) * cell;
  }
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Newsletter signup slot. The slot is provider-agnostic: it renders whatever
// plain HTML POST endpoint this one object declares, so moving to a different
// provider is an edit here alone, never a template rewrite. Currently wired
// to Buttondown's documented no-JavaScript embed form
// (https://docs.buttondown.com/building-your-subscriber-base). Constraints
// kept by design: no backend of our own, no client-side JavaScript, no
// payments — a static form POSTing straight to the provider, with the
// privacy/consent wording rendered beside it.
const NEWSLETTER = {
  enabled: true,
  providerName: "Buttondown",
  providerUrl: "https://buttondown.com",
  // `pattern-xi` must be the Buttondown newsletter username; change only
  // this token if the live newsletter lives under a different name.
  formAction: "https://buttondown.com/api/emails/embed-subscribe/pattern-xi",
  hiddenFields: { embed: "1" },
  emailFieldName: "email",
  buttonLabel: "Subscribe",
};

// The declared UTC [start,end) window lives in config/formal-window.json.
// Both null means shadow run. No build-time clock changes the record.

const OUTCOME_EN = {
  WIN: "Won",
  HALF_WIN: "Half won",
  PUSH: "Push",
  HALF_LOSS: "Half lost",
  LOSS: "Lost",
  VOID: "Void",
};

const COMPONENT_EN = { WIN: "Won", PUSH: "Push", LOSS: "Lost" };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STYLE = `
  :root {
    color-scheme: dark;
    --bg: #0d110f;
    --panel: #151b17;
    --text: #f1eee3;
    --muted: #a7aea2;
    --faint: #727b73;
    --line: #283129;
    --line-strong: #364039;
    --green: #6fce91;
    --green-2: #4fb97a;
    --gold: #d8b261;
    --orange: #dc8e3d;
    --red: #e16e61;
    --purple: #a67ae8;
    --cream: #eee8d7;
    --shadow: 0 18px 50px rgba(0,0,0,.28);
    --serif: Charter, "Iowan Old Style", "Palatino Linotype", Georgia, serif;
    --sans: Aptos, Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --mono: ui-monospace, "Cascadia Mono", Consolas, "SFMono-Regular", monospace;
  }

  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    min-width: 320px;
    background:
      radial-gradient(circle at 78% -10%, rgba(68,116,78,.13), transparent 34rem),
      linear-gradient(180deg, #0c100e 0%, var(--bg) 32%, #0b0f0d 100%);
    color: var(--text);
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.55;
    -webkit-text-size-adjust: 100%;
  }

  a { color: inherit; text-decoration: none; }
  a:hover { color: var(--green); }
  a:focus-visible, button:focus-visible, input:focus-visible {
    outline: 3px solid rgba(111,206,145,.55);
    outline-offset: 3px;
  }

  .wrap { width: min(1480px, calc(100% - 44px)); margin: 0 auto; }
  .mono { font-family: var(--mono); }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }
  .positive { color: var(--green); }
  .negative { color: var(--red); }
  .pending { color: var(--gold); }

  .skip-link {
    position: fixed; left: 1rem; top: 1rem; z-index: 50;
    transform: translateY(-180%);
    background: #0c110e; color: #f1eee3;
    padding: 0.5rem 0.8rem; border: 1px solid var(--line-strong); border-radius: 7px;
    font-weight: 700;
  }
  .skip-link:focus { transform: translateY(0); }
  .sr-only {
    position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }

  /* top utility */
  .utility {
    border-bottom: 1px solid var(--line);
    background: rgba(9,12,10,.92);
  }
  .utility-inner {
    min-height: 35px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    color: #bca96f;
    text-transform: uppercase;
    font-size: .72rem;
    letter-spacing: .15em;
  }
  .utility a { color: #d0b66f; }

  /* masthead */
  .masthead {
    position: sticky;
    top: 0;
    z-index: 20;
    border-bottom: 1px solid var(--line);
    background: rgba(13,17,15,.94);
    backdrop-filter: blur(14px);
  }
  .masthead-inner {
    min-height: 76px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 34px;
  }
  .brand {
    font-family: var(--serif);
    font-size: 2.15rem;
    font-weight: 700;
    letter-spacing: -.02em;
    white-space: nowrap;
  }
  .brand em { color: var(--green-2); font-style: italic; }
  .nav {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 34px;
  }
  .nav a {
    position: relative;
    padding: 28px 0 24px;
    color: #d1d4cf;
    font-size: .9rem;
    font-weight: 600;
  }
  .nav a[aria-current="page"] { color: var(--green); }
  .nav a[aria-current="page"]::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: 14px;
    height: 2px;
    background: var(--green);
  }
  .subscribe-top {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    padding: 0 20px;
    border: 1px solid #5b4c23;
    border-radius: 999px;
    color: #ebc36c;
    background: linear-gradient(180deg, #302816, #221d11);
    font-weight: 700;
  }

  /* shadow banner */
  .shadow-banner { padding: 10px 0 0; }
  .shadow-banner-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 44px;
    padding: 8px 16px;
    border: 1px solid #4a3d1d;
    border-radius: 7px;
    background: linear-gradient(90deg, #2d2615, #211d12);
    color: #d7c488;
    font-size: .86rem;
  }
  .shadow-banner strong { color: #f0c55f; letter-spacing: .04em; }
  .shadow-banner a { color: #dfb653; font-weight: 700; white-space: nowrap; }

  /* first screen */
  .first-screen { padding: 16px 0 18px; }
  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(325px, .72fr);
    gap: 18px;
    align-items: stretch;
  }
  .hero-copy {
    min-height: 282px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 22px 12px 18px 6px;
  }
  .eyebrow {
    margin: 0 0 10px;
    color: var(--green);
    text-transform: uppercase;
    letter-spacing: .17em;
    font-size: .72rem;
    font-weight: 800;
  }
  h1 {
    max-width: 820px;
    margin: 0;
    font-family: var(--serif);
    font-size: clamp(3rem, 5.4vw, 5.8rem);
    line-height: .98;
    letter-spacing: -.035em;
    color: var(--cream);
  }
  .standfirst {
    max-width: 810px;
    margin: 18px 0 0;
    color: #babdb6;
    font-family: var(--serif);
    font-size: clamp(1rem, 1.35vw, 1.18rem);
    font-style: italic;
    line-height: 1.52;
  }
  .cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    padding: 0 18px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--text);
    background: rgba(20,25,21,.8);
    font-size: .86rem;
    font-weight: 750;
    cursor: pointer;
  }
  .btn:hover { border-color: #557563; color: var(--green); }
  .btn.primary {
    border-color: #69c98a;
    background: linear-gradient(180deg, #7bd69b, #62c785);
    color: #08120c;
  }
  .btn.primary:hover { color: #061109; filter: brightness(1.05); }

  .panel {
    min-width:0;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: linear-gradient(180deg, rgba(25,32,27,.96), rgba(20,26,22,.96));
    box-shadow: var(--shadow);
  }
  .summary-card { padding: 18px 20px 16px; }
  .panel-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
  }
  .panel-title h2 { margin: 0; font-size: 1rem; letter-spacing: .01em; }
  .panel-title a { color: var(--green); font-size: .8rem; font-weight: 700; }
  .summary-list { margin: 0; }
  .summary-list div {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 16px;
    padding: 4px 0;
  }
  .summary-list dt { color: #b9bdb7; font-size: .86rem; }
  .summary-list dd { margin: 0; font-weight: 700; font-size: .88rem; font-variant-numeric: tabular-nums; }
  .summary-list .rule {
    margin: 7px 0 6px;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .summary-note {
    margin: 11px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    color: var(--faint);
    font-size: .73rem;
  }

  /* KPI strip */
  .kpi-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0,1fr));
    gap: 10px;
    margin-top: 10px;
  }
  .kpi {
    min-height: 88px;
    display: grid;
    grid-template-columns: 46px minmax(0,1fr) 98px;
    gap: 12px;
    align-items: center;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: linear-gradient(180deg, #171e19, #131915);
  }
  .kpi-icon {
    width: 42px; height: 42px;
    display: grid; place-items: center;
    border-radius: 50%;
    border: 1px solid #2d6f47;
    background: #122c1d;
    color: var(--green);
    font-size: 1.05rem;
  }
  .kpi:nth-child(3) .kpi-icon { border-color: #79521f; background: #2d2111; color: var(--orange); }
  .kpi:nth-child(4) .kpi-icon { border-color: #5e3e8c; background: #231830; color: var(--purple); }
  .kpi strong { display:block; font-size:1.5rem; line-height:1; font-variant-numeric: tabular-nums; }
  .kpi span { display:block; margin-top:5px; color:#b1b6ae; font-size:.76rem; line-height:1.25; }
  .spark { width:100%; height:40px; opacity:.9; }
  .spark polyline { fill:none; stroke:var(--green); stroke-width:2; vector-effect:non-scaling-stroke; }
  .kpi:nth-child(3) .spark polyline { stroke:var(--orange); }
  .kpi:nth-child(4) .spark polyline { stroke:var(--purple); }

  /* dashboard row */
  .dashboard-row {
    display: grid;
    grid-template-columns: minmax(0, 1.9fr) minmax(310px, .82fr);
    gap: 10px;
    margin-top: 10px;
  }
  .picks-panel, .curve-panel { min-height: 266px; }
  .picks-panel { padding: 14px 16px 12px; }
  .curve-panel { padding: 14px 16px 12px; }
  .table-wrap { max-width:100%; overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:.78rem; }
  th {
    padding: 8px 8px;
    border-bottom: 1px solid var(--line-strong);
    color: #9ea69e;
    text-align:left;
    text-transform:uppercase;
    letter-spacing:.07em;
    font-size:.64rem;
    white-space:nowrap;
  }
  td {
    padding: 10px 8px;
    border-bottom: 1px solid var(--line);
    vertical-align:top;
  }
  tbody tr:last-child td { border-bottom: none; }
  .empty-row td { color: var(--muted); font-style: italic; padding: 24px 8px; }
  td.match a { font-weight: 700; }
  td small { color: var(--faint); }
  .badge {
    display:inline-flex; align-items:center; gap:6px;
    padding:2px 8px; border-radius:999px;
    background:#15301f; color:#79d49a; font-weight:800; font-size:.66rem;
  }
  .status {
    display:inline-flex; padding:2px 7px; border:1px solid #315c43; border-radius:4px;
    color:#76d092; font-size:.64rem; font-weight:800;
  }
  .status.await { border-color:#79521f; color:#dfb653; }
  .pill {
    display:inline-flex; align-items:center; gap:6px;
    padding:2px 8px; border-radius:999px;
    font-weight:800; font-size:.66rem; white-space:nowrap;
  }
  .pill::before { content:""; width:.38rem; height:.38rem; border-radius:50%; background:currentColor; }
  .pill.win { background:#15301f; color:#79d49a; }
  .pill.loss { background:#3b201c; color:#e78d83; }
  .pill.push { background:#26281f; color:#b4b8a9; }
  .pill.pend { background:#3a3018; color:#d8b261; }
  .curve-value { color:var(--green); font-size:1.28rem; font-weight:800; font-variant-numeric: tabular-nums; }
  .chart {
    width:100%; height:174px; margin-top:8px; display:block;
  }
  .chart .grid { stroke:#2a322c; stroke-width:1; stroke-dasharray:3 5; }
  .chart .axis { fill:#808980; font-size:10px; font-family:var(--sans); }
  .chart .line { fill:none; stroke:var(--green); stroke-width:2.25; }
  .chart .area { opacity:.55; }
  .curve-empty { position: relative; margin-top: 8px; }
  .curve-empty-message {
    position:absolute; inset:0;
    display:grid; place-items:center;
    color:#9aa299;
    font-size:.8rem; text-align:center;
    pointer-events:none;
  }
  .subnote { margin:8px 0 0; color:var(--faint); font-size:.68rem; }

  /* integrity strip */
  .integrity {
    margin-top: 10px;
    padding: 14px 16px 15px;
  }
  .integrity-steps {
    display:grid;
    grid-template-columns: repeat(5, minmax(0,1fr));
    gap:0;
    margin-top: 8px;
  }
  .integrity-step {
    position:relative;
    min-height:74px;
    padding:4px 22px 2px 45px;
  }
  .integrity-step:not(:last-child)::after {
    content:"›";
    position:absolute; right:4px; top:18px;
    color:#737c73; font-size:1.55rem;
  }
  .step-icon {
    position:absolute; left:0; top:4px;
    width:34px; height:34px;
    display:grid; place-items:center;
    border:1px solid #566159;
    border-radius:8px;
    color:#d2d7d1;
    font-size:.8rem;
  }
  .integrity-step strong { display:block; font-size:.76rem; }
  .integrity-step p { margin:4px 0 0; color:#929a92; font-size:.68rem; line-height:1.35; }

  /* lower content */
  .lower-grid {
    display:grid;
    grid-template-columns: 1.1fr .9fr;
    gap:10px;
    margin:10px 0 30px;
  }
  .newsletter, .limitations { padding:18px 20px; }
  .newsletter h2, .limitations h2 { margin:0; font-family:var(--serif); font-size:1.25rem; }
  .newsletter p, .limitations p { color:var(--muted); font-size:.82rem; margin:8px 0 0; }
  .newsletter-form { display:flex; gap:8px; margin-top:14px; }
  .newsletter-form input[type="email"] {
    flex:1 1 auto; min-width:0;
    height:42px; padding:0 14px;
    border:1px solid var(--line-strong); border-radius:999px;
    background:#0e130f; color:var(--text); font:inherit;
  }
  .newsletter-form input[type="email"]::placeholder { color:var(--faint); }
  .newsletter-form button { flex:0 0 auto; }
  .fineprint { margin:10px 0 0; color:var(--faint); font-size:.7rem; line-height:1.5; }
  .limitations ul { margin:12px 0 0; padding-left:18px; color:#abb1aa; font-size:.78rem; }
  .limitations li + li { margin-top:6px; }

  footer {
    border-top:1px solid var(--line);
    color:#7f8780;
    font-size:.74rem;
  }
  .footer-inner { padding:18px 0 30px; display:flex; justify-content:space-between; gap:18px; flex-wrap:wrap; }

  .mobile-nav { display:none; }

  /* secondary pages */
  .page-main { padding: 24px 0 42px; }
  .page-hero {
    display:grid;
    grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);
    gap:18px;
    align-items:stretch;
    margin-bottom:10px;
  }
  .page-hero-copy { padding:24px 10px 22px 4px; align-self:center; }
  .page-hero h1 {
    margin:0;
    max-width:850px;
    font-family:var(--serif);
    font-size:clamp(2.8rem,5vw,5rem);
    line-height:1;
    letter-spacing:-.035em;
    color:var(--cream);
  }
  .page-hero .standfirst { max-width:760px; }
  .section-gap { margin-top:10px; }
  .section-panel { padding:16px 18px; }
  .section-heading {
    display:flex; align-items:flex-end; justify-content:space-between; gap:16px;
    margin-bottom:12px;
  }
  .section-heading h2 { margin:0; font-family:var(--serif); font-size:1.35rem; color:var(--cream); }
  .section-heading p { margin:0; color:var(--faint); font-size:.75rem; }
  .section-heading a { color:var(--green); font-size:.76rem; font-weight:800; }
  .record-grid {
    display:grid;
    grid-template-columns:minmax(0,1.45fr) minmax(310px,.72fr);
    gap:10px;
    margin-top:10px;
  }
  .metric-grid {
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:8px;
  }
  .metric-card {
    min-height:91px;
    padding:12px 14px;
    border:1px solid var(--line);
    border-radius:9px;
    background:linear-gradient(180deg,#182019,#141a16);
  }
  .metric-card .label {
    color:#99a19a; text-transform:uppercase; letter-spacing:.08em;
    font-size:.63rem; font-weight:800;
  }
  .metric-card .value { margin-top:5px; font-size:1.62rem; font-weight:800; line-height:1.05; font-variant-numeric:tabular-nums; }
  .metric-card .sub { margin-top:5px; color:var(--faint); font-size:.68rem; }
  .outcome-chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
  .outcome-chip {
    display:inline-flex; align-items:center; gap:6px;
    padding:4px 9px; border-radius:999px; border:1px solid var(--line-strong);
    background:#121713; color:#aeb5ae; font-size:.7rem;
  }
  .outcome-chip b { color:var(--text); font-variant-numeric:tabular-nums; }
  .outcome-chip.win { border-color:#315c43; color:#7bd59b; }
  .outcome-chip.loss { border-color:#653b34; color:#e78d83; }
  .outcome-chip.push { border-color:#555c55; }
  .record-table { min-width:820px; }
  .record-table td.match { min-width:170px; }
  .notice-box {
    padding:16px 17px; border:1px solid #4a3d1d; border-radius:9px;
    background:linear-gradient(180deg,#272115,#1d1a12); color:#c9bd96;
  }
  .notice-box strong { color:#f0c55f; }

  /* verification */
  .evidence-stack { display:grid; gap:8px; }
  .evidence-mini {
    display:grid; grid-template-columns:42px 1fr; gap:10px; align-items:start;
    padding:10px 11px; border:1px solid var(--line); border-radius:8px; background:#121814;
  }
  .evidence-mini .n {
    width:36px; height:36px; display:grid; place-items:center;
    border-radius:8px; background:#15301f; border:1px solid #315c43;
    color:var(--green); font-weight:900; font-size:.72rem;
  }
  .evidence-mini strong { display:block; font-size:.76rem; }
  .evidence-mini p { margin:3px 0 0; color:#929a92; font-size:.68rem; line-height:1.4; }
  .verify-layout {
    display:grid; grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr); gap:10px; margin-top:10px;
  }
  .verify-steps { padding:16px 18px; }
  .verify-step {
    display:grid; grid-template-columns:48px minmax(0,1fr); gap:14px;
    padding:16px 0; border-bottom:1px solid var(--line);
  }
  .verify-step:last-child { border-bottom:none; padding-bottom:2px; }
  .verify-step > div { min-width:0; }
  .step-no {
    width:42px; height:42px; display:grid; place-items:center;
    border:1px solid #3c674b; border-radius:10px; background:#12251a;
    color:var(--green); font-family:var(--serif); font-size:1.2rem; font-weight:800;
  }
  .verify-step h3 { margin:0; font-size:.93rem; }
  .verify-step p { margin:5px 0 0; color:#a2aaa2; font-size:.78rem; }
  pre {
    margin:9px 0 0; padding:11px 12px; overflow-x:auto;
    border:1px solid var(--line); border-radius:8px; background:#0c110e;
    color:#ced5ce; font-family:var(--mono); font-size:.71rem; line-height:1.55;
    white-space:pre;
  }
  code { font-family:var(--mono); }
  .verify-side { display:grid; gap:10px; align-content:start; }
  .truth-card { padding:16px 18px; }
  .truth-card h2 { margin:0; font-family:var(--serif); font-size:1.2rem; }
  .truth-card p { margin:9px 0 0; color:#a7aea7; font-size:.78rem; }
  .truth-card ul { margin:10px 0 0; padding-left:18px; color:#a7aea7; font-size:.76rem; }
  .truth-card li+li { margin-top:7px; }
  .methodology-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:10px; }
  .method-card { padding:15px 16px; }
  .method-card .k { color:var(--green); font-size:.68rem; font-weight:900; letter-spacing:.1em; }
  .method-card h3 { margin:6px 0 0; font-family:var(--serif); font-size:1rem; }
  .method-card p { margin:6px 0 0; color:#9ea69e; font-size:.75rem; }

  /* pick detail */
  .back { display:inline-block; margin-top:18px; font-size:.8rem; font-weight:700; color:var(--green); }
  dl.facts {
    display:grid; grid-template-columns:minmax(9rem,13rem) 1fr; gap:0;
    margin:0; font-size:.85rem;
  }
  dl.facts dt {
    padding:.5rem .6rem; border-bottom:1px solid var(--line);
    color:#9aa29a; text-transform:uppercase; letter-spacing:.08em;
    font-size:.64rem; font-weight:800;
  }
  dl.facts dd { margin:0; padding:.5rem .6rem; border-bottom:1px solid var(--line); }
  dl.facts dt:last-of-type, dl.facts dd:last-of-type { border-bottom:none; }
  dl.facts dd code { word-break:break-all; font-size:.72rem; }

  @media (max-width: 1080px) {
    .wrap { width:min(100% - 30px, 1080px); }
    .masthead-inner { grid-template-columns:auto 1fr; }
    .subscribe-top { display:none; }
    .nav { gap:24px; }
    .hero-grid { grid-template-columns:1fr .72fr; }
    h1 { font-size:clamp(2.8rem, 6vw, 4.7rem); }
    .kpi-strip { grid-template-columns:repeat(2,1fr); }
    .dashboard-row { grid-template-columns:1fr; }
    .curve-panel { min-height:240px; }
    .integrity-steps { grid-template-columns:repeat(3,1fr); row-gap:14px; }
    .integrity-step:nth-child(3)::after { display:none; }
    .lower-grid { grid-template-columns:1fr; }
    .page-hero { grid-template-columns:1fr .72fr; }
    .record-grid, .verify-layout { grid-template-columns:1fr; }
  }

  @media (max-width: 760px) {
    .wrap { width:min(100% - 24px, 720px); }
    .utility-inner { font-size:.61rem; letter-spacing:.09em; min-height:31px; }
    .utility-inner span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .utility-inner a { flex:0 0 auto; }
    .masthead { position:relative; }
    .masthead-inner { min-height:64px; grid-template-columns:1fr auto; gap:12px; }
    .brand { font-size:1.85rem; }
    .nav { display:none; }
    .mobile-nav {
      display:flex;
      gap:6px;
      overflow-x:auto;
      scrollbar-width:none;
      padding:0 0 10px;
    }
    .mobile-nav::-webkit-scrollbar { display:none; }
    .mobile-nav a {
      flex:0 0 auto;
      padding:6px 10px;
      border:1px solid var(--line);
      border-radius:999px;
      color:#aeb5ae;
      font-size:.72rem;
      font-weight:700;
    }
    .mobile-nav a[aria-current="page"] { border-color:#43765a; color:var(--green); background:#12251a; }
    .shadow-banner-inner { align-items:flex-start; font-size:.75rem; line-height:1.4; }
    .shadow-banner a { display:none; }
    .first-screen { padding-top:12px; }
    .hero-grid { grid-template-columns:1fr; gap:10px; }
    .hero-copy { min-height:0; padding:14px 2px 8px; }
    h1 { font-size:clamp(2.6rem, 13vw, 4.15rem); max-width:650px; }
    .standfirst { margin-top:14px; font-size:1rem; }
    .cta-row { margin-top:16px; }
    .summary-card { box-shadow:none; }
    .kpi-strip { grid-template-columns:repeat(2,1fr); gap:8px; }
    .kpi {
      min-height:78px;
      grid-template-columns:36px 1fr;
      gap:9px;
      padding:10px;
    }
    .kpi-icon { width:34px; height:34px; }
    .kpi strong { font-size:1.25rem; }
    .kpi .spark { display:none; }
    .dashboard-row { margin-top:8px; gap:8px; }
    .picks-panel, .curve-panel { min-height:auto; padding:12px; }
    table { min-width:700px; }
    .record-table { min-width:820px; }
    .integrity { padding:12px; }
    .integrity-steps { grid-template-columns:1fr; gap:5px; }
    .integrity-step { min-height:60px; padding-right:4px; }
    .integrity-step::after { display:none !important; }
    .lower-grid { margin-top:8px; gap:8px; }
    .newsletter, .limitations { padding:15px; }
    .newsletter-form { flex-direction:column; }
    .newsletter-form .btn { width:100%; }
    .footer-inner { display:block; }
    .footer-inner > * + * { margin-top:6px; }
    .page-main { padding-top:14px; }
    .page-hero { grid-template-columns:1fr; gap:8px; }
    .page-hero-copy { padding:14px 2px 8px; }
    .page-hero h1 { font-size:clamp(2.55rem,12vw,4rem); }
    .metric-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .section-panel, .verify-steps, .truth-card { padding:13px; }
    .verify-step { grid-template-columns:38px minmax(0,1fr); gap:10px; padding:13px 0; }
    .step-no { width:34px; height:34px; font-size:1rem; }
    .methodology-grid { grid-template-columns:1fr; }
    pre { font-size:.66rem; }
    dl.facts { grid-template-columns:1fr; }
    dl.facts dt { border-bottom:none; padding-bottom:0; }
    dl.facts dd { padding-top:.15rem; }
  }

  @media (max-width: 430px) {
    .utility-inner a { font-size:0; }
    .utility-inner a::after { content:"GitHub ↗"; font-size:.61rem; }
    .shadow-banner-inner { padding:8px 10px; }
    h1 { font-size:2.8rem; }
    .kpi-strip { grid-template-columns:1fr 1fr; }
    .kpi span { font-size:.7rem; }
    .summary-card { padding:15px; }
    .metric-grid { grid-template-columns:1fr 1fr; }
    .metric-card { padding:10px; min-height:84px; }
    .metric-card .value { font-size:1.4rem; }
  }
`;

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function kickoffParts(iso) {
  const date = new Date(iso);
  return {
    date: `${DOW[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    shortDate: `${DOW[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`,
    time: `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`,
  };
}

// Display-only sign cosmetics; the underlying strings stay exact.
function fmtNet(value) {
  if (value === null || value === undefined) return "—";
  const text = String(value);
  if (text.startsWith("-")) return `−${text.slice(1)}`;
  return text === "0" ? "0" : `+${text}`;
}

function fmtDrawdown(value) {
  return value === "0" ? "0" : `−${value}`;
}

// Public headlines use the frozen three-decimal half-up display contract.
function fmtUnits(value) {
  if (value === null || value === undefined) return "—";
  const text = formatPublicDecimal(String(value));
  if (text.startsWith("-")) return `−${text.slice(1)}`;
  return text === "0.000" ? "0.000" : `+${text}`;
}

// Display-only cosmetic: exact strings keep their trailing zeros everywhere
// they are audit handles; headline figures read better trimmed.
function trimZeros(value) {
  if (value === null || value === undefined) return "—";
  const text = String(value);
  return text.includes(".") ? text.replace(/0+$/u, "").replace(/\.$/u, "") : text;
}

function selectionLabel(frozen) {
  const side = frozen.selection === "HOME" ? "Home" : "Away";
  const line = frozen.line.startsWith("-") ? `−${frozen.line.slice(1)}` : frozen.line;
  return `${side} ${line} @ ${frozen.normalized_decimal_price}`;
}

function handicapLabel(frozen) {
  return frozen.line.startsWith("-") ? `−${frozen.line.slice(1)}` : frozen.line;
}

function sideLabel(frozen) {
  return frozen.selection === "HOME" ? "Home" : "Away";
}

function pillClass(classification) {
  if (classification === "WIN" || classification === "HALF_WIN") return "win";
  if (classification === "LOSS" || classification === "HALF_LOSS") return "loss";
  if (classification === "VOID") return "push";
  return "push";
}

function outcomePill(current) {
  if (current === undefined) return `<span class="pill pend">Awaiting result</span>`;
  if (current.record_state === "PENDING") return `<span class="pill pend">Pending</span>`;
  const label = OUTCOME_EN[current.classification] ?? current.classification;
  return `<span class="pill ${pillClass(current.classification)}">${esc(label)}</span>`;
}

function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / power;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return nice * power;
}

function tickLabel(value) {
  return String(Number((Math.round(value * 100) / 100).toFixed(2)));
}

// Deterministic mini sparkline for the KPI strip. Values come from ledger
// data; an empty or single-point series renders the flat baseline used in
// the approved mockups.
function sparkPoints(values) {
  if (values.length < 2) return "2,28 98,28";
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) return "2,28 98,28";
  const y = (value) => 34 - ((value - lo) / (hi - lo)) * 28;
  return values
    .map((value, index) => `${(2 + (index / (values.length - 1)) * 96).toFixed(1)},${y(value).toFixed(1)}`)
    .join(" ");
}

function kpiCard(icon, value, labelLines, spark, extraClass = "") {
  return `<article class="kpi"${extraClass}>
      <div class="kpi-icon">${icon}</div>
      <div><strong>${value}</strong><span>${labelLines}</span></div>
      <svg class="spark" viewBox="0 0 100 40" aria-hidden="true"><polyline points="${spark}"/></svg>
    </article>`;
}

// Official-window projection: reuses the frozen performance engine over the
// picks inside the formal window, so every official figure is computed with
// the same exact-decimal arithmetic as the all-time standings. While
// the declared window is null (shadow run) the projection is empty and the
// official panels legitimately read zero.
export function officialProjection(orderedPicks, settlements, window) {
  const input = [];
  for (const pick of orderedPicks) {
    if (!inFormalWindow(pick, window)) continue;
    const record = settlements.get(pick.id);
    const head = record?.current;
    const settledRevisions = head?.record_state === "SETTLED"
      ? (record?.revisions ?? []).filter((revision) => revision.result.record_state === "SETTLED").map((revision) => ({
        settlement_id: revision.result_file_sha256,
        revision: revision.revision,
        classification: revision.result.classification,
        net_return: revision.result.net_return,
      }))
      : [];
    input.push({
      pick_id: pick.id,
      kickoff_utc: pick.kickoffUtc,
      normalized_decimal_price: pick.frozen.normalized_decimal_price,
      current_settlement_id: head !== undefined && head.record_state === "SETTLED"
        ? head.result_file_sha256
        : null,
      settlements: settledRevisions,
    });
  }
  return buildPerformanceProjection(input);
}

function formalNote(window) {
  if (window.start_utc === null) {
    return "Formal 90-day verification has not started. Shadow-run records are excluded.";
  }
  return `Formal window counts kickoffs from ${window.start_utc} (inclusive) to ${window.end_utc} (exclusive).`;
}

// Deterministic inline SVG of the exact cumulative net return, in the chart
// language of the approved design. No client-side chart library: geometry is
// computed at build time from the projection. When fewer than two picks have
// settled, the empty placeholder grid from the mockups is rendered instead.
function curveChart(curve, width, height, gradientId, firstLabel, lastLabel) {
  if (curve.length < 2) return "";
  const left = width > 500 ? 48 : 34;
  const right = width - 16;
  const top = 22;
  const bottom = height - 18;
  const values = curve.map((point) => Number.parseFloat(point.cumulative_net_return));
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const padding = (hi - lo) * 0.08;
  hi += padding;
  lo -= padding;
  const x = (index) => left + (index / (curve.length - 1)) * (right - left);
  const y = (value) => top + ((hi - value) / (hi - lo)) * (bottom - top);
  const points = values.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
  const zeroY = y(0).toFixed(2);

  const step = niceStep((hi - lo) / 3.2);
  const ticks = [];
  for (let value = Math.ceil(lo / step) * step; value <= hi; value += step) {
    const vy = y(value);
    if (Math.abs(vy - y(0)) < 6) continue;
    ticks.push(`<line class="grid" x1="${left}" y1="${vy.toFixed(2)}" x2="${right}" y2="${vy.toFixed(2)}"/><text class="axis" x="${left - 6}" y="${(vy + 3.5).toFixed(2)}" text-anchor="end">${esc(tickLabel(value))}</text>`);
  }

  const first = kickoffParts(curve[0].kickoff_utc);
  const last = kickoffParts(curve[curve.length - 1].kickoff_utc);
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Cumulative net return curve, currently ${esc(fmtNet(curve[curve.length - 1].cumulative_net_return))} unit stakes">
        <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6fce91" stop-opacity=".25"/><stop offset="100%" stop-color="#6fce91" stop-opacity="0"/></linearGradient></defs>
        ${ticks.join("")}
        <line class="grid" x1="${left}" y1="${zeroY}" x2="${right}" y2="${zeroY}"/><text class="axis" x="${left - 6}" y="${(Number(zeroY) + 3.5).toFixed(2)}" text-anchor="end">0</text>
        <polygon class="area" fill="url(#${gradientId})" points="${x(0).toFixed(2)},${zeroY} ${points} ${x(curve.length - 1).toFixed(2)},${zeroY}"/>
        <polyline class="line" points="${points}"/>
        <text class="axis" x="${left}" y="${height - 5}">${esc(firstLabel ?? first.shortDate)}</text>
        <text class="axis" x="${right}" y="${height - 5}" text-anchor="end">${esc(lastLabel ?? last.shortDate)}</text>
      </svg>`;
}

// Empty-state placeholder chart from the approved mockups: reference grid
// with the "begins once two picks have settled" overlay. Axis labels stay
// generic ("First" / "Latest") because the real span is data-dependent.
function emptyCurveChart(width, height) {
  const left = width > 500 ? 48 : 34;
  const right = width - 16;
  const top = 24;
  const bottom = height - 20;
  const y1 = top;
  const y2 = top + (bottom - top) / 2;
  const y3 = bottom;
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <line class="grid" x1="${left}" y1="${y1}" x2="${right}" y2="${y1}"/>
        <line class="grid" x1="${left}" y1="${y2}" x2="${right}" y2="${y2}"/>
        <line class="grid" x1="${left}" y1="${y3}" x2="${right}" y2="${y3}"/>
        <text class="axis" x="${left - 6}" y="${y1 + 4}" text-anchor="end">+10</text>
        <text class="axis" x="${left - 6}" y="${y2 + 4}" text-anchor="end">0</text>
        <text class="axis" x="${left - 6}" y="${y3 + 4}" text-anchor="end">-10</text>
        <text class="axis" x="${left}" y="${height - 5}">First</text>
        <text class="axis" x="${right}" y="${height - 5}" text-anchor="end">Latest</text>
        <polyline class="line" points="${left},${y2} ${right},${y2}"/>
      </svg>`;
}

function curvePanel(curve, gradientId, chartWidth, chartHeight) {
  return `<article class="panel curve-panel" aria-label="Cumulative profit">
      <div class="panel-title">
        <div>
          <h2>All-time Profit (Units)</h2>
          <div class="curve-value">${esc(fmtUnits(curve.length === 0 ? "0" : curve[curve.length - 1].cumulative_net_return))}</div>
        </div>
        <a href="track-record.html">More →</a>
      </div>
      <div class="curve-empty">
        ${curveChart(curve, chartWidth, chartHeight, gradientId) || emptyCurveChart(chartWidth, chartHeight)}
        ${curve.length < 2 ? `<div class="curve-empty-message">The equity curve begins once two picks have settled.</div>` : ""}
      </div>
    </article>`;
}

// Renders the newsletter signup slot from the given config (defaults to the
// repository wiring in NEWSLETTER). Returns "" when disabled, so the section
// — and every third-party reference inside it — disappears from the built
// pages entirely.
export function newsletterSlot(config = NEWSLETTER) {
  if (!config.enabled) return "";
  const hiddenFields = Object.entries(config.hiddenFields)
    .map(([name, value]) => `\n        <input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join("");
  return `<article id="newsletter" class="panel newsletter">
      <h2>Follow the ledger by email</h2>
      <p>One email when a new pick is published to the ledger — and nothing else. The full public record remains here.</p>
      <form class="newsletter-form" action="${esc(config.formAction)}" method="post">${hiddenFields}
        <label class="sr-only" for="newsletter-email">Email address</label>
        <input type="email" id="newsletter-email" name="${esc(config.emailFieldName)}" placeholder="you@example.com" autocomplete="email" required>
        <button class="btn primary" type="submit">${esc(config.buttonLabel)}</button>
      </form>
      <p class="fineprint">Privacy &amp; consent — subscribing is voluntary and free. Your address is submitted directly to ${esc(config.providerName)}, the newsletter provider, and is used only to send this newsletter; it is never sold and never shared. Every email carries a one-click unsubscribe. This site sets no cookies and runs no client-side scripts — nothing is sent anywhere unless you press “${esc(config.buttonLabel)}”. Delivery by <a href="${esc(config.providerUrl)}">${esc(config.providerName)}</a>.</p>
    </article>`;
}

function page(title, description, body, activeNav, prefix, window, canonicalPath = "", robotsContent = null) {
  const navItems = [
    ["index.html", "Overview"],
    ["track-record.html", "Full Record"],
    ["verification.html", "Verify It Yourself"],
    ["verification.html#methodology", "Methodology"],
  ];
  const mobileItems = [
    ["index.html", "Overview"],
    ["track-record.html", "Full Record"],
    ["verification.html", "Verify"],
    ["index.html#newsletter", "Subscribe"],
  ];
  const nav = navItems.map(([href, label]) =>
    `<a href="${prefix}${href}"${href === activeNav ? ' aria-current="page"' : ""}>${label}</a>`).join("\n        ");
  const mobileNav = mobileItems.map(([href, label]) =>
    `<a href="${prefix}${href}"${href === activeNav ? ' aria-current="page"' : ""}>${label}</a>`).join("\n      ");
  const subscribeHref = activeNav === "index.html" ? "#newsletter" : `${prefix}index.html#newsletter`;
  const canonicalUrl = `${SITE_URL}/${canonicalPath}`;
  const socialImage = `${SITE_URL}/og-image.png`;
  const robotsMeta = robotsContent === null ? "" : `\n<meta name="robots" content="${esc(robotsContent)}">`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="description" content="${esc(description)}">${robotsMeta}
<link rel="canonical" href="${esc(canonicalUrl)}">
<link rel="icon" type="image/svg+xml" href="${prefix}favicon.svg">
<link rel="alternate" type="application/rss+xml" title="Pattern XI — Picks (RSS)" href="${prefix}feeds/picks.xml">
<link rel="alternate" type="application/rss+xml" title="Pattern XI — Results (RSS)" href="${prefix}feeds/results.xml">
<meta property="og:site_name" content="Pattern XI">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)} · Pattern XI">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonicalUrl)}">
<meta property="og:image" content="${esc(socialImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)} · Pattern XI">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(socialImage)}">
<title>${esc(title)} · Pattern XI</title>
<style>${STYLE}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="utility"><div class="wrap utility-inner">
  <span>A public · prospective · auditable ledger</span>
  <a href="${REPO_URL}">GitHub repository ↗</a>
</div></div>
<header class="masthead"><div class="wrap">
  <div class="masthead-inner">
    <a class="brand" href="${prefix}index.html">Pattern <em>XI</em></a>
    <nav class="nav" aria-label="Primary navigation">
        ${nav}
    </nav>
    <a class="subscribe-top" href="${subscribeHref}">Subscribe</a>
  </div>
  <nav class="mobile-nav" aria-label="Mobile navigation">
      ${mobileNav}
  </nav>
</div></header>
<div class="shadow-banner"><div class="wrap shadow-banner-inner">
  <div>${window.start_utc === null ? "<strong>SHADOW RUN — trial operation.</strong> Picks made in this phase do not count towards the formal 90-day public verification window." : `<strong>FORMAL WINDOW — 90-day public verification.</strong> ${esc(formalNote(window))}`}</div>
  <a href="${prefix}verification.html">Learn more →</a>
</div></div>
<main id="main" class="wrap ${activeNav === "index.html" ? "first-screen" : "page-main"}">
${body}
</main>
<footer><div class="wrap footer-inner">
  <div><strong style="color:#a9b0a9">Pattern XI</strong> — a public, prospective, auditable football picks ledger.</div>
  <div>Settlement Rules v1 · 51 tested cases + 1 documented exception · No server · No tracking · No client-side scripts</div>
</div></footer>
</body>
</html>
`;
}

function buildIndexPage(orderedPicks, settlements, standings, window) {
  const official = officialProjection(orderedPicks, settlements, window);
  const upcoming = orderedPicks
    .filter((pick) => settlements.get(pick.id)?.current.record_state !== "SETTLED")
    .slice(0, 12);
  const badge = `${upcoming.length} pick${upcoming.length === 1 ? "" : "s"}`;

  const rows = upcoming.map((pick) => {
    const current = settlements.get(pick.id)?.current;
    const parts = kickoffParts(pick.kickoffUtc);
    const status = current === undefined
      ? `<span class="status await">Awaiting result</span>`
      : `<span class="status await">Pending</span>`;
    return `          <tr>
            <td class="num">${esc(parts.shortDate)} · ${esc(parts.time)}<br><small>UTC</small></td>
            <td>${esc(pick.data.competition)}</td>
            <td class="match"><a href="picks/${esc(pick.id)}.html">${esc(pick.data.match)}</a></td>
            <td>Asian handicap</td>
            <td>${esc(sideLabel(pick.frozen))} <small>${esc(handicapLabel(pick.frozen))}</small></td>
            <td class="num">${esc(pick.data.published_price)} <small>${pick.data.published_price_format === "HONG_KONG_ODDS" ? "HK" : "dec"}</small></td>
            <td>${status}</td>
          </tr>`;
  }).join("\n");

  const officialSparks = [];
  let running = 0;
  for (const pick of orderedPicks) {
    if (!inFormalWindow(pick, window)) continue;
    running += 1;
    officialSparks.push(running);
  }
  const netSpark = standings.cumulative_return_curve.map((point) => Number.parseFloat(point.cumulative_net_return));

  return page("Overview",
    "Pattern XI is a public football picks ledger with an exact-commit publication witness, complete-state Bitcoin timestamps and append-only correction provenance.",
    `
<section class="hero-grid" aria-labelledby="headline">
  <div class="hero-copy">
    <p class="eyebrow">Independent Asian handicap ledger</p>
    <h1 id="headline">The line. The price.<br>The public record.</h1>
    <p class="standfirst">Every selection appears in public before kickoff, then stays on the record. No previews, no hidden model notes — just the final side, handicap and published price.</p>
    <div class="cta-row">
      <a class="btn primary" href="#upcoming">See today’s picks →</a>
      <a class="btn" href="track-record.html">Read the full record</a>
    </div>
  </div>

  <aside class="panel summary-card" aria-label="Performance summary">
    <div class="panel-title">
      <h2>90-Day Performance <span class="muted">(Public)</span></h2>
      <a href="track-record.html">More →</a>
    </div>
    <dl class="summary-list">
      <div><dt>Official Picks</dt><dd>${official.pick_count}</dd></div>
      <div><dt>Win</dt><dd class="positive">${official.classification_counts.WIN}</dd></div>
      <div><dt>Half Win</dt><dd class="positive">${official.classification_counts.HALF_WIN}</dd></div>
      <div><dt>Push</dt><dd>${official.classification_counts.PUSH}</dd></div>
      <div><dt>Half Loss</dt><dd class="negative">${official.classification_counts.HALF_LOSS}</dd></div>
      <div><dt>Loss</dt><dd class="negative">${official.classification_counts.LOSS}</dd></div>
      <div class="rule"></div>
      <div><dt>Total Profit (Units)</dt><dd class="${Number(official.total_net_return) < 0 ? "negative" : "positive"}">${esc(fmtNet(official.total_net_return))}</dd></div>
      <div><dt>ROI</dt><dd>${official.roi_percent === null ? "—" : `${esc(trimZeros(official.roi_percent))}%`}</dd></div>
      <div><dt>Average Price</dt><dd>${official.average_decimal_price === null ? "—" : esc(trimZeros(official.average_decimal_price))}</dd></div>
      <div><dt>Max Drawdown (Units)</dt><dd>${esc(fmtDrawdown(official.maximum_drawdown))}</dd></div>
    </dl>
    <p class="summary-note">${esc(formalNote(window))}</p>
  </aside>
</section>

<section class="kpi-strip" aria-label="At a glance">
  ${kpiCard("⌁", official.pick_count, "Official Picks<br>Current ledger", sparkPoints(officialSparks))}
  ${kpiCard("◎", standings.n, "Settled Picks<br>All-time, voids excluded", sparkPoints(netSpark))}
  ${kpiCard("⏱", "≥2h", "Publication Gate<br>GitHub witness", "2,29 18,29 34,29 50,22 66,22 82,22 98,15")}
  ${kpiCard("◇", "52", "Golden Cases<br>51 tested + 1 exception", "2,29 18,26 34,28 50,21 66,22 82,17 98,18")}
</section>

<section class="dashboard-row">
  <article id="upcoming" class="panel picks-panel" aria-label="Today's and upcoming picks">
    <div class="panel-title">
      <h2>Today’s / Upcoming Picks <span class="badge">${badge}</span></h2>
      <a href="track-record.html">View full record →</a>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time (UTC)</th>
            <th>Competition</th>
            <th>Match</th>
            <th>Market</th>
            <th>Selection</th>
            <th>Price</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
${upcoming.length === 0
    ? `          <tr class="empty-row">
            <td colspan="7">No picks yet. A pick becomes public in an exact PR commit and must pass its GitHub-hosted two-hour check before it can enter the formal ledger.</td>
          </tr>`
    : rows}
        </tbody>
      </table>
    </div>
    <p class="subnote">All published prices are frozen at publication. All times shown in UTC.</p>
  </article>

  ${curvePanel(standings.cumulative_return_curve, "curveFill", 430, 174)}
</section>

<section class="panel integrity" aria-label="Proof of publication">
  <div class="panel-title">
    <h2>Proof of Publication <span class="muted">— how integrity is checked</span></h2>
    <a href="verification.html">Verify it yourself →</a>
  </div>
  <div class="integrity-steps">
    <div class="integrity-step">
      <div class="step-icon">PR</div>
      <strong>1. Public before kickoff</strong>
      <p>The exact pick version is exposed in a public pull request.</p>
    </div>
    <div class="integrity-step">
      <div class="step-icon">CI</div>
      <strong>2. GitHub-hosted witness</strong>
      <p>The same SHA must pass the two-hour rule on GitHub Actions.</p>
    </div>
    <div class="integrity-step">
      <div class="step-icon">#</div>
      <strong>3. Full-state manifest</strong>
      <p>Every formal pick in the ledger state is SHA-256 hashed.</p>
    </div>
    <div class="integrity-step">
      <div class="step-icon">₿</div>
      <strong>4. Bitcoin timestamp</strong>
      <p>OpenTimestamps anchors the complete state independently.</p>
    </div>
    <div class="integrity-step">
      <div class="step-icon">↻</div>
      <strong>5. Rebuild everything</strong>
      <p>Settlement and standings are deterministic and reproducible.</p>
    </div>
  </div>
</section>

<section class="lower-grid">
  ${newsletterSlot(NEWSLETTER)}

  <article class="panel limitations">
    <h2>What the ledger proves</h2>
    <p>The system is designed to make retrospective alteration detectable and to let anyone rebuild the published record independently.</p>
    <ul>
      <li>Publication witness: public PR + exact-SHA GitHub Actions check.</li>
      <li>Independent anchor: OpenTimestamps / Bitcoin.</li>
      <li>Corrections are append-only and hash-linked.</li>
      <li>Scores and prices remain operator-entered facts.</li>
    </ul>
  </article>
</section>
`, "index.html", "", window, "index.html");
}

function buildTrackRecordPage(orderedPicks, settlements, standings, window) {
  const descending = [...orderedPicks].reverse();
  const rows = descending.map((pick) => {
    const current = settlements.get(pick.id)?.current;
    const parts = kickoffParts(pick.kickoffUtc);
    return `        <tr>
          <td class="num">${esc(parts.date)} · ${esc(parts.time)}</td>
          <td>${esc(pick.data.competition)}</td>
          <td class="match"><a href="picks/${esc(pick.id)}.html">${esc(pick.data.match)}</a></td>
          <td>${esc(sideLabel(pick.frozen))}</td>
          <td class="num">${esc(handicapLabel(pick.frozen))}</td>
          <td class="num">${esc(pick.data.published_price)} <small>${pick.data.published_price_format === "HONG_KONG_ODDS" ? "HK" : "dec"}</small></td>
          <td>${outcomePill(current)}</td>
          <td class="num">${current === undefined || current.net_return === null ? "—" : esc(fmtNet(current.net_return))}</td>
        </tr>`;
  }).join("\n");

  const roi = standings.roi_percent === null ? "—" : `${esc(trimZeros(standings.roi_percent))}%`;
  const chips = ["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"]
    .map((key) => {
      const cls = key === "WIN" || key === "HALF_WIN" ? "win" : key === "PUSH" ? "push" : "loss";
      return `<span class="outcome-chip ${cls}">${OUTCOME_EN[key]} <b>${standings.classification_counts[key] ?? 0}</b></span>`;
    })
    .join("\n          ");

  const trackNote = window.start_utc === null
    ? "Figures cover the whole current ledger. The formal 90-day verification window has not started; shadow-run picks do not count towards it."
    : `Figures cover the whole current ledger. ${formalNote(window)}`;

  return page("Full record",
    "Every pick Pattern XI has ever published, winners and losers alike — generated straight from the public Git ledger.",
    `
<section class="page-hero" aria-labelledby="record-title">
  <div class="page-hero-copy">
    <p class="eyebrow">Full record</p>
    <h1 id="record-title">Every pick.<br>Winners and losers alike.</h1>
    <p class="standfirst">Authoritative inputs follow append-only rules and corrections remain visible. The record below is generated straight from the ledger; the curve is exact cumulative net return, unit stake by unit stake.</p>
  </div>
  <aside class="panel summary-card" aria-label="Record summary">
    <div class="panel-title"><h2>Record at a glance</h2><a href="verification.html">How verified →</a></div>
    <dl class="summary-list">
      <div><dt>Settled Picks</dt><dd>${standings.n}</dd></div>
      <div><dt>Net Return (Units)</dt><dd class="${Number(standings.total_net_return) < 0 ? "negative" : "positive"}">${esc(fmtNet(standings.total_net_return))}</dd></div>
      <div><dt>Return on Turnover</dt><dd>${roi}</dd></div>
      <div><dt>Average Price</dt><dd>${standings.average_decimal_price === null ? "—" : esc(trimZeros(standings.average_decimal_price))}</dd></div>
      <div><dt>Max Drawdown</dt><dd>${esc(fmtDrawdown(standings.maximum_drawdown))}</dd></div>
      <div><dt>Pending / Void</dt><dd>${standings.pending_count} / ${standings.void_count}</dd></div>
    </dl>
    <p class="summary-note">${esc(trackNote)}</p>
  </aside>
</section>

<section class="metric-grid section-gap" aria-label="Performance metrics">
  <article class="metric-card"><div class="label">Settled picks</div><div class="value">${standings.n}</div><div class="sub">Voids excluded</div></article>
  <article class="metric-card"><div class="label">Net return</div><div class="value ${Number(standings.total_net_return) < 0 ? "negative" : "positive"}">${esc(fmtNet(standings.total_net_return))}</div><div class="sub">Unit stakes</div></article>
  <article class="metric-card"><div class="label">Return on turnover</div><div class="value">${roi}</div><div class="sub">Exact decimal</div></article>
  <article class="metric-card"><div class="label">Average price</div><div class="value">${standings.average_decimal_price === null ? "—" : esc(trimZeros(standings.average_decimal_price))}</div><div class="sub">Published price</div></article>
  <article class="metric-card"><div class="label">Max drawdown</div><div class="value">${esc(fmtDrawdown(standings.maximum_drawdown))}</div><div class="sub">Zero-start basis</div></article>
  <article class="metric-card"><div class="label">Pending / void</div><div class="value">${standings.pending_count} / ${standings.void_count}</div><div class="sub">Current ledger</div></article>
</section>

<section class="record-grid">
  <article class="panel section-panel" aria-label="Cumulative net return">
    <div class="section-heading"><div><h2>Cumulative net return (all-time)</h2><p>Exact-decimal return after each settled pick across the whole ledger</p></div><div class="curve-value">${esc(fmtUnits(standings.cumulative_return_curve.length === 0 ? "0" : standings.cumulative_return_curve[standings.cumulative_return_curve.length - 1].cumulative_net_return))} Units</div></div>
    <div class="curve-empty">
      ${curveChart(standings.cumulative_return_curve, 760, 220, "curveFillTrack") || emptyCurveChart(760, 220)}
      ${standings.cumulative_return_curve.length < 2 ? `<div class="curve-empty-message">The equity curve begins once two picks have settled.</div>` : ""}
    </div>
    <p class="fineprint">Rendered at build time from <span class="mono">standings/standings.json</span>. Grid reference lines are visual only; the committed figures remain authoritative.</p>
  </article>

  <aside class="panel section-panel" aria-label="Outcome distribution">
    <div class="section-heading"><h2>Outcome distribution</h2></div>
    <div class="outcome-chips">
          ${chips}
    </div>
    <div class="notice-box" style="margin-top:14px"><strong>Append-only record.</strong> Published picks and results are never overwritten. Corrections append a hash-linked revision, so the history remains visible.</div>
  </aside>
</section>

<section class="panel section-panel section-gap" aria-label="Complete pick record">
  <div class="section-heading"><div><h2>Complete pick record</h2><p>Newest first · every formal pick remains listed</p></div><a href="verification.html">Verify the ledger →</a></div>
  <div class="table-wrap">
    <table class="record-table">
      <thead><tr><th>Kickoff (UTC)</th><th>Competition</th><th>Match</th><th>Selection</th><th>Line</th><th>Price</th><th>Outcome</th><th>Net</th></tr></thead>
      <tbody>
${descending.length === 0
    ? `        <tr class="empty-row"><td colspan="8">The ledger is empty. The first formal pick will start the record — and it will stay here, whatever it settles as.</td></tr>`
    : rows}
      </tbody>
    </table>
  </div>
  <p class="fineprint">Each pick links to its own detail page with the frozen price, the result chain and the component-by-component settlement.</p>
</section>
`, "track-record.html", "", window, "track-record.html");
}

function buildVerificationPage(window) {
  const code = (text) => `<pre><code>${esc(text)}</code></pre>`;
  return page("Verify it yourself",
    "Verify the exact-commit public PR witness, full-state Bitcoin timestamp and deterministic rebuild of the Pattern XI ledger.",
    `
<section class="page-hero" aria-labelledby="verify-title">
  <div class="page-hero-copy">
    <p class="eyebrow">Verification</p>
    <h1 id="verify-title">Trust, but verify.</h1>
    <p class="standfirst">This site has no database and no back office. It is static HTML generated from a public Git repository, and its central claims can be checked from your own machine.</p>
    <div class="cta-row"><a class="btn primary" href="#five-minutes">Run the five-minute check →</a><a class="btn" href="${REPO_URL}">Open GitHub repository ↗</a></div>
  </div>
  <aside class="panel summary-card" aria-label="Three-layer evidence model">
    <div class="panel-title"><h2>Three-layer evidence model</h2></div>
    <div class="evidence-stack">
      <div class="evidence-mini"><div class="n">01</div><div><strong>Public publication witness</strong><p>Public PR + GitHub-hosted check for the exact SHA at least two hours before kickoff.</p></div></div>
      <div class="evidence-mini"><div class="n">02</div><div><strong>Independent cryptographic timestamp</strong><p>A full ledger-state manifest is hash-linked and anchored through OpenTimestamps / Bitcoin.</p></div></div>
      <div class="evidence-mini"><div class="n">03</div><div><strong>Append-only correction provenance</strong><p>Published inputs are not overwritten; revisions point to the exact prior bytes.</p></div></div>
    </div>
  </aside>
</section>

<section id="five-minutes" class="verify-layout">
  <article class="panel verify-steps" aria-label="Five-minute verification">
    <div class="section-heading"><div><h2>Verify the record step by step</h2><p>Check the public witness, Bitcoin anchor and deterministic rebuild.</p></div></div>

    <div class="verify-step"><div class="step-no">1</div><div><h3>Clone the repository</h3><p>The ledger is the repository. The site is merely a deterministic view of it.</p>${code(`git clone ${REPO_URL}.git\ncd pattern-xi-ledger`)}</div></div>

    <div class="verify-step"><div class="step-no">2</div><div><h3>Verify the public publication witness</h3><p>Use the addition commit to locate the merged public PR, then read its final headRefOid and compare the pick bytes with the selected main commit. The addition commit alone need not be the final PR head. The earliest successful <em>Ledger integrity</em> job for that exact head SHA is the witness; its GitHub server-side <span class="mono">startedAt</span> must be at least two hours before kickoff. A changed pick has a new SHA and must pass again. Inspect all relevant runs and their attempts (increase the list limit for older records); use the earliest successful Ledger integrity job for that head, even if a later attempt failed.</p>${code(`git log --all --diff-filter=A --format=%H -- picks/2026/<pick-file>.json\ngh api repos/rosebellwau8/pattern-xi-ledger/commits/<addition-sha>/pulls\ngh pr view <pr-number> --json headRefOid,mergeCommit,files,url\ngit fetch origin pull/<pr-number>/head\ngit diff --exit-code <head-sha> <main-commit-sha> -- picks/2026/<pick-file>.json\ngh run list --event pull_request --commit <head-sha> --workflow Check --limit 100 --json databaseId,headSha,event,conclusion,url\ngh run view <run-id> --json headSha,jobs\ngh api repos/rosebellwau8/pattern-xi-ledger/actions/runs/<run-id>/attempts/<attempt>/jobs`)}</div></div>

    <div class="verify-step"><div class="step-no">3</div><div><h3>Inspect a full ledger-state snapshot</h3><p>Every manifest names one exact <span class="mono">main</span> commit, lists the SHA-256 of every formal pick in that complete ledger state, and links to the previous manifest bytes.</p>${code(`git switch anchors\ncat manifests/<date>.txt\ngit show <main-commit-sha>:picks/2026/<pick-file>.json | sha256sum`)}</div></div>

    <div class="verify-step"><div class="step-no">4</div><div><h3>Verify the independent cryptographic timestamp</h3><p>OpenTimestamps proves that the full ledger-state snapshot existed before its Bitcoin time anchor. It is the independent second layer, not the primary two-hour witness for an individual pick.</p>${code(`pip install opentimestamps-client\nots verify manifests/<date>.txt.ots`)}</div></div>

    <div class="verify-step"><div class="step-no">5</div><div><h3>Rebuild the entire record</h3><p>Switch back from anchors to the main snapshot you are verifying. Recompute every settlement and the whole track record from raw picks and results. If rebuilt output differs from what is committed, the discrepancy is visible.</p>${code(`git switch --detach <main-commit-sha>\nnode scripts/settle.mjs && node scripts/standings.mjs && node scripts/check-derived.mjs`)}</div></div>
  </article>

  <aside class="verify-side">
    <article class="panel truth-card"><h2>What this proves</h2><p><strong>Publication:</strong> the exact final pick version was publicly exposed and passed the GitHub-hosted two-hour gate.</p><p><strong>Historical state:</strong> Bitcoin-anchored manifests create an independent cryptographic record of previously published ledger states.</p><p><strong>Reproducibility:</strong> settlement and standings can be rebuilt deterministically from committed inputs.</p></article>
    <article class="panel truth-card"><h2>What it does not prove</h2><ul><li>Scores and prices remain operator-entered facts and are not independently verified here.</li><li>Repository owners still control GitHub settings; GitHub history itself is not cryptographically immutable.</li><li>The static design greatly reduces the operational attack surface but still depends on GitHub, Actions, Pages and OpenTimestamps.</li></ul></article>
    <article class="panel truth-card"><h2>Settlement integrity</h2><p>Settlement mathematics is frozen under Settlement Rules v1 and guarded by a 52-case owner-reviewed golden dataset (51 behavioral cases; database preview case 045 is explicitly exempted in DESIGN.md). Result facts are inputs; win / half-win / push / half-loss / loss / void and net return are program-derived.</p></article>
  </aside>
</section>

<section id="methodology" class="section-gap" aria-label="Methodology">
  <div class="section-heading"><div><h2>Methodology, in one screen</h2><p>The operating boundary is deliberately narrow.</p></div></div>
  <div class="methodology-grid">
    <article class="panel method-card"><div class="k">01 · PUBLICATION</div><h3>One exact version enters the record</h3><p>A pick must be public in a PR and pass the exact-SHA GitHub-hosted two-hour check before formal admission.</p></article>
    <article class="panel method-card"><div class="k">02 · SETTLEMENT</div><h3>Facts in, conclusion out</h3><p>Scores and match status are recorded as facts. Classification and unit return are always calculated by frozen code.</p></article>
    <article class="panel method-card"><div class="k">03 · HISTORY</div><h3>Corrections append; history stays visible</h3><p>Published inputs are not silently replaced. A correction references the prior file bytes and creates a linear provenance chain.</p></article>
  </div>
</section>
`, "verification.html", "", window, "verification.html");
}

function buildPickPage(pick, settlement, window) {
  const parts = kickoffParts(pick.kickoffUtc);
  const chain = settlement?.revisions ?? [];
  const current = settlement?.current;
  const priceFormat = pick.data.published_price_format === "HONG_KONG_ODDS" ? "Hong Kong" : "decimal";

  const chainRows = chain.length === 0
    ? `<tr class="empty-row"><td colspan="5">No result recorded yet.</td></tr>`
    : chain.map((revision) => `        <tr>
          <td>r${revision.revision}</td>
          <td><code>${esc(revision.result_file)}</code></td>
          <td><code>${esc(revision.result_file_sha256.slice(0, 16))}…</code></td>
          <td>${outcomePill(revision.result)}</td>
          <td class="num">${revision.result.net_return === null ? "—" : esc(fmtNet(revision.result.net_return))}</td>
        </tr>`).join("\n");

  const components = chain.length === 0 || current?.record_state === "PENDING"
    ? `<tr class="empty-row"><td colspan="2">Component settlement appears once the match settles.</td></tr>`
    : settlement.revisions[settlement.revisions.length - 1].result.components
      .map((component) => `        <tr>
          <td class="num">${esc(component.line.startsWith("-") ? `−${component.line.slice(1)}` : component.line)}</td>
          <td><span class="pill ${pillClass(component.result === "WIN" ? "WIN" : component.result === "LOSS" ? "LOSS" : "PUSH")}">${esc(COMPONENT_EN[component.result] ?? component.result)}</span></td>
        </tr>`).join("\n");

  const verdictList = current === undefined || current.record_state === "PENDING"
    ? `<dl class="summary-list">
      <div><dt>Record state</dt><dd>${current === undefined ? "Awaiting result" : "Pending"}</dd></div>
      <div class="rule"></div>
      <div><dt>Net return</dt><dd>—</dd></div>
      <div><dt>Unit stake</dt><dd>1</dd></div>
    </dl>`
    : `<dl class="summary-list">
      <div><dt>Classification</dt><dd>${esc(OUTCOME_EN[current.classification] ?? current.classification)}</dd></div>
      <div class="rule"></div>
      <div><dt>Net return</dt><dd class="${Number(current.net_return) < 0 ? "negative" : "positive"}">${esc(fmtNet(current.net_return))}</dd></div>
      <div><dt>Unit stake</dt><dd>1</dd></div>
    </dl>`;

  return page(pick.data.match,
    `${pick.data.match} — ${selectionLabel(pick.frozen)}, published at least two hours before kickoff in the Pattern XI public ledger.`,
    `
<a class="back" href="../track-record.html">← Full record</a>

<section class="page-hero" style="margin-top:10px" aria-labelledby="pick-title">
  <div class="page-hero-copy">
    <p class="eyebrow">${esc(pick.data.competition)}</p>
    <h1 id="pick-title">${esc(pick.data.match)}</h1>
    <p class="standfirst">${esc(selectionLabel(pick.frozen))} · kicks off ${esc(parts.date)}, ${esc(parts.time)} UTC.</p>
  </div>
  <aside class="panel summary-card" aria-label="Verdict">
    <div class="panel-title"><h2>Verdict</h2><a href="#chain">Chain →</a></div>
    <p style="margin:0 0 10px">${outcomePill(current)}</p>
    ${verdictList}
    <p class="summary-note">Graded by the frozen Settlement Rules v1 engine — never by hand.</p>
  </aside>
</section>

<section class="panel section-panel section-gap" aria-label="The pick, as published">
  <div class="section-heading"><div><h2>The pick, as published</h2><p>Frozen at the exact PR version that passed the two-hour gate</p></div></div>
  <dl class="facts">
    <dt>Pick ID</dt><dd><code>${esc(pick.id)}</code></dd>
    <dt>Kickoff (UTC)</dt><dd>${esc(pick.kickoffUtc.replace("T", " ").replace("Z", " UTC"))}</dd>
    <dt>Selection</dt><dd>${esc(selectionLabel(pick.frozen))} <small>(Asian handicap)</small></dd>
    <dt>Published price</dt><dd>${esc(pick.data.published_price)} ${esc(priceFormat)} <small>→</small> ${esc(pick.frozen.normalized_decimal_price)} decimal</dd>
    <dt>Price source</dt><dd>${esc(pick.data.price_source)}</dd>
    <dt>Ledger file</dt><dd><code>${esc(pick.path)}</code> <small>(SHA-256 <code>${esc(sha256File(pick.absolutePath).slice(0, 16))}…</code>)</small></dd>
  </dl>
</section>

<section class="record-grid">
  <article id="chain" class="panel section-panel" aria-label="Result and correction chain">
    <div class="section-heading"><div><h2>Result &amp; correction chain</h2><p>Append-only: a correction cites the SHA-256 of what it corrects</p></div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Revision</th><th>Result file</th><th>SHA-256</th><th>Outcome</th><th class="num">Net return</th></tr></thead>
        <tbody>
${chainRows}
        </tbody>
      </table>
    </div>
  </article>

  <article class="panel section-panel" aria-label="Component settlement">
    <div class="section-heading"><div><h2>How the handicap splits</h2><p>Quarter lines settle as two half-stakes</p></div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Split line</th><th>Result</th></tr></thead>
        <tbody>
${components}
        </tbody>
      </table>
    </div>
  </article>
</section>
`, "track-record.html", "../", window, `picks/${pick.id}.html`, inFormalWindow(pick, window) ? null : "noindex,follow");
}

export function buildSite(root, window = loadFormalWindow(root)) {
  window = validateFormalWindow(window);
  const { picks, settlements } = buildSettlements(root);
  const standings = buildStandings(root);
  const orderedPicks = [...picks.values()].sort((left, right) =>
    left.kickoffEpoch - right.kickoffEpoch || left.id.localeCompare(right.id));

  const dist = join(root, "site-dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, "picks"), { recursive: true });
  mkdirSync(join(dist, "feeds"), { recursive: true });

  writeFileSync(join(dist, "index.html"), buildIndexPage(orderedPicks, settlements, standings, window));
  writeFileSync(join(dist, "track-record.html"), buildTrackRecordPage(orderedPicks, settlements, standings, window));
  writeFileSync(join(dist, "verification.html"), buildVerificationPage(window));
  for (const pick of orderedPicks) {
    writeFileSync(join(dist, "picks", `${pick.id}.html`), buildPickPage(pick, settlements.get(pick.id), window));
  }

  // Public distribution interfaces and search/share infrastructure (Gate O3).
  // All generated one-way from the same ledger state, all deterministic.
  writeFileSync(join(dist, "feeds", "picks.xml"), buildPicksFeed(orderedPicks, settlements, window));
  writeFileSync(join(dist, "feeds", "results.xml"), buildResultsFeed(orderedPicks, settlements, window));
  writeFileSync(join(dist, "sitemap.xml"), buildSitemap(orderedPicks, window));
  writeFileSync(join(dist, "robots.txt"), buildRobots());
  writeFileSync(join(dist, "404.html"), build404Page());
  writeFileSync(join(dist, "favicon.svg"), FAVICON_SVG);
  writeFileSync(join(dist, "og-image.png"), renderOgImagePng());

  console.log(`site built: ${orderedPicks.length} picks, ${standings.n} counted`);
}

if (isMainScript(import.meta.url)) buildSite(REPO_ROOT);
