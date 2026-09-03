# DESIGN — Three-layer evidence model

**Status:** frozen 2026-09-02; the architecture is in 90-day public-validation preparation.

## 1. Goal and boundary

Pattern XI Ledger answers one narrow question: was the exact final content of a pick public at least two hours before kickoff, and is the formal record afterwards easy to audit and to check for anomalous changes?

It does not prove where the operator-entered scores or prices came from. Scores and prices are entered by the operator under the current schema and workflow. The system deliberately contains no database, no back office, no relay, no odds snapshots, no score-evidence service, no third-party APIs, no messaging channels and no signing infrastructure.

## 2. Three-layer evidence model

### 2.1 Public publication witness

A pick first appears in a public GitHub PR. `Ledger integrity` runs against that PR's exact head SHA; the workflow checks out exactly that SHA and verifies the GitHub Actions run's `head_sha`. Publication time is the GitHub server-side `startedAt` of the first job attempt in which that exact SHA passed, and the gate script checks `kickoff_utc − startedAt ≥ 2h` against that event time.

Any byte-level change to a pick produces a new SHA and triggers a new check. The version finally merged must be the very version that passed the check; merging performs the formal admission — it does not define first publication. Ordinary Git author/committer timestamps can be set locally, amended or rebased; they are Git metadata, not GitHub server times, and play no part in prospective-publication proof.

### 2.2 Independent cryptographic timestamp

The daily manifest is a complete ledger-state snapshot, not a list of "picks added today". Each v2 manifest contains:

- the manifest version;
- the snapshot date;
- the corresponding `main` commit SHA;
- the SHA-256 of the previous manifest's exact bytes;
- the paths and SHA-256 hashes of every formal pick file in that `main` state.

OpenTimestamps anchors the manifest to Bitcoin. It proves that a complete ledger state existed before a Bitcoin time anchor, and provides a cryptographic record for independently detecting later history alterations. A missed cron run misses no historical pick, because the next manifest re-covers the complete pick ledger. OTS is not the primary two-hour publication proof for each pick; the first layer — the public PR + Actions witness — is.

### 2.3 Append-only correction provenance

CI rejects modification, deletion or renaming of published pick/result files. Corrections only add `.rN.json` files; `corrects` must cite the previous version's exact-byte SHA-256; chains must be linear, unforked, consecutively numbered and must actually change facts. Settlements and standings are rebuilt deterministically from raw facts, and CI checks the derived files for drift.

Published history is designed to make retrospective alteration detectable. Bitcoin-anchored manifests provide an independent cryptographic record of previously published ledger states.

## 3. Trust boundary

| Fact to establish | Mechanism | Promise not made |
|---|---|---|
| The exact pick was public pre-kickoff | Public PR + exact head SHA + server-side `startedAt` of the successful `Ledger integrity` job + two-hour gate | No use of Git commit timestamps; no requirement to merge before kickoff |
| A complete ledger state existed | Full pick manifest + main SHA + previous manifest SHA-256 + OpenTimestamps/Bitcoin | OTS does not replace the per-pick two-hour PR witness |
| Corrections are traceable | Append-only diff gate + `.rN.json` + `corrects` exact-byte hash | No claim that the repository owner cannot theoretically change GitHub settings or history |
| Settlements are reproducible | Frozen engine + 52-case golden dataset + deterministic rebuild | No third-party verification of operator-entered scores or prices |

GitHub history, branch protection, public PRs and append-only validation sharply raise the cost and visibility of after-the-fact changes, but the repository owner still theoretically controls the account and repository configuration. Cryptographic evidence independent of GitHub history comes from the anchored manifests. The system has no database, dynamic back office or server private keys, which greatly reduces the operational attack surface; it still depends on the GitHub account, Actions, Pages and OpenTimestamps.

## 4. Data flow

```text
production export
      │
      ▼
public PR: exact head SHA + pick bytes
      │
      ▼
GitHub-hosted Ledger integrity job
public repository + head_sha match + server-side startedAt + ≥2h
      │
      ▼
merge same checked version → formal main ledger → static Pages
      │
      ├── nightly full-state manifest (main SHA + all pick hashes + previous manifest hash)
      │                                      │
      │                                      ▼
      │                          OpenTimestamps → Bitcoin
      │
      └── operator-entered result facts → settle → standings → site build
```

## 5. Frozen settlement assets

| Asset | Location | Constraint |
|---|---|---|
| Settlement Rules v1 engine | `src/settlement/` | Exact decimal, 48/168-hour boundaries, half-win/half-loss splits |
| Golden dataset | `fixtures/golden/settlement-v1.json` | 52 cases, SHA-256 baseline prefix `2a752573…b855` |
| Performance projection | `src/performance/` | N, ROI, cumulative return and max drawdown are rebuildable |
| Ledger validation | `scripts/lib.mjs`, `scripts/validate-pr.mjs` | Schema, two-hour gate, append-only correction chains |

## 6. Architecture freeze

With the real GitHub PR, required check, merge, manifest/OTS workflow, settlement, standings and Pages deployment all verified, the architecture is frozen for 90-day public-validation preparation. During the freeze, no score-source verification, odds evidence, dynamic services, messaging channels or multi-operator signing will be added; bugs are fixed only in ways that keep the three-layer definitions consistent.

Operator note (2026-09-02): a site-only newsletter signup slot was added to the public pages on explicit operator instruction — a provider-agnostic static HTML form (currently Buttondown's no-JavaScript embed endpoint) with privacy/consent wording beside it. It adds no backend, no client-side JavaScript and no payments; it is not a ledger input, introduces no dynamic service into this repository, and no evidence layer depends on it, so it sits outside the freeze's scope.
