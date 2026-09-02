# Launch Record (LAUNCH)

This file is the archive of the 2026-09-02 launch actions: what was done, what the measured results were, and why it is configured this way.
When questions arise about the ledger's operating record, cross-check this file, the public PR/Actions events and the anchored manifests;
ordinary Git commit times are not treated as server time witnesses.

## Addresses

- Public repository: <https://github.com/rosebellwau8/pattern-xi-ledger>
- Public ledger site (GitHub Pages): <https://rosebellwau8.github.io/pattern-xi-ledger/>

## Launch timeline (2026-09-02, times measured on GitHub, UTC)

| Time | Event |
|---|---|
| 07:34 | Public repository created and `main` pushed (commits `df93957` + `9711a19`); first Check run passed |
| 07:36 | First Deploy site run succeeded; Pages site live |
| 07:48 | First Anchor manifest rehearsal **failed**: the manifest script did not skip correctly when there were no picks that day |
| 07:51 | Commit `c953c19` (fix: skip stamping when daily manifest is empty) fixed the empty-manifest skip; Check + Deploy site passed |
| 07:52 | Second Anchor manifest rehearsal **succeeded**: skip logic worked; the public `anchors` branch was created |

Recorded as it happened: the anchoring pipeline went through a real "fail → fix → verify" cycle, and the fix itself is visible in Git history (`c953c19`).

## `main` branch protection (finalised 2026-09-02, verified via the GitHub API)

| Setting | Value | What it means |
|---|---|---|
| Require pull request | ✅ On | No change (including docs) can be pushed directly to `main`; a PR is mandatory |
| Required approvals | **0** | Single maintainer: PR review is the operator's own responsibility; machine checks remain fully enforced (see below) |
| Required status checks | `Ledger integrity` (strict) | The final PR head SHA must pass the full tests, the server-event-time two-hour gate, append-only validation and the derived-consistency check |
| Include administrators | ✅ On | Under the current configuration the owner is also bound by the PR process; the owner still theoretically controls the repository configuration |
| Force pushes | ❌ Disabled | Current rules forbid rewriting `main`; this raises cost and visibility but is not cryptographic tamper-proofing |
| Deletions | ❌ Disabled | `main` cannot be deleted |

## CI verification results

- **Tests**: all 14 passed at launch; the suite has since grown to cover the 52-case golden settlement dataset, production import/publish, complete-state manifests and site regressions.
- **Workflows**: Check (PR/push integrity), Deploy site (Pages deployment) and Anchor manifest (daily anchoring) all green.
- **`anchors` branch**: created and pushed. The workflow runs daily at 00:15 UTC, manifests the complete pick ledger state at `origin/main` and stamps it through OpenTimestamps; every snapshot contains the main SHA, all pick hashes and the previous manifest's hash.
- **Append-only validation**: once merged, any modification, deletion or renaming of published `picks/` or `results/` JSON is rejected by CI (introduced in commit `9711a19`, `scripts/validate-pr.mjs`).
- **Pages measured**: `/`, `/track-record.html` and `/verification.html` all return HTTP 200.

## Historical run record

- As of this record, the first commit `df93957` has not been rebased or force-pushed to our knowledge. This is a public statement of the operating record, not a claim that GitHub history is cryptographically immutable.
- At launch the local and remote repositories were fully in sync with a clean working tree; the ledger has been a clean history from its first commit.
- 2026-09-02: the three historical planning documents under `docs/plans/` were removed from the tree to keep the public surface minimal. They contained no credentials or personal data — only design deliberation — and remain reachable in Git history. History was deliberately not rewritten: the anchored manifests and PR witness events reference the existing SHAs, and a purge would cost more evidence than it protects.

## Daily operating flow (single-maintainer mode)

1. **Publishing a pick**: export JSON on the production side → `npm run publish -- export.json` → the script automatically branches, imports, validates, pushes and opens a public PR. The `Ledger integrity.startedAt` of the first successful attempt against the exact PR head SHA defines publication time and must be ≥2 hours before kickoff. The automatic merge afterwards (approvals = 0) only formally admits the same version to the ledger.
2. **Recording a result (after full time)**: write `results/YYYY/<id>.json` (facts only — scores/statuses) → `npm run validate && npm run settle && npm run standings` → commit the derived `settlements/` and `standings/` changes in the same PR, so reviewers see the computed outcome directly in the diff.
3. **Correcting an error**: add `<id>.rN.json` with the corrected file's SHA-256 in `corrects`; never modify the old file.

## Single-maintainer trade-offs and future tightening

- **Approvals = 0 is the single-maintainer reality**: GitHub does not allow a PR author to approve their own PR, so "1 approval" cannot be enabled with one maintainer. Human review is currently the operator self-reviewing the PR diff; machine enforcement (two-hour gate, append-only, required checks, administrators protected, no force push) is unaffected.
- **If a second collaborator joins**: raise required approvals to 1 (Settings → Branches → main → Require 1 approval) to restore mutual review strength.
- **Shadow run → formal period**: the site currently shows the SHADOW RUN banner; starting the formal period takes a single declaration commit (see DESIGN.md), from which the 90-day public-validation clock runs.

## Current evidence model

This project uses the **three-layer evidence model**: a public PR plus the GitHub-hosted Actions server event for the exact SHA is the first-layer publication witness; the complete ledger-state manifests plus OpenTimestamps/Bitcoin are the second-layer independent cryptographic timestamp; append-only correction chains with deterministic rebuilds are the third-layer provenance.

Published history is designed to make retrospective alteration detectable. Bitcoin-anchored manifests provide an independent cryptographic record of previously published ledger states. The serverless architecture greatly reduced the operational attack surface, but the system still depends on the GitHub account, Actions, Pages and OpenTimestamps.

## Architecture freeze record (2026-09-02, UTC)

After the three-layer evidence model was merged and passed freeze-acceptance, the **architecture is frozen**: no new features; the project enters the preparation phase for the formal 90-day public validation, which starts from a future declaration commit (see DESIGN.md).

Freeze-acceptance evidence (all publicly checkable GitHub measurements):

| Item | Evidence |
|---|---|
| Implementation merged | [PR #4](https://github.com/rosebellwau8/pattern-xi-ledger/pull/4) (merge commit `bd63909`); `Ledger integrity` passed on the exact head SHA |
| Real publication witness | [Check run 33628156164](https://github.com/rosebellwau8/pattern-xi-ledger/actions/runs/33628156164/job/100240744760): for head `b13803a45c35e`, the `Ledger integrity` job's server-side `startedAt` = `2026-09-02T12:06:55Z`; repository visibility, run head SHA and job time all cross-checked via the API |
| Anchoring rehearsal | [Anchor manifest run 33628289788](https://github.com/rosebellwau8/pattern-xi-ledger/actions/runs/33628289788): the `anchors` branch produced the first v2 complete snapshot `manifests/2026-09-02.txt` (`main_commit_sha bd63909de1e5`, `previous_manifest_sha256 NONE`, `pick_count 0`) with its `.ots` receipt; Bitcoin confirmation is asynchronous by OpenTimestamps design and completed by the weekly `ots upgrade` |
| Local verification | 33 tests, typecheck, `validate`, deterministic derived rebuild (no-op) and deterministic site build all passed; the overclaim sweep found no leftovers |
| Branch protection re-check | Measured via the GitHub API: required check `Ledger integrity` (strict), administrators included, no force pushes, no deletions, PR + 0 approvals — matching the finalised table above |
| Site deployment | Pages deployed `bd63909` successfully; <https://rosebellwau8.github.io/pattern-xi-ledger/> measured serving the English three-layer-model content over enforced HTTPS |
