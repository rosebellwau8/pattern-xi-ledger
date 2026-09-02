# Three-layer Evidence Model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align publication timing, Bitcoin manifests, and all public claims around one precise three-layer evidence model without changing result or price evidence.

**Architecture:** A successful public pull-request workflow run is the publication witness for its exact head SHA; its GitHub-controlled run creation time is the timestamp used by the two-hour gate. Nightly manifests become immutable versioned snapshots containing the corresponding `main` commit SHA, the previous manifest hash, and every formal pick path/hash in that `main` state. Append-only correction validation and deterministic projections remain unchanged.

**Tech Stack:** Node.js 24, `node:test`, GitHub Actions, GitHub REST API/CLI, OpenTimestamps, deterministic static HTML.

---

### Task 1: Bind the publication gate to a GitHub event and exact PR head

**Files:**
- Modify: `.github/workflows/check.yml`
- Modify: `scripts/validate-pr.mjs`
- Test: `tests/ledger.test.mjs`

1. Add failing tests for explicit witness-time parsing and exact head-SHA binding.
2. Make the PR workflow check public repository visibility and obtain the workflow run `created_at` and `head_sha` from GitHub's API.
3. Check out and validate the exact PR head SHA; pass the server timestamp and expected SHA to `validate-pr.mjs`.
4. Preserve the existing two-hour and append-only rules, then run the narrow ledger tests.

### Task 2: Replace incremental manifests with complete ledger-state snapshots

**Files:**
- Modify: `scripts/manifest.mjs`
- Modify: `.github/workflows/stamp.yml`
- Test: `tests/manifest.test.mjs`

1. Replace incremental-manifest tests with version, main SHA, previous hash, complete pick set, idempotency, and chronology tests.
2. Emit every formal pick path and SHA-256 in every manifest, including picks present in previous manifests.
3. Include the exact 40/64-character `main` commit SHA and previous manifest byte hash.
4. Pass `origin/main` explicitly from the anchor workflow and retain the daily cron/receipt upgrade flow.

### Task 3: Align all public explanations

**Files:**
- Modify: `README.md`
- Modify: `CONVENTIONS.md`
- Modify: `DESIGN.md`
- Modify: `LAUNCH.md`
- Modify: `package.json`
- Modify: `scripts/build-site.mjs`
- Test: `tests/site.test.mjs`

1. Add site assertions for “Three-layer evidence model,” exact-SHA PR witness, full-state OTS role, and cautious alteration claims.
2. Remove merge-as-publication, Git-commit-as-server-time, incremental-manifest, triple-anchor, absolute immutability, and eliminated-attack-surface claims.
3. State consistently that merge admits an already public and validated exact version to the formal ledger.
4. Leave operator-entered scores and prices, their schemas, and their evidence workflow unchanged.

### Task 4: Freeze-candidate verification and release

**Files:**
- Create: `tests/evidence-flow.test.mjs`
- Modify: `LAUNCH.md`

1. Exercise a synthetic pick in a temporary ledger through the two-hour gate, merge-state manifest, OpenTimestamps input, settlement, standings, and site build without adding it to the formal record.
2. Run typecheck, all tests, ledger validation, deterministic derived rebuild, site build, text-consistency searches, and security/supply-chain checks.
3. Commit and push a feature branch; open a public PR and require `Ledger integrity` on the exact final SHA.
4. Merge, run the anchor workflow, verify the generated complete-state manifest/OTS handling, confirm branch protection, and confirm the English Pages deployment over HTTPS.
5. Record the evidence URLs and declare the architecture frozen for 90-day public validation preparation.
