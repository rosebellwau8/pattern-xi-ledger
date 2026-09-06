# Ledger Rules (CONVENTIONS)

This file is the ledger's rulebook. Once published, any change to these rules goes through a PR and is visible in Git history.
A rule violation means CI refuses to merge (fail-closed); there are no warning-level violations.

## 1. Publication rules

- **Publication time** is defined as the GitHub server-side `startedAt` of the job attempt in which the exact version of a pick first passed `Ledger integrity` in a public PR. That job must run against the PR's exact head SHA and file contents, and the time must be at least 2 hours before `kickoff_utc`.
- If a pick in a PR is modified, its SHA changes and the check must run and pass again. The version finally merged must be identical to the version that passed the two-hour check; merging only admits an already-public, already-validated record into the formal ledger and the static site — it does not define first publication.
- Git author/committer timestamps are ordinary metadata — locally settable and changeable via amend or rebase — and are never used as publication time or pre-kickoff proof. The first-layer time witness comes only from a public PR and the GitHub-hosted Actions server-side event record for the exact SHA.
- Merged `picks/**/*.json` and `results/**/*.json` must never be modified, deleted or renamed; CI enforces the append-only constraint on PR diffs. A wrong result can only be corrected by adding a `.rN.json` correction file.
- **Full-disclosure obligation**: every pick actually tipped or staked must be recorded; selective publication is not allowed. This is the precondition for the ledger's credibility — and the one rule that code cannot enforce, only rules and reputation can.
- The unit stake is fixed at 1; rolling stakes, accumulators and bankroll management are not recorded.
- Market scope: full-match Asian handicap only (`market: "asian_handicap"`), HOME/AWAY selections only.

GitHub history, branch protection and append-only validation sharply raise the cost and visibility of after-the-fact changes; the repository owner still theoretically controls the repository configuration, so these mechanisms are not described as cryptographically absolutely tamper-proof. The independent cryptographic record is provided by the complete ledger-state manifests and OpenTimestamps receipts on the public `anchors` branch.

## 2. Pick file rules

- The file name is tightly bound to its content: `picks/<year>/<kickoff-UTC-date>-<team-slugs>-ah.json`, and `id` must start with the kickoff UTC date.
- Two price fields are mandatory: `published_price` (as published) and `published_price_format` (`DECIMAL_ODDS` or `HONG_KONG_ODDS`); `normalized_decimal_price` is verified by script (Hong Kong odds + 1 = decimal), eliminating format drift.
- `price_source` is mandatory (e.g. "Pinnacle pre-match"). This is an operator-declared field — the ledger proves what was published and when; it does not independently verify the odds page or third-party prices.
- Unknown fields are rejected outright (allowlist); there is no room for "just one extra field".

## 3. Result recording rules (facts only, never conclusions)

Result files may contain **fact fields only**: scores, statuses, timestamps, interruption dispositions. Classifications (win / half-win / push / half-loss / loss / void) and net returns are computed by `settle.mjs` calling the frozen settlement engine; a hand-written conclusion would be ignored — the field simply does not exist.

Status mapping (per Settlement Rules v1):

| status | Required fields | Engine behaviour |
|---|---|---|
| `PLAYED` | `home_score`, `away_score` | Settles normally; VOID if `actual_kickoff_at` is more than 48h after the frozen kickoff |
| `POSTPONED` | New kickoff: `actual_kickoff_at`; on completion also `final_status: "FINISHED"` and the score; no new kickoff: `status_determined_at` | VOID beyond 48h, otherwise PENDING; normal settlement if completed within 48h |
| `CANCELLED` | — | VOID immediately |
| `ABANDONED` | `actual_kickoff_at`, `interruption_disposition`; `RESUMED_SAME_FIXTURE` also needs `regulation_completed_at` and the score; `UNKNOWN` needs `status_determined_at` | Settles if the same fixture completes within 48h; replayed or abandoned fixtures are VOID; UNKNOWN is VOID at or beyond 168h |

## 4. Correction rules (append-only, never overwrite)

