# Pattern XI — Public Picks Ledger

A public, prospective, auditable ledger of football Asian-handicap picks.
No database, no back office, no dynamic services — the Git history is the ledger, and the static site is a view over it.

**Live site:** <https://rosebellwau8.github.io/pattern-xi-ledger/>

## What makes this ledger different

Every tips record claims to be honest. This one is built so that you can check it:

1. **Public publication witness.** A pick only counts if its exact version passed the `Ledger integrity` check in a public PR, at a GitHub server event time at least 2 hours before kickoff. Git commit timestamps — trivially fakeable — are never used as proof.
2. **Independent cryptographic timestamp.** Every day the complete ledger state (every pick's hash, the `main` commit, the previous manifest's hash) is anchored to the Bitcoin blockchain through OpenTimestamps. Past states cannot be quietly rewritten without breaking the anchor chain.
3. **Append-only corrections.** Published picks and results can never be edited, deleted or renamed. A correction is a new file citing the exact SHA-256 of what it corrects, in a linear, unforked chain.
4. **Conclusions are computed, never typed.** Win/loss classification and net returns are always derived by a frozen settlement engine guarded by a frozen 52-entry golden dataset: 51 behavioral cases and one documented database-workflow exception (045). Result files carry facts only (scores, statuses) — there is no field in which a human could write a conclusion.
5. **Everything rebuilds from raw data.** `settle && standings && check:derived` must be a no-op on every PR, and the static site is generated deterministically with zero client-side scripts.

## Verify it yourself in five minutes

```bash
git clone https://github.com/rosebellwau8/pattern-xi-ledger.git && cd pattern-xi-ledger

# 1. Locate the merged PR and its final head; then inspect successful job attempts
git log --all --diff-filter=A --format=%H -- picks/2026/<pick-file>.json
gh api repos/rosebellwau8/pattern-xi-ledger/commits/<addition-sha>/pulls
gh pr view <pr-number> --json headRefOid,mergeCommit,files,url
git fetch origin pull/<pr-number>/head
git diff --exit-code <head-sha> <main-commit-sha> -- picks/2026/<pick-file>.json
gh run list --event pull_request --commit <head-sha> --workflow Check --limit 100 --json databaseId,headSha,event,conclusion,url
gh run view <run-id> --json headSha,jobs
gh api repos/rosebellwau8/pattern-xi-ledger/actions/runs/<run-id>/attempts/<attempt>/jobs

# 2. Check the full ledger-state manifest and its Bitcoin timestamp
git switch anchors
cat manifests/<date>.txt
git show <main-commit-sha>:picks/2026/<pick-file>.json | sha256sum
ots verify manifests/<date>.txt.ots

# 3. Return to the selected main snapshot before rebuilding
git switch --detach <main-commit-sha>
node scripts/settle.mjs && node scripts/standings.mjs && node scripts/check-derived.mjs
```

Use the PR final `headRefOid` as `<head-sha>` and verify its pick bytes against the selected main snapshot. Inspect all relevant runs and attempts (increase the list limit when needed); select the earliest successful `Ledger integrity` job for that exact head. A later failed rerun does not erase an earlier successful attempt.

## Repository layout

```text
picks/YYYY/<id>.json        Picks (id starts with the kickoff UTC date)
results/YYYY/<id>.json      Results (appended after full time; corrections as <id>.rN.json + corrects chain)
settlements/YYYY/<id>.json  Derived settlement details (generated; CI enforces freshness)
manifests/YYYY-MM-DD.txt    anchors branch: complete pick ledger snapshot + main SHA + previous manifest hash
manifests/*.ots             anchors branch: OpenTimestamps Bitcoin anchoring receipts
standings/standings.json    Derived standings projection (generated, rebuildable)
src/settlement/             Settlement engine (52-case golden dataset)
src/performance/            Standings projection (exact decimal)
scripts/                    import / validate / settle / standings / manifest / build-site
tests/                      Golden dataset, ledger rules, evidence model and site regressions
site-dist/                  Static site build output (gitignored, generated at deploy time)
```

## Everyday commands (Node ≥ 24, zero runtime dependencies)

```bash
npm test                                # full suite: golden dataset, ledger rules, evidence flow, site
npm run typecheck                       # strict TypeScript static check
npm run import -- export.json           # extract compliant public picks from a production v1 JSON export
npm run import -- --dry-run export.json # preview only, write nothing
npm run publish -- export.json          # branch, import, open a PR, and auto-merge once CI passes
npm run validate                        # validate all data and correction chains
npm run settle                          # recompute settlements from picks + results (derived files)
npm run standings                       # rebuild the standings projection (derived files)
npm run manifest -- <UTC-date> <main-commit-sha>   # build a complete ledger-state manifest
npm run build                           # build the static site into site-dist/
```

## Operating procedures

**Publishing a pick (≥2 hours before kickoff)**: export `production-public-export.v1` on the production side → `npm run publish -- export.json`. The script creates a branch, extracts the final direction/line/price, validates, rebuilds derived files, pushes and opens a public PR. Fixtures under two hours away at export time are skipped. The remote `Ledger integrity` then gates the exact PR head SHA against its GitHub server-side job event time; the merged version must be identical to the version that passed the check.

**Recording a result (after full time)**: write `results/YYYY/<id>.json` (facts only — scores, statuses) → `npm run validate && npm run settle && npm run standings` → put the derived `settlements/` and `standings/` changes into the same PR. CI rejects results added before kickoff.

**Correcting an error**: add `<id>.rN.json` with `corrects` set to the previous version file's exact SHA-256; never overwrite the old file. The four correction semantics and their evidence requirements are documented in [CONVENTIONS.md](CONVENTIONS.md).

## Formal-period declaration

Keep `config/formal-window.json` null/null during shadow operation. After the audit fixes and deployment are verified, declare a future `start_utc` and `end_utc` exactly 90 UTC days apart through a PR. Official figures include the start and exclude the end; full-record figures remain all-time. The synthetic drill closes as CANCELLED/VOID before this declaration. See CONVENTIONS.md for correction semantics and public rounding.

Production kickoff imports reject DST overlaps and nonexistent local times. Resolve the instant on the exporter side and supply an unambiguous representation, such as local UTC plus timezone `UTC`, before retrying.

## Honest limitations

- Scores and prices are entered by the operator under the current schema and workflow; the ledger proves when each pick was published, not what a third-party page showed at the time. Third-party snapshots (e.g. archive.org Save Page Now) are recommended as corroboration.
- The GitHub account, Actions, Pages and OpenTimestamps are operational dependencies; the serverless design greatly reduces — but does not eliminate — the operational attack surface.
- Branch protection and append-only rules make retrospective alteration costly and visible; this is not a claim of cryptographic absolute immutability.

## Further reading

- [CONVENTIONS.md](CONVENTIONS.md) — the ledger's operating rules
- [DESIGN.md](DESIGN.md) — the three-layer evidence model in detail
