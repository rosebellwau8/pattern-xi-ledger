# Pattern XI — Public Picks Ledger

A public, prospective, auditable ledger of football Asian-handicap picks.
No database, no back office, no signing server — **the Git history is the ledger, and third-party timestamps are the notary**.

## The trust story

Every pick has to answer the same scepticism: "How do you prove it was published before the result came out?" This ledger answers with three independent anchors:

1. **Public PR + GitHub Actions server clock** — when a pick file appears in a public PR, CI enforces a window of at least 2 hours before kickoff on the runner's clock; Git commit timestamps are locally settable metadata and are never used as the gating witness;
2. **Catch-up manifests + OpenTimestamps** — every night CI anchors the SHA-256 hashes of all picks not yet covered by a manifest to the Bitcoin blockchain; a missed run is simply caught up in the next batch, receipts live on the public `anchors` branch, and manifests are chained head to tail;
3. **Append-only correction chain** — result files are only ever appended, never overwritten; a correction must carry the SHA-256 of the record it corrects (the `corrects` field), so every change stays visible in Git history.

Settlement classifications and net returns are **always computed by a frozen engine** (guarded by a 52-case golden-dataset regression); result files record facts only (scores, statuses) and cannot carry conclusions.

## Verify it yourself in five minutes

```bash
git clone https://github.com/rosebellwau8/pattern-xi-ledger.git && cd pattern-xi-ledger

# 1. Find the commit that introduced the pick, then check the public PR's Ledger integrity run time
git log --diff-filter=A --format=%H -- picks/2026/<pick-file>.json
gh run list --commit <commit-sha> --workflow Check

# 2. Switch to the public anchoring branch and match the file hash against the manifest
git switch anchors
sha256sum picks/2026/<pick-file>.json && cat manifests/<date>.txt

# 3. Verify the manifest's Bitcoin timestamp (after pip install opentimestamps-client)
ots verify manifests/<date>.txt.ots

# 4. Rebuild the entire record from raw data; there must be no diff
node scripts/settle.mjs && node scripts/standings.mjs && git diff --exit-code
```

## Repository layout

```text
picks/YYYY/<id>.json        Picks (committed pre-kickoff; id starts with the kickoff UTC date)
results/YYYY/<id>.json      Results (appended after full time; corrections as <id>.rN.json + corrects chain)
settlements/YYYY/<id>.json  Derived: settlement details (generated, committed for review, CI enforces freshness)
manifests/YYYY-MM-DD.txt    anchors branch: hashes of not-yet-anchored picks + previous manifest hash
manifests/*.ots             anchors branch: OpenTimestamps Bitcoin anchoring receipts
standings/standings.json    Derived: standings projection (generated; can be deleted and rebuilt at any time)
src/settlement/             Settlement engine (ported verbatim from Pattern XI Task 6; 52-case golden dataset)
src/performance/            Standings projection (from Task 7; exact decimal, zero-origin max drawdown)
scripts/                    import / validate / settle / standings / manifest / build-site
tests/                      Golden-dataset regression + ledger rule tests
site-dist/                  Static site build output (gitignored, generated at deploy time)
```

## Everyday commands (Node ≥ 24, zero runtime dependencies)

```bash
npm test                                # 52-case golden dataset + ledger rule tests
npm run typecheck                       # strict TypeScript static check
npm run import -- export.json           # extract compliant public picks from a production v1 JSON export
npm run import -- --dry-run export.json # preview only, write nothing
npm run publish -- export.json          # branch, import, open a PR, and auto-merge once CI passes
npm run validate                        # validate all data and correction chains (CI enforces the ≥2h rule on new picks)
npm run settle                          # recompute settlements from picks + results (derived files)
npm run standings                       # rebuild the standings projection (derived files)
npm run manifest                        # build a catch-up manifest for all not-yet-anchored picks
npm run build                           # build the static site into site-dist/
```

## Operating procedures

**Publishing a pick (≥2 hours before kickoff)**: export `production-public-export.v1` from the production side →
`npm run publish -- export.json`. The command creates a branch, imports, validates, rebuilds derived files, pushes and opens
a public PR, then auto-merges once required checks pass. The importer strips rankings, patterns and internal notes, keeping
only fixture identity, final direction, line, price and source; fixtures under two hours away at export time are explicitly
skipped. CI enforces the gate again on the public PR using GitHub's server clock, and rejects modification or deletion of
published pick/result JSON.

**Recording a result (after full time)**: write `results/YYYY/<id>.json` (facts only — scores/status) →
`npm run validate && npm run settle && npm run standings` → commit the derived `settlements/` and `standings/` changes in
the same PR, so reviewers see the computed outcome directly in the diff. CI rejects result files added before kickoff.

**Correcting an error**: add `<id>.r2.json` with `corrects` set to the corrected file's SHA-256; never touch the old file.
The four correction semantics and their evidence requirements are documented in [CONVENTIONS.md](CONVENTIONS.md).

## Launch checklist (external actions, one-off)

> ✅ Executed on 2026-09-02 (single maintainer, required approvals set to 0, all other protections in force) —
> the measured record is in [LAUNCH.md](LAUNCH.md).

```bash
# 1. Create the public repository and push (the ledger must be a clean history from the first commit)
gh repo create pattern-xi-ledger --public --source=. --push

# 2. Enable GitHub Pages (Settings → Pages → Source: GitHub Actions)

# 3. Branch protection (Settings → Branches → main):
#    - Require a pull request before merging
#    - Required approvals: 0 (single maintainer; raise to 1 when a second collaborator joins)
#    - Require status checks: Ledger integrity (workflow: Check)
```

After that CI runs itself: PR validation, nightly anchoring to the public `anchors` branch, site deployment.
`main` accepts only PRs that pass review and the required checks; automatic anchoring never bypasses them.

## Honest limitations

The ledger proves that a pick's content already existed — at least two hours before kickoff — when its public PR check ran,
and that history stays append-only after the merge. **Prices are declared by the operator** (a source field is mandatory);
third-party snapshots of the odds page (e.g. archive.org Save Page Now) are recommended as corroboration.
Neither problem has a free perfect solution, in any system, including more elaborate ones.

## Relationship to the original Pattern XI project

The original repository (`E:\PatternXI`) is kept as a design archive. For this project's architectural decisions and the
porting manifest see [DESIGN.md](DESIGN.md); for operating rules see [CONVENTIONS.md](CONVENTIONS.md).