- Results are append-only: a correction is a new file `results/<year>/<id>.rN.json` (N increments), whose `corrects` field holds the **exact SHA-256 of the corrected file**; broken chains, forks and no-op corrections are rejected by script.
- A correction must carry a non-empty reason (`note`) and a `correction_kind` matching one of four semantics (inherited from Settlement Rules v1). Except for `SETTLEMENT_LOGIC_ERROR`, at least one `evidence_refs` source is required:
  1. `SOURCE_DATA_ERROR` — the score source was mis-transcribed (needs the score from a more authoritative source, with evidence);
  2. `SETTLEMENT_LOGIC_ERROR` — engine or rule application error (needs recomputation with the correct score);
  3. `OFFICIAL_RESULT_CORRECTION` — the official score was revised (evidence hierarchy: competition governing body > official data provider > club official; ordinary score websites are not authoritative);
  4. `ADMINISTRATIVE_RESULT_CHANGE` — administrative reclassification; the original sporting settlement stands.
- Administrative corrections may append evidence without changing the sporting facts. Prefer retaining the sporting score in `home_score` / `away_score` and recording the administrative decision separately as `administrative_score: { "home": 0, "away": 3 }`. A changed top-level administrative score also never replaces the retained sporting facts. Repeated identical facts and evidence are rejected regardless of JSON key order; changing only the note is not a new administrative decision.
- Derived revisions expose both `facts` (the recorded status/score) and `settlement_facts` (the retained sporting facts actually used). An administrative revision copies the previous sporting settlement. A later `SETTLEMENT_LOGIC_ERROR` must supply those retained sporting facts; factual amendments use `SOURCE_DATA_ERROR` or `OFFICIAL_RESULT_CORRECTION`. These two kinds must change sporting facts, even after an administrative revision.
- Pick files are immutable once merged — a pick is an immutable quotation record. If one is wrong, publish a new pick declaring the void and keep the old record.

## 5. Settlement rules version

- Settlement semantics are frozen as Settlement Rules v1 (52-case golden dataset, `fixtures/golden/settlement-v1.json`; SHA-256 baseline prefix in [DESIGN.md](DESIGN.md)).
- CI checks the frozen dataset's exact SHA-256 and 51 case behaviors (47 direct engine cases and 4 correction cases). Case 045 concerns the replaced database preview/confirmation workflow and is explicitly exempted; see DESIGN.md, "Golden coverage and the case 045 exception". Four correction kinds additionally have ledger-to-site regression coverage. This is not a claim of 52/52 behavioral coverage.
- Changing the settlement rules means a new version number, a new golden dataset and an explicit PR declaration; history is never recalculated retroactively (projections freeze to the rules version in force at settlement time).

## 6. Derived-file discipline

`settlements/` and `standings/` are derived files: they must stay consistent with the raw data (`settle.mjs` clears and fully rebuilds settlements, and CI then runs `node scripts/check-derived.mjs`). The gate includes untracked, ignored, staged, modified and deleted derived files. A PR recording results must include the derived changes so reviewers see the computed outcome directly in the diff. Suspect a number? Delete the derived files and rebuild.

## 7. Formal validation window and public display

- `config/formal-window.json` declares the formal window. Both values are null during the shadow run. Starting formal verification requires one declaration PR with explicit `start_utc` and `end_utc`, exactly 90 UTC days apart, chosen before the formal period begins. Never backdate a declaration to select observed outcomes.
- Official figures include kickoffs in `[start_utc, end_utc)`: include the start, exclude the end. The site uses the same window for official counts and their sparklines. Full-record standings and the all-time curve continue to show the complete ledger and are labelled accordingly. Ending the window does not remove pending results or later corrections for included picks.
- The synthetic rehearsal is closed by an appended CANCELLED result (VOID). It remains visible in the all-time record and is excluded from return calculations and `n`; the future formal window starts after the shadow run.
- Public curve headlines use three decimal places, exact half-up rounding, and unsigned zero when rounding to zero. Tables keep exact ledger strings. Floating-point conversions are permitted for chart geometry, not financial headline values.
- Production exports with ambiguous or nonexistent local kickoff times are rejected before import. The exporter must resolve the instant, for example by supplying its unambiguous UTC local representation with timezone `UTC`. Guessing a DST fold is not permitted.
