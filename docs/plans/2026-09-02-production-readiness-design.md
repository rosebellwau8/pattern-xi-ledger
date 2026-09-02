# Pattern XI Production Readiness Design

## Product and visual direction

Pattern XI is an English-language public ledger for readers in English-speaking markets. The site should feel like an independent British football paper rather than a generic dashboard: warm newsprint, ink-black typography, a restrained racing-green accent, strong editorial hierarchy, and compact market tickets. The memorable element is the contrast between an old-world newspaper voice and exact machine-generated betting data. It remains a static, zero-JavaScript site with no webfonts or network dependencies.

The primary journey is: arrive, see the next published selections immediately, understand team/side/Asian-handicap line/price, then inspect the complete record if desired. Audit explanations and Bitcoin anchoring remain available, but no longer dominate the homepage. Pattern history, internal notes, production metadata, and reasoning are never rendered. Empty, pending, void, corrected, and settled states must remain legible on desktop and mobile. Dark mode, visible keyboard focus, reduced motion, semantic landmarks, tables with captions, and sufficient contrast are part of the design rather than later add-ons.

## Data and publishing architecture

Production exports stay separate from the public ledger. A local import command accepts the existing `production-public-export.v1` JSON, validates every match, converts the declared local kickoff to UTC, maps 主队/客队 to HOME/AWAY, treats `recommended_water_raw` as Hong Kong odds, derives the normalized decimal price, and writes canonical `pattern-xi.pick.v1` files. Stable public IDs are derived from immutable fixture facts because the current export has no provider fixture ID. Re-importing identical data is idempotent; conflicting output fails closed. Only the final selection, handicap and price cross the boundary.

Results remain append-only facts. The result contract is extended so completed postponed and resumed fixtures can carry scores, and corrections must declare a supported correction kind and a non-empty reason. Evidence references are required for source/official/administrative corrections. Derived settlement output is rebuilt from a clean directory so stale files cannot survive. Performance projection treats a corrected-to-pending head as pending while retaining history without crashing.

Anchoring changes from “today only” to “all unanchored publication dates in chronological order.” Publication-date grouping uses the GitHub pull-request merge time when available, with a deterministic local fallback for tests; the workflow passes the server event time explicitly. This prevents late-UTC picks from being skipped and preserves manifest chaining.

## Verification and release

Every defect receives a regression test before implementation. Coverage includes special result states, correction metadata, note-only corrections, stale derived files, pending heads, import idempotency/conflicts, time-zone conversion, manifest catch-up, HTML escaping, local links, responsive structure, and deterministic builds. CI runs tests, ledger validation, a clean derived rebuild, the production-export validator tests, and a static-site smoke test.

The release uses the existing protected-main workflow: commit on `fix/production-readiness`, push, open a pull request, wait for `Ledger integrity`, then merge. The local working tree must be clean afterward and Pages must return HTTP 200 with the new masthead and data-first homepage. Repository documentation is updated to match solo-maintainer approval=0, the production import command, accurate publication semantics, and the corrected anchors-branch verification instructions.

