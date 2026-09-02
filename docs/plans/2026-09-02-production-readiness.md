# Pattern XI Production Readiness Implementation Plan

> Historical plan. Manifest catch-up details below were superseded on 2026-09-02 by
> [Three-layer evidence model](2026-09-02-three-layer-evidence-model.md).

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver an aesthetically upgraded English static site, repair every audited ledger and anchoring defect, add convenient production-export ingestion, and release through the protected GitHub workflow.

**Architecture:** Keep the zero-dependency Node 24 static architecture. Add narrowly scoped pure helpers for result validation, import normalization, clean derived output, manifest catch-up, and site smoke checks; make workflows orchestrate those helpers rather than duplicating policy.

**Tech Stack:** Node.js 24 native TypeScript stripping, `node:test`, deterministic HTML/CSS generation, GitHub Actions, OpenTimestamps.

---

### Task 1: Freeze site requirements and smoke tests

**Files:**
- Modify: `scripts/build-site.mjs`
- Create: `tests/site.test.mjs`

1. Add failing tests for English metadata, upcoming-pick prominence, HTML escaping, nested-page navigation, no production pattern fields, deterministic output, and local-link integrity.
2. Run `node --test tests/site.test.mjs` and confirm the new assertions fail.
3. Refine the editorial design, responsive tables/tickets, focus states, empty states, and copy.
4. Re-run the site test and inspect desktop/mobile rendered pages.

### Task 2: Repair result and correction contracts

**Files:**
- Modify: `scripts/lib.mjs`
- Modify: `src/settlement/settlement-correction.ts`
- Modify: `tests/ledger.test.mjs`

1. Add regressions for completed postponed fixtures, resumed abandoned fixtures, mandatory correction reason/kind/evidence, sequential `.rN.json` naming, and note-only no-op rejection.
2. Run the focused ledger tests and confirm failure.
3. Extend the result allowlist and mapping without changing Settlement Rules v1 mathematics.
4. Run focused and full tests.

### Task 3: Make derived rebuilds exact

**Files:**
- Modify: `scripts/settle.mjs`
- Modify: `scripts/standings.mjs`
- Modify: `src/performance/performance-projection.ts`
- Modify: `tests/ledger.test.mjs`

1. Add tests proving stale settlement files are removed and corrected-to-pending heads do not crash.
2. Recreate `settlements/` from scratch on every CLI rebuild and project only the current settled head.
3. Run `npm run settle`, `npm run standings`, and the full suite.

### Task 4: Add production export ingestion

**Files:**
- Create: `scripts/import-production.mjs`
- Create: `tests/import-production.test.mjs`
- Modify: `package.json`
- Modify: `README.md`

1. Add tests using the supplied `production-public-export.v1` shape, including Unicode teams, Asia/Shanghai conversion, selection/line/price mapping, idempotency, conflict rejection, invalid deadlines, and stdin/file operation.
2. Implement `npm run import -- <export.json>` with a dry-run option and clear generated-file summary.
3. Ensure only final recommendation, handicap, price, fixture identity and required public source fields enter pick records.
4. Document the one-command handoff and practical publication cutoff.

### Task 5: Make anchoring complete and chronological (superseded)

**Files:**
- Modify: `scripts/manifest.mjs`
- Modify: `.github/workflows/stamp.yml`
- Create: `tests/manifest.test.mjs`

1. Historical implementation used incremental catch-up manifests.
2. The frozen design instead creates a complete pick-ledger snapshot for an exact `main` SHA on every manifest date.
3. Publication timing is independently bound to a public PR's exact SHA and the successful Actions job attempt `startedAt`.
4. Pin the OpenTimestamps client version and preserve receipt upgrade behaviour.

### Task 6: Align policy, tooling and repository hygiene

**Files:**
- Modify: `.github/workflows/check.yml`
- Modify: `.github/workflows/deploy-site.yml`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `CONVENTIONS.md`
- Modify: `LAUNCH.md`
- Delete: `ots/.gitkeep`

1. Add a CI site smoke test and remove contradictory one-approval documentation.
2. Correct publication-time wording: the public PR check is the server-side publication witness; Git commit timestamps are not.
3. Pin third-party Actions to immutable commit SHAs where verified.
4. Ignore local `.zcode/`, remove the unused `ots/` placeholder, and document remaining intentional limitations.

### Task 7: Full verification and protected release

1. Run `npm test`, coverage, validation, settlement, standings, build, link smoke tests, `git diff --check`, `git fsck`, and secret-pattern scanning.
2. Render desktop and mobile screenshots and inspect focus/navigation/overflow.
3. Commit cohesive changes, push `fix/production-readiness`, open a PR, and wait for required checks.
4. Merge through GitHub, verify `main`, Pages HTTP 200, branch protection, and a clean synchronized local worktree.
