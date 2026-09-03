# Launch and architecture transition record

## Current status

The formal 90-day public validation window has not started. On 2026-09-03, before any formal pick entered that window, the owner approved replacing the rehearsed three-layer evidence architecture with the Lean Trust V1 model documented in [DESIGN.md](DESIGN.md).

Current admission rules are defined only by [CONVENTIONS.md](CONVENTIONS.md):

- public X receipt or salted subscriber-batch commitment;
- at least two hours before kickoff;
- append-only authoritative inputs and evidence;
- deterministic Settlement Rules v1 and standings;
- static site and machine-readable public export.

## Superseded rehearsal

On 2026-09-02 the repository successfully rehearsed an earlier architecture based on:

- an exact public PR head SHA;
- GitHub Actions job `startedAt` as the two-hour witness;
- daily full-state manifests;
- OpenTimestamps/Bitcoin anchoring on an `anchors` branch.

That rehearsal established that the heavier mechanism could operate, but it was retired before the formal run because its daily complexity was disproportionate to the product stage. Its commits, PRs, Actions runs and historical `anchors` branch remain in GitHub history; they are historical evidence, not the current publication rule.

The repository history was not rewritten. Removing the mandatory workflow and current public claims does not assert that those historical events never occurred.

## Current operating sequence

### Public picks

1. Generate eligible canonical picks with `npm run publish -- --dry-run <export>`.
2. Publish the rendered complete recommendations on X.
3. Record the X status URLs and UTC times in a local receipt-input file.
4. Run `npm run publish -- <export> --receipts <receipt-input>`.
5. CI validates schemas, exact-byte hashes, the two-hour cutoff, append-only history and derived files before merge.

### Subscriber batches

1. Build an exact private batch using a random nonce.
2. Publish its ID, count, SHA-256 and earliest kickoff on X before the two-hour cutoff.
3. Append the public commitment file.
4. Deliver picks through the external subscriber channel.
5. After disclosure, append the exact reveal and canonical picks.
6. Record results and rebuild settlement, standings and the static site.

## Required repository protection

The protected `main` branch should continue to require the `Ledger integrity` check, block force pushes and block deletion. The required check no longer queries GitHub Actions for a publication timestamp; it verifies the lightweight publication evidence contained in the PR.

## Activation checklist

Before declaring the formal start instant:

- confirm the live X account name used in status URLs;
- run one non-counting public-pick rehearsal through dry-run, X post, receipt and PR;
- run one non-counting subscriber commitment/reveal rehearsal if paid batches will be used during the window;
- verify the generated site links to the public receipt and exposes `ledger.json`;
- run `npm test`, `npm run typecheck`, `npm run validate` and `npm run build`;
- set the formal start instant in the site projection with an explicit declaration commit.

No database, payment flow or automated social credential is required to begin the free 90-day public run.
