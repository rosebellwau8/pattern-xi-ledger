# Pattern XI — Public Picks Ledger

A public, prospective, auditable ledger of football Asian-handicap picks. No database, no back office, no dynamic services; the static site is just a view over the public Git ledger.

## Three-layer evidence model

1. **Public publication witness**
   - The exact version of a pick first appears in a public GitHub PR;
   - GitHub Actions' `Ledger integrity` runs against that PR's exact head SHA and file contents;
   - publication time is defined as the GitHub server-side `startedAt` of the first job attempt in which that exact SHA passed the check;
   - that time must be at least 2 hours before `kickoff_utc`. If the pick is modified, its SHA changes and it must be checked again;
   - merging only admits the same, already-public, already-verified version into the official ledger; it does not define first publication.

2. **Independent cryptographic timestamp**
   - Every manifest records the corresponding `main` commit SHA, the SHA-256 of the previous manifest, and the paths and SHA-256 hashes of all official pick files in that `main` state;
   - OpenTimestamps anchors this complete ledger-state snapshot to Bitcoin;
   - it proves that the complete state existed before a given Bitcoin time anchor, and provides an independent record for detecting later history alterations;
   - it is the second cryptographic anchor, not the primary source of the per-pick two-hours-before-kickoff proof.

3. **Append-only correction provenance**
   - Published pick/result files must never be overwritten, deleted or renamed;
   - result corrections are appended as `.rN.json`, with `corrects` citing the exact-byte SHA-256 of the previous version;
   - correction chains must be linear, unforked, and must actually change facts;
   - settlements and standings are always rebuilt deterministically from raw facts by programs, with settlement semantics guarded by the 52-case golden dataset.

Published history is designed to make retrospective alteration detectable. Bitcoin-anchored manifests provide an independent cryptographic record of previously published ledger states.

Git history, branch protection and append-only validation sharply raise the cost and visibility of after-the-fact changes, but the repository owner still theoretically controls the GitHub configuration, so GitHub history is not described as cryptographically absolutely tamper-proof. Ordinary Git author/committer timestamps are locally settable Git metadata and carry no publication proof.

## Verify it yourself in five minutes

```bash
git clone https://github.com/rosebellwau8/pattern-xi-ledger.git && cd pattern-xi-ledger

# 1. Find the PR head SHA that introduced the pick
git log --all --diff-filter=A --format=%H -- picks/2026/<pick-file>.json

# 2. Find the earliest successful public PR check for that SHA and read Ledger integrity.startedAt
gh run list --event pull_request --commit <head-sha> --workflow Check --status success \
  --json databaseId,headSha,event,conclusion,url
gh run view <run-id> --json headSha,jobs

# 3. Check the full ledger-state manifest and its Bitcoin timestamp
git switch anchors
cat manifests/<date>.txt
git show <main-commit-sha>:picks/2026/<pick-file>.json | sha256sum
ots verify manifests/<date>.txt.ots

# 4. Rebuild the entire record from raw facts; there must be no diff
node scripts/settle.mjs && node scripts/standings.mjs && git diff --exit-code
```

Step 1 yields a content-version identifier, not a trusted time; the trusted first-layer time witness comes from the GitHub-hosted Actions job event of the public PR in step 2.

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
npm test
npm run typecheck
npm run import -- export.json
npm run import -- --dry-run export.json
npm run publish -- export.json
npm run validate
npm run settle
npm run standings
npm run manifest -- <UTC-date> <main-commit-sha>
npm run build
```

## Operating procedures

**Publishing a pick**: export `production-public-export.v1` on the production side → `npm run publish -- export.json`. The script creates a branch, extracts the final direction/line/price, validates, rebuilds derived files, pushes and opens a public PR. Fixtures under two hours away at export time are skipped up front; the remote `Ledger integrity` then checks the exact PR head SHA against the GitHub server-side event time of that job attempt. The merged version must be identical to the version that passed the check; only after merging does a pick enter the official ledger and the static site.

**Recording a result**: after full time, add `results/YYYY/<id>.json` (facts only — scores, statuses) → `npm run validate && npm run settle && npm run standings` → put the derived `settlements/` and `standings/` changes into the same PR. CI rejects results added before kickoff.

**Correcting**: add `<id>.rN.json` with `corrects` set to the previous version file's exact SHA-256; never overwrite the old file. Detailed rules are in [CONVENTIONS.md](CONVENTIONS.md).

**Anchoring**: every day GitHub Actions generates a complete pick ledger snapshot from `origin/main`, writes it to the public `anchors` branch and runs the OpenTimestamps stamp/upgrade. A missed cron run misses no historical picks; the next snapshot still covers every official pick up to its `main_commit_sha`.

## GitHub protection settings

`main` must go through PRs; required approvals are 0 for a single maintainer; the required check is `Ledger integrity` in strict mode; administrators are protected too; force pushes and branch deletion are forbidden. The actual configuration and the pre-freeze verification record are in [LAUNCH.md](LAUNCH.md).

These controls raise the cost and visibility of anomalous changes; they do not mean the repository owner loses theoretical control over the GitHub configuration.

## Honest limitations

- Scores and prices are entered by the operator under the current schema and workflow; this ledger does not provide third-party verification of score or price authenticity.
- GitHub account, GitHub Actions, Pages and OpenTimestamps remain operational dependencies; having no database, back office, server private keys or dynamic services **greatly reduces the operational attack surface**, but does not eliminate it entirely.
- The first layer proves: an exact pick version passed its check in a public PR at a GitHub server event time at least two hours before kickoff. The second layer proves: a complete ledger state existed before a Bitcoin time anchor.

For architectural decisions see [DESIGN.md](DESIGN.md); for operating rules see [CONVENTIONS.md](CONVENTIONS.md).
