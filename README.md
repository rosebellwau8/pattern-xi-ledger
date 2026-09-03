# Pattern XI — Public Picks Ledger

A public, prospective, auditable record of football Asian-handicap picks.

Pattern XI deliberately uses a lightweight trust model: public picks receive a third-party publication receipt on X; subscriber-only batches receive a salted SHA-256 commitment before kickoff and are revealed afterwards. Settlement and standings remain deterministic and rebuildable from the public ledger.

**Live site:** <https://rosebellwau8.github.io/pattern-xi-ledger/>

## What the ledger establishes

1. **Public picks have a public receipt.** The complete recommendation is posted on X. A receipt file records the canonical status URL, the X publication time and the SHA-256 of the exact pick-file bytes. The receipt must be at least two hours before kickoff.
2. **Subscriber batches commit before disclosure.** A private exact-byte JSON batch includes a random 256-bit nonce. Its SHA-256, count and earliest kickoff are posted publicly before the two-hour cutoff. The exact file is revealed after the event.
3. **History is append-only in normal operation.** Picks, results, receipts, commitments and reveals cannot be edited, deleted or renamed through the protected PR workflow. Result corrections append a new hash-linked revision.
4. **Conclusions are computed.** Results contain facts only. Classification and net return come from Settlement Rules v1 and its 52-case golden regression.
5. **The record is portable.** The static site publishes `ledger.json`; settlements and standings can also be rebuilt locally from the source files.

X is a public, third-party publication receipt—not an immutable timestamp. X posts may be deleted, and CI validates the recorded URL, time, cutoff and exact-byte binding without claiming to authenticate X itself.

## Repository layout

```text
picks/YYYY/<id>.json
    Canonical public picks. Subscriber picks are added after their batch reveal.

publication/receipts/YYYY/<id>.json
    X URL, X publication time and exact pick-file SHA-256 for a public pick.

publication/commitments/YYYY/<batch-id>.json
    Public metadata for a subscriber batch: count, earliest kickoff, hash and X receipt.

publication/reveals/YYYY/<batch-id>.json
    The exact salted batch bytes disclosed after the event.

results/YYYY/<id>.json
    Append-only result facts and hash-linked corrections.

settlements/YYYY/<id>.json
standings/standings.json
    Deterministic projections generated from picks and results.

site-dist/
    Generated static HTML, `ledger.json` and disclosed batch files.
```

## Everyday commands

Node.js 24 or newer is required. There are zero runtime dependencies.

```bash
npm test
npm run typecheck
npm run validate
npm run settle
npm run standings
npm run build
```

### Publish a public pick

First preview an eligible production export and render the exact restrained X copy:

```bash
npm run publish -- --dry-run production-public-export.json
```

Post each rendered recommendation on X. Then create a local receipt-input file:

```json
{
  "schema": "pattern-xi.publication-receipts-input.v1",
  "receipts": [
    {
      "pick_id": "2026-09-06-arsenal-chelsea-ah",
      "url": "https://x.com/patternxi/status/1234567890",
      "published_at": "2026-09-06T14:30:00Z"
    }
  ]
}
```

Complete the existing automated branch/PR handoff with those receipts:

```bash
npm run publish -- production-public-export.json --receipts publication-receipts-input.json
```

The input file is operational handoff data and should not be committed. The command imports the canonical picks, creates exact-byte receipt records, validates everything, pushes a branch and opens the PR. A missing, late, malformed or duplicate receipt fails closed.

For an already imported local pick, the lower-level commands are:

```bash
npm run publication -- render picks/2026/<pick-id>.json
npm run publication -- record picks/2026/<pick-id>.json \
  --url https://x.com/patternxi/status/<status-id> \
  --published-at 2026-09-06T14:30:00Z
```

### Commit and reveal a subscriber batch

Prepare a private source file containing `batch_id` and full canonical pick objects. The command generates a cryptographically random nonce unless an explicit nonce is supplied for testing:

```bash
npm run publication -- batch-prepare subscriber-source.json private-batch.json
```

Keep `private-batch.json` outside the public repository until disclosure. Post the printed batch ID, count, SHA-256 and earliest kickoff on X, then record that public receipt:

```bash
npm run publication -- batch-commit private-batch.json \
  --url https://x.com/patternxi/status/<status-id> \
  --published-at 2026-09-03T16:04:00Z
```

After disclosure is allowed:

```bash
npm run publication -- batch-reveal private-batch.json
```

The reveal command verifies the exact committed bytes before appending the reveal and its picks. It refuses conflicting existing picks, modified batch bytes or duplicate publication evidence.

## Verify it yourself

```bash
git clone https://github.com/rosebellwau8/pattern-xi-ledger.git
cd pattern-xi-ledger

# Public pick: inspect the external receipt and exact-byte binding.
cat publication/receipts/2026/<pick-id>.json
sha256sum picks/2026/<pick-id>.json

# Subscriber batch: hash the exact disclosed file and compare the commitment.
sha256sum publication/reveals/2026/<batch-id>.json
cat publication/commitments/2026/<batch-id>.json

# Validate and rebuild all conclusions.
npm ci
npm run validate
npm run settle
npm run standings
git diff --exit-code -- settlements standings
```

## Honest limitations

- A linked X status is independently visible but can be deleted. It is not described as immutable or as a cryptographic timestamp.
- CI does not call the X API. It validates the recorded metadata and exact-byte relationships; an auditor checks the linked platform post and displayed time.
- Scores, prices and receipt times are operator-entered facts. The public sources make misstatement detectable; they do not make operator input infallible.
- GitHub remains the public code/data host and Pages deployment platform. The repository does not contain a database, business backend, payment system, subscriber list or social-platform credential.
- OpenTimestamps and daily manifest chains are no longer required for formal admission. They may be used later as an optional periodic backup without changing the per-pick publication rule.

See [CONVENTIONS.md](CONVENTIONS.md) for formal rules and [DESIGN.md](DESIGN.md) for the trust boundary.
