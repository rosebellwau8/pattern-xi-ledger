#!/usr/bin/env node
// Builds the static public site into site-dist/. Pure Node, no framework, no
// client JavaScript, no network, no webfonts. Output is deterministic: the
// same ledger state always produces byte-identical pages, which is what lets
// CI enforce that the committed site is current.
//
// All copy is English (en-GB): the site faces a UK audience.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isMainScript, REPO_ROOT, sha256File } from "./lib.mjs";
import { buildSettlements } from "./settle.mjs";
import { buildStandings } from "./standings.mjs";

const REPO_URL = "https://github.com/rosebellwau8/pattern-xi-ledger";

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
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STYLE = `
  :root {
    color-scheme: light dark;
    --paper: #f5f3ec;
    --card: #fffefb;
    --ink: #21241f;
    --muted: #676c60;
    --faint: #8d927f;
    --accent: #1c5a38;
    --link: #15583a;
    --hair: #e3ddcd;
    --hair-strong: #ccc5b0;
    --code-bg: #f0ede2;
    --cell-bg: #eeebe0;
    --win-bg: #e2efe4; --win-ink: #1d5c31;
    --loss-bg: #f6e1de; --loss-ink: #9c2f28;
    --push-bg: #ebe8dc; --push-ink: #5c6055;
    --pend-bg: #f5e9cd; --pend-ink: #82600f;
    --banner-bg: #5c4610; --banner-ink: #fdf7e3;
    --curve-line: #1c5a38; --curve-area: rgba(28, 90, 56, 0.12);
    --curve-grid: #d8d2c0; --curve-text: #676c60;
    --serif: Charter, "Iowan Old Style", "Palatino Linotype", Georgia, serif;
    --sans: Aptos, "Gill Sans", "Trebuchet MS", sans-serif;
    --mono: ui-monospace, "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #161814;
      --card: #1d201b;
      --ink: #e9e6da;
      --muted: #a4a897;
      --faint: #7d8172;
      --accent: #8bc9a4;
      --link: #93cfab;
      --hair: #31352b;
      --hair-strong: #41453a;
      --code-bg: #232720;
      --cell-bg: #252922;
      --win-bg: #1f3527; --win-ink: #a6d9b4;
      --loss-bg: #3b2622; --loss-ink: #e6a59e;
      --push-bg: #2b2e26; --push-ink: #b4b8a9;
      --pend-bg: #38301a; --pend-ink: #dfc383;
      --banner-bg: #3d341a; --banner-ink: #e8d9a9;
      --curve-line: #8bc9a4; --curve-area: rgba(139, 201, 164, 0.14);
      --curve-grid: #343830; --curve-text: #a4a897;
    }
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 1rem;
    line-height: 1.6;
    -webkit-text-size-adjust: 100%;
  }
  ::selection { background: var(--curve-area); }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; text-underline-offset: 3px; }
  a:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; border-radius: 2px; }
  .skip-link {
    position: fixed; left: 1rem; top: 1rem; z-index: 20; transform: translateY(-180%);
    background: var(--ink); color: var(--paper); padding: 0.55rem 0.8rem; font-weight: 700;
  }
  .skip-link:focus { transform: translateY(0); }
  code, pre, .mono { font-family: var(--mono); }
  code { font-size: 0.85em; background: var(--code-bg); border-radius: 4px; padding: 0.08em 0.35em; }
  pre {
    margin: 0.6rem 0 0;
    background: var(--code-bg);
    border: 1px solid var(--hair);
    border-radius: 8px;
    padding: 0.9rem 1.1rem;
    overflow-x: auto;
    font-size: 0.84rem;
    line-height: 1.55;
  }
  pre code { background: none; padding: 0; font-size: 1em; }
  .wrap { max-width: 72rem; margin: 0 auto; padding: 0 1.25rem; }
  .num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

  /* ---- top bar & masthead ------------------------------------------ */
  .topbar { border-bottom: 1px solid var(--hair); font-size: 0.72rem; }
  .topbar-in {
    display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
    padding-top: 0.45rem; padding-bottom: 0.45rem;
    text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted);
  }
  .topbar a { color: var(--muted); }
  .topbar a:hover { color: var(--link); }
  .masthead { border-bottom: 3px solid var(--ink); position: relative; }
  .masthead::after {
    content: ""; display: block; position: absolute; left: 0; right: 0; bottom: -6px;
    border-bottom: 1px solid var(--ink);
  }
  .masthead-in {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 1rem; flex-wrap: wrap; padding-top: 1.6rem; padding-bottom: 0.5rem;
  }
  .wordmark {
    font-family: var(--serif); font-weight: 700; font-size: 2rem;
    letter-spacing: 0.01em; color: var(--ink); line-height: 1.1;
  }
  .wordmark em { color: var(--accent); font-style: italic; }
  .wordmark:hover { text-decoration: none; }
  .tagline { margin: 0; font-family: var(--serif); font-style: italic; color: var(--muted); font-size: 1.02rem; }
  .nav { display: flex; gap: 1.4rem; flex-wrap: wrap; padding-top: 0.7rem; padding-bottom: 0.8rem; }
  .nav a {
    text-transform: uppercase; letter-spacing: 0.09em; font-size: 0.78rem;
    font-weight: 600; color: var(--muted); padding-bottom: 2px;
  }
  .nav a:hover { color: var(--link); text-decoration: none; }
  .nav a[aria-current="page"] { color: var(--accent); border-bottom: 2px solid var(--accent); }
  .banner {
    margin-top: 7px; background: var(--banner-bg); color: var(--banner-ink);
    font-size: 0.84rem; font-weight: 600; letter-spacing: 0.02em;
  }
  .banner .wrap { padding-top: 0.5rem; padding-bottom: 0.5rem; }

  main { padding-top: 2.4rem; padding-bottom: 4rem; }
  section { margin-top: 2.6rem; }
  section:first-of-type { margin-top: 0; }
  h2 {
    font-family: var(--serif); font-size: 1.35rem; margin: 0 0 0.9rem;
    line-height: 1.25;
  }
  h2 .more { font-family: var(--sans); font-size: 0.8rem; font-weight: 600; float: right; margin-top: 0.45rem; }
  .eyebrow {
    text-transform: uppercase; letter-spacing: 0.16em; font-size: 0.72rem;
    font-weight: 700; color: var(--accent); margin: 0 0 0.7rem;
  }
  .standfirst {
    font-family: var(--serif); font-style: italic; color: var(--muted);
    font-size: 1.12rem; line-height: 1.55; margin: 0.8rem 0 0; max-width: 46rem;
  }

  /* ---- hero --------------------------------------------------------- */
  .hero h1 {
    font-family: var(--serif); font-size: clamp(2.1rem, 5vw, 3.3rem);
    line-height: 1.08; margin: 0; letter-spacing: -0.01em; max-width: 40rem;
  }
  .cta { display: flex; gap: 0.7rem; flex-wrap: wrap; margin: 1.6rem 0 0; }
  .btn {
    display: inline-block; padding: 0.55rem 1.1rem; border-radius: 999px;
    font-size: 0.86rem; font-weight: 600; border: 1px solid var(--hair-strong);
    color: var(--ink);
  }
  .btn:hover { text-decoration: none; border-color: var(--accent); color: var(--link); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #f4f2e9; }
  @media (prefers-color-scheme: dark) { .btn.primary { color: #10130f; } }
  .btn.primary:hover { filter: brightness(1.08); color: #f4f2e9; }

  /* ---- cards, pillars, metrics -------------------------------------- */
  .card {
    background: var(--card); border: 1px solid var(--hair); border-radius: 10px;
    padding: 1.3rem 1.5rem 1.4rem;
  }
  .pillars { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.9rem; }
  .pillar { margin: 0; }
  .pillar h3 {
    font-family: var(--serif); font-size: 1.08rem; margin: 0 0 0.45rem;
    display: flex; align-items: baseline; gap: 0.55rem;
  }
  .pillar h3 .k {
    font-family: var(--sans); font-size: 0.7rem; font-weight: 700; color: var(--accent);
    letter-spacing: 0.08em;
  }
  .pillar p { margin: 0; font-size: 0.9rem; color: var(--muted); line-height: 1.55; }
  dl.metrics {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 0.7rem; margin: 0;
  }
  @media (max-width: 40rem) { dl.metrics { grid-template-columns: repeat(2, 1fr); } }
  dl.metrics div { background: var(--cell-bg); border-radius: 8px; padding: 0.65rem 0.85rem 0.75rem; }
  dl.metrics dt {
    font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.09em;
    color: var(--muted); margin: 0;
  }
  dl.metrics dd {
    margin: 0.2rem 0 0; font-size: 1.45rem; font-weight: 650;
    font-variant-numeric: tabular-nums; line-height: 1.2;
  }
  dl.metrics dd small { font-size: 0.85rem; font-weight: 500; color: var(--muted); }
  .fineprint { margin: 0.8rem 0 0; font-size: 0.78rem; color: var(--faint); line-height: 1.55; }

  /* ---- market board ------------------------------------------------- */
  .market-board { display: grid; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); gap: 0.9rem; }
  .pick-ticket {
    position: relative; overflow: hidden; background: var(--card); border: 1px solid var(--hair-strong);
    border-top: 4px solid var(--accent); padding: 1.15rem 1.2rem 1.2rem;
    box-shadow: 0 10px 30px rgba(35, 38, 29, 0.06);
  }
  .pick-ticket::after {
    content: "XI"; position: absolute; right: -0.15rem; bottom: -1.3rem;
    font-family: var(--serif); font-style: italic; font-weight: 700; font-size: 5.2rem;
    color: color-mix(in srgb, var(--accent) 7%, transparent); pointer-events: none;
  }
  .ticket-meta { display: flex; justify-content: space-between; gap: 0.8rem; color: var(--muted); font-size: 0.72rem; letter-spacing: 0.07em; text-transform: uppercase; }
  .pick-ticket h3 { position: relative; margin: 0.8rem 0 1rem; font-family: var(--serif); font-size: 1.22rem; line-height: 1.25; }
  .pick-ticket h3 a { color: var(--ink); }
  .market-line { position: relative; display: grid; grid-template-columns: 1.4fr 1fr 1fr; margin: 0; border-top: 1px solid var(--hair); }
  .market-line div { padding: 0.6rem 0.45rem 0 0; }
  .market-line dt { color: var(--muted); font-size: 0.65rem; letter-spacing: 0.08em; text-transform: uppercase; }
  .market-line dd { margin: 0.08rem 0 0; font-size: 1.05rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .market-line div:first-child dd { color: var(--accent); }
  @media (max-width: 24rem) { .market-line { grid-template-columns: 1fr 1fr; } }

  /* ---- tables -------------------------------------------------------- */
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  caption { text-align: left; font-family: var(--serif); font-size: 1.05rem; padding: 0.2rem 0 0.7rem; }
  th {
    text-align: left; font-size: 0.68rem; text-transform: uppercase;
    letter-spacing: 0.09em; color: var(--muted); font-weight: 700;
    padding: 0.45rem 0.65rem; border-bottom: 2px solid var(--hair-strong); white-space: nowrap;
  }
  td { padding: 0.55rem 0.65rem; border-bottom: 1px solid var(--hair); vertical-align: top; }
  tbody tr:hover { background: color-mix(in srgb, var(--hair) 45%, transparent); }
  td small { color: var(--muted); }
  td.kick { white-space: nowrap; }
  td.match a { font-weight: 600; }

  /* ---- outcome pills & chips ------------------------------------------ */
  .pill {
    display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 999px;
    padding: 0.12rem 0.6rem 0.14rem; font-size: 0.76rem; font-weight: 650;
    white-space: nowrap;
  }
  .pill::before { content: ""; width: 0.4rem; height: 0.4rem; border-radius: 50%; background: currentColor; }
  .pill.win { background: var(--win-bg); color: var(--win-ink); }
  .pill.loss { background: var(--loss-bg); color: var(--loss-ink); }
  .pill.push { background: var(--push-bg); color: var(--push-ink); }
  .pill.pend { background: var(--pend-bg); color: var(--pend-ink); }
  .chips { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.2rem 0 0; }
  .chip {
    border: 1px solid color-mix(in srgb, var(--muted) 45%, transparent);
    border-radius: 999px; padding: 0.14rem 0.7rem;
    font-size: 0.78rem; color: var(--muted); background: var(--card);
  }
  .chip b { color: var(--ink); font-variant-numeric: tabular-nums; }

  /* ---- equity curve ---------------------------------------------------- */
  .curve-svg { display: block; width: 100%; height: auto; }
  .curve-note { margin: 0.6rem 0 0; font-size: 0.78rem; color: var(--faint); }
  .empty { color: var(--muted); font-style: italic; margin: 0; }

  /* ---- verification steps ------------------------------------------------ */
  ol.steps { list-style: none; margin: 0; padding: 0; counter-reset: step; }
  ol.steps li { counter-increment: step; padding: 0 0 1.6rem 2.6rem; position: relative; }
  ol.steps li:last-child { padding-bottom: 0.2rem; }
  ol.steps li::before {
    content: counter(step); position: absolute; left: 0; top: -0.15rem;
    font-family: var(--serif); font-size: 1.5rem; font-weight: 700; color: var(--accent);
    line-height: 1.4;
  }
  ol.steps h3 { font-family: var(--serif); font-size: 1.05rem; margin: 0 0 0.3rem; }
  ol.steps p { margin: 0; font-size: 0.9rem; color: var(--muted); }

  /* ---- pick detail --------------------------------------------------------- */
  .back { font-size: 0.82rem; font-weight: 600; }
  dl.facts {
    display: grid; grid-template-columns: minmax(9rem, 13rem) 1fr; gap: 0;
    margin: 0; font-size: 0.92rem;
  }
  dl.facts dt {
    padding: 0.5rem 0.65rem; border-bottom: 1px solid var(--hair);
    font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.09em;
    color: var(--muted); font-weight: 700;
  }
  dl.facts dd { margin: 0; padding: 0.5rem 0.65rem; border-bottom: 1px solid var(--hair); }
  dl.facts dt:last-of-type, dl.facts dd:last-of-type { border-bottom: none; }
  dl.facts dd code { word-break: break-all; }
  @media (max-width: 40rem) {
    dl.facts { grid-template-columns: 1fr; }
    dl.facts dt { border-bottom: none; padding-bottom: 0; }
    dl.facts dd { padding-top: 0.1rem; }
  }
  .verdict { display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap; margin: 0; }
  .verdict .net { font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; }

  /* ---- footer ----------------------------------------------------------- */
  footer.site { border-top: 3px double var(--hair-strong); margin-top: 1rem; }
  footer.site .wrap {
    padding-top: 1.4rem; padding-bottom: 3rem; font-size: 0.78rem;
    color: var(--faint); line-height: 1.6;
  }
  footer.site b { color: var(--muted); }
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
    time: `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`,
    month: `${MONTHS_FULL[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
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

function page(title, description, body, activeNav, prefix = "") {
  const nav = [
    ["index.html", "Overview"],
    ["track-record.html", "Full record"],
    ["verification.html", "Verify it yourself"],
  ].map(([href, label]) =>
    `<a href="${prefix}${href}"${href === activeNav ? ' aria-current="page"' : ""}>${label}</a>`).join("\n      ");
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="${esc(description)}">
<title>${esc(title)} · Pattern XI</title>
<style>${STYLE}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="topbar"><div class="wrap topbar-in">
  <span>A public · prospective · auditable ledger</span>
  <a href="${REPO_URL}">GitHub repository ↗</a>
</div></div>
<header class="masthead"><div class="wrap">
  <div class="masthead-in">
    <a class="wordmark" href="${prefix}index.html">Pattern <em>XI</em></a>
    <p class="tagline">Exact picks. Public witnesses. Auditable history.</p>
  </div>
  <nav class="nav" aria-label="Site">
      ${nav}
  </nav>
</div></header>
<div class="banner" role="note"><div class="wrap">SHADOW RUN — trial operation. Picks made in this phase do not count towards the formal 90-day public verification window.</div></div>
<main id="main" class="wrap">
${body}
</main>
<footer class="site"><div class="wrap">
  <b>Pattern XI</b> — a public, prospective, auditable football picks ledger.
  Settlement mathematics is frozen under Settlement Rules v1 and guarded by a 52-case golden-dataset regression in CI.
  This site is generated deterministically from the ledger: no server, no tracking, no client-side scripts.
  <a href="${REPO_URL}">Read the ledger itself ↗</a>
</div></footer>
</body>
</html>
`;
}

// Display-only cosmetic: exact strings keep their trailing zeros everywhere
// they are audit handles; headline figures read better trimmed.
function trimZeros(value) {
  if (value === null || value === undefined) return "—";
  const text = String(value);
  return text.includes(".") ? text.replace(/0+$/u, "").replace(/\.$/u, "") : text;
}

function metricsGrid(standings) {
  const roi = standings.roi_percent === null ? "—" : `${esc(trimZeros(standings.roi_percent))}%`;
  const avg = standings.average_decimal_price === null ? "—" : esc(trimZeros(standings.average_decimal_price));
  return `<dl class="metrics">
  <div><dt>Settled picks <small>(voids excluded)</small></dt><dd>${standings.n}</dd></div>
  <div><dt>Net return <small>(unit stakes)</small></dt><dd>${esc(fmtNet(standings.total_net_return))}</dd></div>
  <div><dt>Return on turnover</dt><dd>${roi}</dd></div>
  <div><dt>Average price</dt><dd>${avg}</dd></div>
  <div><dt>Max drawdown</dt><dd>${esc(fmtDrawdown(standings.maximum_drawdown))}</dd></div>
  <div><dt>Pending / void</dt><dd>${standings.pending_count} <small>/</small> ${standings.void_count}</dd></div>
</dl>`;
}

function tallyChips(counts) {
  return ["WIN", "HALF_WIN", "PUSH", "HALF_LOSS", "LOSS"]
    .map((key) => `<span class="chip">${OUTCOME_EN[key]} <b>${counts[key] ?? 0}</b></span>`)
    .join("");
}

function pickRow(pick, settlement, prefix = "") {
  const current = settlement?.current;
  const parts = kickoffParts(pick.kickoffUtc);
  return `  <tr>
    <td class="match"><a href="${prefix}picks/${esc(pick.id)}.html">${esc(pick.data.match)}</a><br><small>${esc(pick.data.competition)}</small></td>
    <td>${esc(selectionLabel(pick.frozen))}</td>
    <td class="kick">${esc(parts.date)} <small>· ${esc(parts.time)}</small></td>
    <td>${outcomePill(current)}</td>
    <td class="num">${current === undefined || current.net_return === null ? "—" : esc(fmtNet(current.net_return))}</td>
  </tr>`;
}

function picksTable(picks, settlements, prefix = "") {
  return `<div class="table-wrap">
<table>
  <thead><tr><th>Match</th><th>Selection</th><th>Kickoff (UTC)</th><th>Outcome</th><th class="num">Net return</th></tr></thead>
<tbody>
${picks.map((pick) => pickRow(pick, settlements.get(pick.id), prefix)).join("\n")}
</tbody>
</table>
</div>`;
}

function pickTicket(pick) {
  const parts = kickoffParts(pick.kickoffUtc);
  const priceLabel = pick.data.published_price_format === "HONG_KONG_ODDS" ? "HK price" : "Decimal price";
  return `<article class="pick-ticket">
  <div class="ticket-meta"><span>${esc(pick.data.competition)}</span><time datetime="${esc(pick.kickoffUtc)}">${esc(parts.date)} · ${esc(parts.time)}</time></div>
  <h3><a href="picks/${esc(pick.id)}.html">${esc(pick.data.match)}</a></h3>
  <dl class="market-line">
    <div><dt>Selection</dt><dd>${esc(sideLabel(pick.frozen))}</dd></div>
    <div><dt>Handicap</dt><dd>${esc(handicapLabel(pick.frozen))}</dd></div>
    <div><dt>${esc(priceLabel)}</dt><dd>${esc(pick.data.published_price)}</dd></div>
  </dl>
  <p class="fineprint">Decimal equivalent ${esc(pick.frozen.normalized_decimal_price)} · ${esc(pick.data.price_source)}</p>
</article>`;
}

const EMPTY_TABLE = `<p class="empty">No picks yet. A pick becomes public in an exact PR commit and must pass its GitHub-hosted two-hour check before it can enter the formal ledger.</p>`;

function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / power;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return nice * power;
}

function tickLabel(value) {
  return String(Number((Math.round(value * 100) / 100).toFixed(2)));
}

// Deterministic inline SVG of the exact cumulative net return. No client-side
// chart library: the geometry is computed at build time from the projection.
function equityCurveSvg(curve) {
  if (curve.length < 2) {
    return `<p class="empty">The equity curve begins once two picks have settled.</p>`;
  }
  const width = 760;
  const height = 280;
  const left = 50;
  const right = 20;
  const top = 24;
  const bottom = 36;
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
  const x = (index) => left + (index / (curve.length - 1)) * (width - left - right);
  const y = (value) => top + ((hi - value) / (hi - lo)) * (height - top - bottom);
  const points = values.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`);
  const line = `M${points.join("L")}`;
  const zeroY = y(0).toFixed(2);
  const area = `${line}L${x(curve.length - 1).toFixed(2)},${zeroY}L${x(0).toFixed(2)},${zeroY}Z`;

  const step = niceStep((hi - lo) / 3.2);
  const halo = `paint-order="stroke" stroke="var(--card)" stroke-width="4" stroke-linejoin="round"`;
  const plotBottom = height - bottom;
  const ticks = [];
  for (let value = Math.ceil(lo / step) * step; value <= hi; value += step) {
    const vy = y(value);
    if (Math.abs(vy - y(0)) < 5) continue;
    ticks.push(`<line x1="${left}" y1="${vy.toFixed(2)}" x2="${width - right}" y2="${vy.toFixed(2)}" stroke="var(--curve-grid)" stroke-width="1"/><text x="${left - 8}" y="${(vy + 3.5).toFixed(2)}" text-anchor="end" font-size="11" fill="var(--curve-text)" font-family="var(--sans)" ${halo}>${esc(tickLabel(value))}</text>`);
  }

  const last = curve[curve.length - 1];
  const lastX = x(curve.length - 1);
  const lastY = y(values[values.length - 1]);
  const aboveZero = values[values.length - 1] >= 0;
  const labelY = aboveZero ? Math.max(lastY - 10, top + 10) : Math.min(lastY + 18, plotBottom - 6);
  const labelX = Math.max(left + 6, Math.min(lastX - 8, width - right - 74));
  const first = kickoffParts(curve[0].kickoff_utc);
  const lastKick = kickoffParts(last.kickoff_utc);
  const finalText = `final ${fmtNet(last.cumulative_net_return)}`;

  return `<svg class="curve-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative net return curve, currently ${esc(fmtNet(last.cumulative_net_return))} unit stakes">
  <path d="${area}" fill="var(--curve-area)"/>
  ${ticks.join("\n  ")}
  <line x1="${left}" y1="${zeroY}" x2="${width - right}" y2="${zeroY}" stroke="var(--curve-text)" stroke-width="1" stroke-dasharray="2 4"/>
  <text x="${left - 8}" y="${(Number(zeroY) + 3.5).toFixed(2)}" text-anchor="end" font-size="11" fill="var(--curve-text)" font-family="var(--sans)" ${halo}>0</text>
  <line x1="${left}" y1="${plotBottom}" x2="${width - right}" y2="${plotBottom}" stroke="var(--hair-strong)" stroke-width="1"/>
  <path d="${line}" fill="none" stroke="var(--curve-line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(2)}" r="3.5" fill="var(--curve-line)"/>
  <text x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="end" font-size="12" font-weight="600" fill="var(--curve-line)" font-family="var(--sans)" ${halo}>${esc(finalText)}</text>
  <text x="${left}" y="${height - 10}" font-size="11" fill="var(--curve-text)" font-family="var(--sans)" ${halo}>${esc(first.date)}</text>
  <text x="${width - right}" y="${height - 10}" text-anchor="end" font-size="11" fill="var(--curve-text)" font-family="var(--sans)" ${halo}>${esc(lastKick.date)}</text>
</svg>`;
}

function buildIndexPage(orderedPicks, settlements, standings) {
  const upcoming = orderedPicks
    .filter((pick) => settlements.get(pick.id)?.current.record_state !== "SETTLED")
    .slice(0, 12);
  const moreLink = orderedPicks.length > upcoming.length
    ? `<a class="more" href="track-record.html">All ${orderedPicks.length} picks →</a>`
    : "";
  return page("Overview",
    "Pattern XI is a public football picks ledger with an exact-commit publication witness, complete-state Bitcoin timestamps and append-only correction provenance.",
    `
<section class="hero">
  <p class="eyebrow">Independent Asian handicap ledger</p>
  <h1>The line. The price. The public record.</h1>
  <p class="standfirst">Every selection appears in public before kickoff, then stays on the record. No previews, no hidden model notes — just the final side, handicap and published price.</p>
  <p class="cta">
    <a class="btn primary" href="#upcoming">See the picks</a>
    <a class="btn" href="track-record.html">Read the full record</a>
  </p>
</section>

<section id="upcoming" aria-label="Upcoming picks">
  <h2>Upcoming picks${moreLink}</h2>
  ${upcoming.length === 0 ? EMPTY_TABLE : `<div class="market-board">${upcoming.map(pickTicket).join("\n")}</div>`}
</section>

<section aria-label="Performance snapshot">
  <div class="card">
    <h2>Performance snapshot</h2>
    ${metricsGrid(standings)}
    <p class="fineprint">Unit stake 1. Net returns use exact decimal arithmetic; void matches are excluded from N. Every figure is rebuilt from the public ledger, never typed by hand.</p>
  </div>
</section>

<section aria-label="Three-layer evidence model">
  <h2>Three-layer evidence model</h2>
  <div class="pillars">
    <article class="card pillar">
      <h3><span class="k">01</span>Public publication witness</h3>
      <p>A public PR exposes the exact PR commit. A successful GitHub-hosted <em>Ledger integrity</em> job records its server-side start time and requires at least two hours before kickoff. A changed pick has a new SHA and must pass again; merge only admits that same checked version to the formal ledger.</p>
    </article>
    <article class="card pillar">
      <h3><span class="k">02</span>Independent cryptographic timestamp</h3>
      <p>Each nightly manifest names the exact main commit and hashes every pick in the complete ledger state. Chained manifests are stamped through OpenTimestamps and published on <code>anchors</code>.</p>
    </article>
    <article class="card pillar">
      <h3><span class="k">03</span>Append-only correction provenance</h3>
      <p>CI rejects overwrites of published inputs. Corrections append a new revision linked to the exact prior bytes; settlement and standings are rebuilt deterministically. Together, the layers are designed to make retrospective alteration detectable.</p>
    </article>
  </div>
</section>
`, "index.html");
}

function buildTrackRecordPage(orderedPicks, settlements, standings) {
  // Newest first: the record reads like a ledger, but visitors scan for recent form.
  const descending = [...orderedPicks].reverse();
  const groups = new Map();
  for (const pick of descending) {
    const month = kickoffParts(pick.kickoffUtc).month;
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(pick);
  }
  const monthSections = [...groups.entries()]
    .map(([month, picks]) => `
<section aria-label="${esc(month)}">
  <h2>${esc(month)}</h2>
  ${picksTable(picks, settlements)}
</section>`)
    .join("\n");

  return page("Full record",
    "Every pick Pattern XI has ever published, winners and losers alike — generated straight from the public Git ledger.",
    `
<section class="hero">
  <p class="eyebrow">Track record</p>
  <h1>Every pick, winners and losers alike</h1>
  <p class="standfirst">Authoritative inputs follow append-only rules and corrections remain visible. The tables below are generated straight from the ledger; the curve is the exact cumulative net return, unit stake by unit stake.</p>
</section>

<section aria-label="Cumulative net return">
  <div class="card">
    <h2>Cumulative net return</h2>
    ${equityCurveSvg(standings.cumulative_return_curve)}
    <p class="curve-note">Exact-decimal cumulative net return after each settled pick, in unit stakes. Dashed line marks break-even. Rendered at build time from <code>standings/standings.json</code>.</p>
  </div>
</section>

<section aria-label="Record at a glance">
  <h2>Record at a glance</h2>
  ${metricsGrid(standings)}
  <div class="chips" style="margin-top:0.9rem">${tallyChips(standings.classification_counts)}</div>
  <p class="fineprint">Listed newest first. Each pick links to its own page with the frozen price, the result chain and the component-by-component settlement.</p>
</section>
${monthSections || `
<section>
  <p class="empty">The ledger is empty. The first pick will start the record — and it will stay here, whatever it settles as.</p>
</section>`}
`, "track-record.html");
}

function buildVerificationPage() {
  const code = (text) => `<pre><code>${esc(text)}</code></pre>`;
  return page("Verify it yourself",
    "Verify the exact-commit public PR witness, full-state Bitcoin timestamp and deterministic rebuild of the Pattern XI ledger.",
    `
<section class="hero">
  <p class="eyebrow">Verification</p>
  <h1>Trust, but verify</h1>
  <p class="standfirst">This site has no database and no back office — it is static HTML generated from a public Git repository. Every claim it makes can be checked from your own machine, with the tools you already have.</p>
</section>

<section aria-label="Five-minute verification">
  <div class="card">
    <h2>Five minutes, four commands</h2>
    <ol class="steps">
      <li>
        <h3>Clone the repository</h3>
        <p>The ledger is the repository — the site is merely a view of it.</p>
        ${code(`git clone ${REPO_URL}.git\ncd pattern-xi-ledger`)}
      </li>
      <li>
        <h3>Verify the public publication witness</h3>
        <p>Find the public PR head commit that introduced the pick. The earliest successful <em>Ledger integrity</em> job for that exact head SHA is the witness: its GitHub server-side <code>startedAt</code> must be at least two hours before kickoff. If the pick changes, its SHA changes and the check must run again. Merge merely admits the same checked version to the formal ledger.</p>
        ${code(`git log --all --diff-filter=A --format=%H -- picks/2026/<pick-file>.json\ngh run list --event pull_request --commit <head-sha> --workflow Check --status success --json databaseId,headSha,event,conclusion,url\ngh run view <run-id> --json headSha,jobs`)}
      </li>
      <li>
        <h3>Inspect a full ledger-state snapshot</h3>
        <p>Every manifest names one exact <code>main</code> commit, lists the SHA-256 of every formal pick in that complete ledger state, and links to the previous manifest bytes.</p>
        ${code(`git switch anchors\ncat manifests/<date>.txt\ngit show <main-commit-sha>:picks/2026/<pick-file>.json | sha256sum`)}
      </li>
      <li>
        <h3>Verify the independent cryptographic timestamp</h3>
        <p>OpenTimestamps proves that the full ledger-state snapshot existed before its Bitcoin time anchor. It is a second layer for detecting later historical alteration, not the primary two-hour publication witness for each pick.</p>
        ${code(`pip install opentimestamps-client\nots verify manifests/<date>.txt.ots`)}
      </li>
      <li>
        <h3>Rebuild the entire record</h3>
        <p>Recompute every settlement and the whole track record from the raw picks and results. If the rebuilt output differs from what is committed, the alarm is loud and immediate.</p>
        ${code(`node scripts/settle.mjs && node scripts/standings.mjs && git diff --exit-code`)}
      </li>
    </ol>
  </div>
</section>

<section aria-label="What this proves">
  <div class="card">
    <h2>What this proves — and what it does not</h2>
    <p style="margin:0 0 0.8rem"><strong>Public publication witness:</strong> a public PR and successful GitHub Actions check show that the exact final head SHA passed the two-hour rule at the job's server-side start time. <strong>Independent cryptographic timestamp:</strong> a Bitcoin-stamped, full ledger-state snapshot establishes that state existed before the anchor time. <strong>Append-only correction provenance:</strong> validation rules and hash-linked revisions make changes conspicuous and reproducible.</p>
    <p style="margin:0 0 0.8rem">Published history is designed to make retrospective alteration detectable. Bitcoin-anchored manifests provide an independent cryptographic record of previously published ledger states. Repository owners still control GitHub settings, so this does not make GitHub history cryptographically immutable; branch protection and public history greatly raise the cost and visibility of interference.</p>
    <p style="margin:0">Scores and prices remain operator-entered facts and are not independently verified here. Settlement maths is frozen under Settlement Rules v1 and guarded by a 52-case golden-dataset regression. The static design has greatly reduced the operational attack surface, but it still depends on the GitHub account, Actions, Pages and OpenTimestamps.</p>
  </div>
</section>
`, "verification.html");
}

function buildPickPage(pick, settlement) {
  const parts = kickoffParts(pick.kickoffUtc);
  const chain = settlement?.revisions ?? [];
  const chainRows = chain.length === 0
    ? `<p class="empty">No result recorded yet.</p>`
    : `<div class="table-wrap">
<table>
  <thead><tr><th>Revision</th><th>Result file</th><th>SHA-256</th><th>Outcome</th><th class="num">Net return</th></tr></thead>
<tbody>
${chain.map((revision) => `  <tr>
    <td>r${revision.revision}</td>
    <td><code>${esc(revision.result_file)}</code></td>
    <td><code>${esc(revision.result_file_sha256.slice(0, 16))}…</code></td>
    <td>${outcomePill(revision.result)}</td>
    <td class="num">${revision.result.net_return === null ? "—" : esc(fmtNet(revision.result.net_return))}</td>
  </tr>`).join("\n")}
</tbody>
</table>
</div>`;

  const current = settlement?.current;
  const components = chain.length === 0 || current?.record_state === "PENDING"
    ? `<p class="empty">Component settlement appears once the match settles.</p>`
    : `<div class="table-wrap">
<table>
  <thead><tr><th>Split line</th><th>Result</th></tr></thead>
<tbody>
${settlement.revisions[settlement.revisions.length - 1].result.components
      .map((component) => `  <tr>
    <td>${esc(component.line.startsWith("-") ? `−${component.line.slice(1)}` : component.line)}</td>
    <td><span class="pill ${pillClass(component.result === "WIN" ? "WIN" : component.result === "LOSS" ? "LOSS" : "PUSH")}">${esc(COMPONENT_EN[component.result] ?? component.result)}</span></td>
  </tr>`)
      .join("\n")}
</tbody>
</table>
</div>`;

  const verdict = current === undefined || current.record_state === "PENDING"
    ? `<p class="verdict"><span class="pill pend">${current === undefined ? "Awaiting result" : "Pending"}</span></p>`
    : `<p class="verdict">${outcomePill(current)} <span class="net">${esc(fmtNet(current.net_return))}</span> <small>unit stakes</small></p>`;

  const priceFormat = pick.data.published_price_format === "HONG_KONG_ODDS" ? "Hong Kong" : "decimal";

  return page(pick.data.match,
    `${pick.data.match} — ${selectionLabel(pick.frozen)}, published at least two hours before kickoff in the Pattern XI public ledger.`,
    `
<a class="back" href="../track-record.html">← Full record</a>

<section class="hero" style="margin-top:1.4rem">
  <p class="eyebrow">${esc(pick.data.competition)}</p>
  <h1>${esc(pick.data.match)}</h1>
  <p class="standfirst">${esc(selectionLabel(pick.frozen))} · kicks off ${esc(parts.date)}, ${esc(parts.time)}.</p>
</section>

<section aria-label="Verdict">
  <div class="card">
    <h2>Verdict</h2>
    ${verdict}
  </div>
</section>

<section aria-label="The pick, as published">
  <div class="card">
    <h2>The pick, as published</h2>
    <dl class="facts">
      <dt>Pick ID</dt><dd><code>${esc(pick.id)}</code></dd>
      <dt>Kickoff (UTC)</dt><dd>${esc(pick.kickoffUtc.replace("T", " ").replace("Z", " UTC"))}</dd>
      <dt>Selection</dt><dd>${esc(selectionLabel(pick.frozen))} <small>(Asian handicap)</small></dd>
      <dt>Published price</dt><dd>${esc(pick.data.published_price)} ${esc(priceFormat)} <small>→</small> ${esc(pick.frozen.normalized_decimal_price)} decimal</dd>
      <dt>Price source</dt><dd>${esc(pick.data.price_source)}</dd>
      <dt>Ledger file</dt><dd><code>${esc(pick.path)}</code> <small>(SHA-256 <code>${esc(sha256File(pick.absolutePath).slice(0, 16))}…</code>)</small></dd>
    </dl>
  </div>
</section>

<section aria-label="Result and correction chain">
  <div class="card">
    <h2>Result &amp; correction chain</h2>
    <p class="fineprint" style="margin:0 0 0.8rem">The append-only protocol requires a correction to add a new file citing the SHA-256 of the file it corrects; CI rejects overwriting or deleting an existing authoritative record.</p>
    ${chainRows}
  </div>
</section>

<section aria-label="Component settlement">
  <div class="card">
    <h2>How the handicap splits</h2>
    <p class="fineprint" style="margin:0 0 0.8rem">Quarter lines settle as two half-stakes. Computed by the frozen Settlement Rules v1 engine — never graded by hand.</p>
    ${components}
  </div>
</section>
`, "track-record.html", "../");
}

export function buildSite(root) {
  const { picks, settlements } = buildSettlements(root);
  const standings = buildStandings(root);
  const orderedPicks = [...picks.values()].sort((left, right) =>
    left.kickoffEpoch - right.kickoffEpoch || left.id.localeCompare(right.id));

  const dist = join(root, "site-dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, "picks"), { recursive: true });

  writeFileSync(join(dist, "index.html"), buildIndexPage(orderedPicks, settlements, standings));
  writeFileSync(join(dist, "track-record.html"), buildTrackRecordPage(orderedPicks, settlements, standings));
  writeFileSync(join(dist, "verification.html"), buildVerificationPage());
  for (const pick of orderedPicks) {
    writeFileSync(join(dist, "picks", `${pick.id}.html`), buildPickPage(pick, settlements.get(pick.id)));
  }

  console.log(`site built: ${orderedPicks.length} picks, ${standings.n} counted`);
}

if (isMainScript(import.meta.url)) buildSite(REPO_ROOT);
