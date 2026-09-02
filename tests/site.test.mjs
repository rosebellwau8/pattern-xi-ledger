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

import { buildSite, newsletterSlot } from "../scripts/build-site.mjs";

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

// Unsettled pick whose content needs escaping; the newest kickoff.
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

// Settled full win: home -1.00 at 2.00, finished 2-0.
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

// Settled full loss: away +0.50 at 1.90, finished 1-0 to the home side.
function fixtureLoss(root) {
  const id = "2026-08-30-fixture-cccc3333-ah";
  writeJson(root, `picks/2026/${id}.json`, {
    schema: "pattern-xi.pick.v1",
    id,
    match: "Atlantis FC v Poseidon City",
    competition: "Coastal League",
    kickoff_utc: "2026-08-30T15:00:00Z",
    market: "asian_handicap",
    selection: "AWAY",
    line: "+0.50",
    published_price: "1.90",
    published_price_format: "DECIMAL_ODDS",
    normalized_decimal_price: "1.90",
    price_source: "Pinnacle pre-match",
  });
  writeJson(root, `results/2026/${id}.json`, {
    schema: "pattern-xi.result.v1",
    pick_id: id,
    status: "PLAYED",
    home_score: 1,
    away_score: 0,
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

test("homepage binds the dark dashboard design to ledger data", () => {
  const root = makeLedger();
  try {
    const upcomingId = fixtureUpcoming(root);
    const winId = fixtureWin(root);
    fixtureLoss(root);
    buildSite(root);
    const html = readFileSync(join(root, "site-dist/index.html"), "utf8");

    assert.match(html, /<html lang="en-GB">/u);
    assert.match(html, /<meta name="color-scheme" content="dark">/u);

    // Upcoming table carries the escaped pick content and its own detail link.
    assert.match(html, /Today’s \/ Upcoming Picks <span class="badge">1 pick<\/span>/u);
    assert.match(html, /North &lt;United&gt; v South &amp; City/u);
    assert.doesNotMatch(html, /North <United>/u);
    assert.match(html, new RegExp(`href="picks/${upcomingId}\\.html"`, "u"));
    assert.match(html, /<span class="status await">Awaiting result<\/span>/u);
    assert.match(html, /Asian handicap/u);

    // Official-window panel reads zero during the shadow run, with the note.
    assert.match(html, /90-Day Performance/u);
    assert.match(html, /Official Picks<\/dt><dd>0<\/dd>/u);
    assert.match(html, /Formal 90-day verification has not started\. Shadow-run records are excluded\./u);

    // KPI strip mixes official counts, live ledger counts and fixed facts.
    assert.match(html, /Official Picks<br>Current ledger/u);
    assert.match(html, /<strong>0<\/strong><span>Official Picks<br>Current ledger<\/span>/u);
    assert.match(html, /<strong>2<\/strong><span>Settled Picks<br>Voids excluded<\/span>/u);
    assert.match(html, /Publication Gate<br>GitHub witness/u);
    assert.match(html, /Golden Cases<br>Settlement v1/u);

    // Two settled picks mean the equity curve is rendered for real.
    assert.match(html, /<polyline class="line" points=/u);
    assert.doesNotMatch(html, /The equity curve begins once two picks have settled/u);
    assert.match(html, /Proof of Publication/u);
    assert.match(html, /Full-state manifest/u);
    assert.match(html, /OpenTimestamps anchors the complete state independently\./u);
    assert.ok(html.indexOf("The line. The price.") < html.indexOf("Today’s / Upcoming Picks"));
    assert.ok(html.indexOf("Today’s / Upcoming Picks") < html.indexOf("Proof of Publication"));
    // The settled win never appears in the upcoming list.
    assert.doesNotMatch(html, new RegExp(winId, "u"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("full record page projects standings across summary, chips, curve and table", () => {
  const root = makeLedger();
  try {
    const upcomingId = fixtureUpcoming(root);
    const winId = fixtureWin(root);
    const lossId = fixtureLoss(root);
    buildSite(root);
    const html = readFileSync(join(root, "site-dist/track-record.html"), "utf8");

    // Standings-driven figures: two settled, one pending, one win, one loss.
    assert.match(html, /Settled Picks<\/dt><dd>2<\/dd>/u);
    assert.match(html, /Pending \/ Void<\/dt><dd>1 \/ 0<\/dd>/u);
    assert.match(html, /Won <b>1<\/b>/u);
    assert.match(html, /Lost <b>1<\/b>/u);
    assert.match(html, /<article class="metric-card"><div class="label">Settled picks<\/div><div class="value">2<\/div>/u);

    // Real curve, not the empty placeholder.
    assert.match(html, /<polyline class="line" points=/u);
    assert.doesNotMatch(html, /The equity curve begins once two picks have settled/u);

    // Complete record table: newest first, every pick linked to its detail page.
    assert.match(html, /Complete pick record/u);
    const a = html.indexOf("North &lt;United&gt; v South &amp; City");
    const b = html.indexOf("Eastside Rovers v Westham Athletic");
    const c = html.indexOf("Atlantis FC v Poseidon City");
    assert.ok(a !== -1 && b !== -1 && c !== -1, "all three fixtures listed");
    assert.ok(a < b && b < c, "rows are newest first");
    for (const id of [upcomingId, winId, lossId]) {
      assert.match(html, new RegExp(`href="picks/${id}\\.html"`, "u"));
    }
    assert.match(html, /<span class="pill win">Won<\/span>/u);
    assert.match(html, /<span class="pill loss">Lost<\/span>/u);
    assert.match(html, /<span class="pill pend">Awaiting result<\/span>/u);
    assert.match(html, /Append-only record\./u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pick detail pages expose the frozen pick, verdict and correction chain", () => {
  const root = makeLedger();
  try {
    const upcomingId = fixtureUpcoming(root);
    const winId = fixtureWin(root);
    buildSite(root);

    const win = readFileSync(join(root, `site-dist/picks/${winId}.html`), "utf8");
    assert.match(win, /<h2>Verdict<\/h2>/u);
    assert.match(win, /<span class="pill win">Won<\/span>/u);
    assert.match(win, /Classification<\/dt><dd>Won<\/dd>/u);
    assert.match(win, /Eastside Rovers v Westham Athletic/u);
    assert.match(win, /Pick ID<\/dt><dd><code>/u);
    assert.match(win, /Price source<\/dt><dd>Pinnacle pre-match<\/dd>/u);
    assert.match(win, /<td>r1<\/td>/u);
    assert.match(win, /How the handicap splits/u);
    assert.match(win, /−1\.00/u);
    assert.match(win, /href="\.\.\/index\.html"/u);
    assert.match(win, /href="\.\.\/track-record\.html"/u);
    assert.match(win, /href="\.\.\/verification\.html"/u);

    const waiting = readFileSync(join(root, `site-dist/picks/${upcomingId}.html`), "utf8");
    assert.match(waiting, /<span class="pill pend">Awaiting result<\/span>/u);
    assert.match(waiting, /No result recorded yet\./u);
    assert.match(waiting, /Component settlement appears once the match settles\./u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verification page separates the PR witness from the independent Bitcoin anchor", () => {
  const root = makeLedger();
  try {
    fixtureUpcoming(root);
    buildSite(root);
    const html = readFileSync(join(root, "site-dist/verification.html"), "utf8");

    assert.match(html, /Three-layer evidence model/u);
    assert.match(html, /Public publication witness/u);
    assert.match(html, /startedAt/u);
    assert.match(html, /exact head SHA/u);
    assert.match(html, /Independent cryptographic timestamp/u);
    assert.match(html, /not cryptographically immutable/u);
    assert.match(html, /<section id="methodology"/u);
    assert.match(html, /href="verification\.html#methodology"/u);
    assert.doesNotMatch(html, /nothing has been altered since|Every pick is listed once/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("newsletter slot is a JavaScript-free HTML POST form with consent wording", () => {
  const root = makeLedger();
  try {
    fixtureUpcoming(root);
    buildSite(root);
    const html = readFileSync(join(root, "site-dist/index.html"), "utf8");

    assert.match(html, /<article id="newsletter" class="panel newsletter">/u);
    // Plain HTML POST to the configured provider endpoint; native validation only.
    assert.match(html, /<form class="newsletter-form" action="https:\/\/buttondown\.com\/api\/emails\/embed-subscribe\/pattern-xi" method="post">/u);
    assert.match(html, /<input type="hidden" name="embed" value="1">/u);
    assert.match(html, /<input type="email"[^>]*name="email"[^>]*required>/u);
    assert.match(html, /autocomplete="email"/u);

    // Privacy and consent wording sits beside the form.
    assert.match(html, /Privacy &amp; consent/u);
    assert.match(html, /used only to send this newsletter/u);
    assert.match(html, /never sold and never shared/u);
    assert.match(html, /one-click unsubscribe/u);
    assert.match(html, /sets no cookies and runs no client-side scripts/u);

    // The slot must not reintroduce scripting on any generated page.
    for (const file of walk(join(root, "site-dist")).filter((path) => path.endsWith(".html"))) {
      const pageHtml = readFileSync(file, "utf8");
      assert.doesNotMatch(pageHtml, /<script|\son[a-z]+\s*=/iu, `${file} contains client-side scripting`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("newsletter slot is driven purely by provider config", () => {
  assert.equal(newsletterSlot({ enabled: false }), "");

  const otherProvider = newsletterSlot({
    enabled: true,
    providerName: "Listmonk",
    providerUrl: "https://lists.example.org",
    formAction: "https://lists.example.org/subscription/picks",
    hiddenFields: { list: "pattern-xi" },
    emailFieldName: "email",
    buttonLabel: "Join",
  });
  assert.match(otherProvider, /action="https:\/\/lists\.example\.org\/subscription\/picks"/u);
  assert.match(otherProvider, /method="post"/u);
  assert.match(otherProvider, /<input type="hidden" name="list" value="pattern-xi">/u);
  assert.match(otherProvider, /name="email"/u);
  assert.match(otherProvider, />Join<\/button>/u);
  assert.match(otherProvider, /Listmonk/u);
  assert.doesNotMatch(otherProvider, /buttondown/iu);
});

test("generated site is deterministic and every local link resolves", () => {
  const root = makeLedger();
  try {
    fixtureUpcoming(root);
    buildSite(root);
    const first = outputDigest(root);
    buildSite(root);
    assert.equal(outputDigest(root), first);

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
