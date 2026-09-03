# DESIGN — Lean trust model

**Status:** current from 2026-09-03. This design supersedes the exact-PR plus mandatory OpenTimestamps architecture rehearsed on 2026-09-02, before the formal 90-day run began.

## 1. Goal and boundary

Pattern XI answers three practical questions:

1. Was a complete public recommendation visibly posted at least two hours before kickoff, or was a subscriber-only recommendation committed before that cutoff?
2. Is the disclosed history resistant to ordinary silent edits through the normal contribution workflow?
3. Can settlement and performance be reproduced from the public inputs?

The repository remains a static ledger implementation. It has no database, business backend, payment system, subscriber store, social-platform token or client-side application. PatternXI.com is the intended canonical product archive; during this static phase, GitHub Pages projects the same public repository data.

## 2. Evidence model

### 2.1 Public pick receipt

The complete public pick is posted on X. Its ledger receipt contains:

- the canonical X status URL;
- the platform publication time in UTC;
- the pick ID;
- the SHA-256 of the exact canonical pick-file bytes.

The receipt time must be at least two hours before the frozen kickoff. Equality at exactly two hours passes. The normal PR workflow rejects missing receipts, malformed URLs, late times, byte-hash mismatches and competing evidence.

The X post is third-party public evidence, not an immutable timestamp. X can display editing history for eligible posts and an account owner may delete a post. CI deliberately makes the narrower claim it can support: it validates the receipt record and byte relationships; a human auditor opens the linked X status and checks its content and displayed platform time.

### 2.2 Subscriber batch commitment

A subscriber-only batch is serialized once as an exact JSON file:

```json
{
  "schema": "pattern-xi.subscriber-batch.v1",
  "batch_id": "pxb-20260903-1600",
  "nonce": "64 lowercase hex characters",
  "picks": []
}
```

The nonce is 256 random bits and remains private until reveal. It prevents practical dictionary guessing against the small, structured football-pick space. Picks are sorted by ID and each embedded pick must satisfy the normal pick schema.

Before the earliest kickoff minus two hours, Pattern XI publishes the batch ID, pick count, earliest kickoff and SHA-256 of the exact file bytes on X. The public commitment file records that status URL and time. No canonicalisation is performed later: verification hashes the exact revealed bytes.

After disclosure, `batch-reveal` checks the exact byte hash, count, earliest kickoff, nonce, embedded schemas and conflicts before copying the original bytes into `publication/reveals/` and installing the disclosed picks into `picks/`. Every formal pick must have exactly one evidence route: a public receipt or one revealed subscriber batch.

### 2.3 Append-only provenance and deterministic conclusions

CI treats these as authoritative append-only JSON:

```text
picks/
results/
publication/receipts/
publication/commitments/
publication/reveals/
```

Existing files may not be modified, deleted or renamed through a PR. Result corrections remain new `.rN.json` files whose `corrects` field is the SHA-256 of the previous file's exact bytes. Settlement and standings are derived and fully rebuildable.

## 3. Data flow

### Public pick

```text
production public export
  → dry-run creates canonical pick IDs and restrained X copy
  → operator posts complete picks on X
  → receipt input records X URLs and platform UTC times
  → publish command writes pick + exact-byte receipt
  → validation and append-only PR
  → deterministic settlement / standings / static site
```

Publication is not described as a distributed atomic transaction. A pick does not become formally admissible merely because an import or website write succeeded. The formal record needs the external receipt and must pass validation; a failed or late X publication cannot be backfilled as a valid Official Pick.

### Subscriber batch

```text
private canonical pick objects
  → random-nonce exact batch file
  → SHA-256 + count + earliest kickoff posted on X
  → public commitment file
  → private subscriber delivery outside this repository
  → post-event exact reveal
  → canonical picks + results
  → deterministic settlement / standings / static site
```

The commitment proves later-disclosed content matches the earlier hash. It does not itself prove subscriber delivery; delivery records belong to the future membership provider boundary.

## 4. Source-of-truth direction

```text
raw picks + raw result chains + publication evidence
                    ↓
             settlement engine
                    ↓
                standings
                    ↓
        static HTML + ledger.json
```

Generated settlements, standings, `site-dist/` and `ledger.json` are never authoritative inputs. The site does not feed data back into the ledger.

## 5. Frozen settlement assets

| Asset | Location | Constraint |
|---|---|---|
| Settlement Rules v1 | `src/settlement/` | Exact decimal, lifecycle boundaries and quarter-line splits |
| Golden dataset | `fixtures/golden/settlement-v1.json` | 52 cases |
| Performance projection | `src/performance/` | Rebuildable counts, ROI, cumulative return and zero-origin max drawdown |
| Ledger validation | `scripts/lib.mjs` | Fail-closed schemas and correction chains |
| Publication evidence | `scripts/publication-evidence.mjs` | Two-hour receipts, exact hashes, salted batch reveals |

## 6. Deliberate simplifications

The following are no longer required admission mechanisms:

- exact GitHub PR-head publication time;
- GitHub Actions `startedAt` as the formal witness;
- daily full-state manifests;
- mandatory OpenTimestamps/Bitcoin anchoring.

GitHub still provides append-only PR enforcement, public source history, deterministic checks and Pages hosting. OpenTimestamps may later anchor an occasional complete export as optional disaster insurance, but it must not be described as the two-hour proof for an individual pick.

## 7. Future boundary

X API automation, a PatternXI.com operational database, subscriber delivery, payment and membership access are intentionally outside this repository change. The current command renders exact X copy and records the resulting public receipt without storing credentials. If those services are introduced, they must preserve the evidence schemas and fail closed when an external receipt cannot be created before the cutoff.
