# Ledger Rules

These are the formal operating rules for the current Pattern XI ledger. Rule changes are public repository changes; they never retroactively change old settlements.

## 1. Formal admission

- Market scope is full-match Asian handicap only. Selection is `HOME` or `AWAY`; stake is one unit.
- Every formal pick must have exactly one publication-evidence route:
  - `PUBLIC_RECEIPT`: the complete pick was posted publicly on X; or
  - `SUBSCRIBER_BATCH`: the later-disclosed pick was included in a salted batch committed publicly on X.
- The X publication time recorded in that evidence must be at least two hours before kickoff. `kickoff - published_at >= 2h`; equality passes.
- A failed, missing, deleted or late social post must not be silently backdated. If the external receipt cannot be publicly checked, the claimed evidence is weakened and should be disclosed rather than replaced.
- X is a third-party public receipt, not an immutable or cryptographic timestamp. CI validates the stored URL, UTC value, cutoff and hashes; an auditor compares the stored metadata with the linked X page.
- Git author and committer dates are never publication evidence.
- **Full-disclosure obligation:** every pick actually tipped or staked must enter the record. Code cannot prove completeness; the public batch counts, delivery process and reputation make omissions discoverable.

## 2. Public pick records

The canonical pick path is:

```text
picks/<kickoff-year>/<pick-id>.json
```

The ID starts with the kickoff UTC date and the filename must match the ID. Unknown fields fail closed. The schema requires:

- competition and match;
- frozen UTC kickoff;
- Asian handicap market and HOME/AWAY selection;
- whole, half or quarter line;
- published price and price format;
- normalized decimal price greater than one;
- operator-declared price source.

A public receipt lives at:

```text
publication/receipts/<year>/<pick-id>.json
```

It must use a canonical `https://x.com/<account>/status/<numeric-id>` URL and its `pick_sha256` must equal the SHA-256 of the pick file's exact bytes.

## 3. Subscriber batches

Batch IDs use:

```text
pxb-YYYYMMDD-HHMM[-suffix]
```

The private batch file uses `pattern-xi.subscriber-batch.v1`, contains a random 256-bit nonce and stores full canonical pick objects sorted by ID. The exact file is the commitment preimage.

The public commitment lives at:

```text
publication/commitments/<year>/<batch-id>.json
```

It records:

- batch ID;
- positive pick count;
- earliest frozen kickoff;
- exact-byte SHA-256;
- X URL and platform publication time.

The receipt must precede the earliest kickoff by at least two hours. A commitment may exist without a reveal. It does not admit undisclosed picks into standings.

At disclosure, the original exact bytes are copied to:

```text
publication/reveals/<year>/<batch-id>.json
```

Validation rejects a wrong hash, weak nonce, count mismatch, earliest-kickoff mismatch, unsorted or duplicate picks, unknown fields, a pick that differs from its canonical ledger file, or competing evidence.

## 4. Append-only history

Normal pull requests may add, but may not modify, delete or rename:

```text
picks/**/*.json
results/**/*.json
publication/receipts/**/*.json
publication/commitments/**/*.json
publication/reveals/**/*.json
```

Pick records are quotations of what was tipped and are not corrected in place. Result mistakes use an append-only revision.

## 5. Result corrections

The first result is `results/<year>/<pick-id>.json`. Corrections are `<pick-id>.rN.json`, with consecutive revision numbers.

`corrects` is the SHA-256 of the corrected file's exact bytes. Chains must be linear and unforked. A correction needs a non-empty reason and one of:

1. `SOURCE_DATA_ERROR` — transcription/source error; evidence required.
2. `SETTLEMENT_LOGIC_ERROR` — engine/rule application error.
3. `OFFICIAL_RESULT_CORRECTION` — authoritative score revision; evidence required.
4. `ADMINISTRATIVE_RESULT_CHANGE` — later administrative reclassification; evidence required.

Except for `SETTLEMENT_LOGIC_ERROR`, `evidence_refs` must contain at least one source. A non-logic correction must change result facts.

## 6. Settlement Rules v1

Result files contain facts only. Humans do not type classifications or returns. The frozen engine determines:

```text
WIN
HALF_WIN
PUSH
HALF_LOSS
LOSS
VOID
```

It uses exact decimal arithmetic, three-decimal ROUND_HALF_UP output, frozen kickoff/lifecycle rules and the 52-case golden dataset. A rules change requires a new version and must not retroactively rewrite historical output.

## 7. Derived-file discipline

`settlements/`, `standings/` and `site-dist/` are projections. Rebuilding from the authoritative inputs must be deterministic.

```bash
npm run validate
npm run settle
npm run standings
npm run build
```

CI rejects stale committed settlements or standings. The static site publishes a deterministic `ledger.json` export; neither the site nor that export is an input to settlement.

## 8. Operational files and secrets

Private subscriber batch files, batch source files and receipt-input handoff files must remain outside the tracked repository. The provided default filenames are ignored by Git. X, Telegram, newsletter, payment and membership credentials must never be placed in public JSON, generated HTML or repository history.
