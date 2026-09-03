import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadPicks } from "../scripts/lib.mjs";
import {
  prepareSubscriberBatch,
  recordBatchCommitment,
  recordPublicReceipt,
  renderXPost,
  revealSubscriberBatch,
} from "../scripts/publication.mjs";
import { loadPublicationEvidence } from "../scripts/publication-evidence.mjs";

function root() {
  return mkdtempSync(join(tmpdir(), "pattern-xi-publication-command-"));
}

function pick() {
  return {
    schema: "pattern-xi.pick.v1",
    id: "2026-09-06-arsenal-chelsea-ah",
    match: "Arsenal v Chelsea",
    competition: "Premier League",
    kickoff_utc: "2026-09-06T16:30:00Z",
    market: "asian_handicap",
    selection: "AWAY",
    line: "+0.25",
    published_price: "0.96",
    published_price_format: "HONG_KONG_ODDS",
    normalized_decimal_price: "1.96",
    price_source: "Operator input",
  };
}

test("public receipt workflow renders restrained X copy and writes only after confirmation", () => {
  const directory = root();
  try {
    const current = pick();
    const pickPath = `picks/2026/${current.id}.json`;
    const prepared = prepareSubscriberBatch({ batch_id: "pxb-20260903-1600", picks: [current] }, {
      nonce: "11".repeat(32),
    });
    // The formatter is shared by both a normal public pick and a disclosed pick.
    const post = renderXPost(current);
    assert.match(post, /^2026-09-06-arsenal-chelsea-ah\n\nArsenal v Chelsea\nChelsea \+0\.25\n0\.96 HK/u);
    assert.match(post, /Kickoff 2026-09-06 16:30 UTC/u);
    assert.match(post, /Official Pick\nhttps:\/\/rosebellwau8\.github\.io\/pattern-xi-ledger\/picks\/2026-09-06-arsenal-chelsea-ah\.html/u);
    assert.equal(prepared.sha256.length, 64);

    // Install the public pick exactly as the production import does.
    const pickDirectory = join(directory, "picks/2026");
    mkdirSync(pickDirectory, { recursive: true });
    writeFileSync(join(directory, pickPath), `${JSON.stringify(current, null, 2)}\n`);

    const details = {
      url: "https://x.com/patternxi/status/1964280000000000000",
      publishedAt: "2026-09-06T14:30:00Z",
    };
    const dry = recordPublicReceipt(directory, pickPath, details, { dryRun: true });
    assert.equal(existsSync(join(directory, dry.relativePath)), false);
    const written = recordPublicReceipt(directory, pickPath, details);
    assert.equal(written.status, "WRITTEN");
    assert.equal(recordPublicReceipt(directory, pickPath, details).status, "UNCHANGED");
    assert.throws(
      () => recordPublicReceipt(directory, pickPath, { ...details, url: "https://x.com/patternxi/status/1964280000000000999" }),
      /conflicts with existing/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("subscriber batch workflow preserves exact committed bytes through reveal", () => {
  const directory = root();
  try {
    const current = pick();
    const prepared = prepareSubscriberBatch({ batch_id: "pxb-20260903-1600", picks: [current] }, {
      nonce: "22".repeat(32),
    });
    const privateFile = join(directory, "private-batch.json");
    writeFileSync(privateFile, prepared.bytes);
    assert.equal(prepared.data.nonce, "22".repeat(32));
    assert.equal(prepared.pickCount, 1);
    assert.equal(prepared.earliestKickoffUtc, current.kickoff_utc);

    const receipt = {
      url: "https://x.com/patternxi/status/1964280000000000001",
      publishedAt: "2026-09-06T14:30:00Z",
    };
    const commitment = recordBatchCommitment(directory, privateFile, receipt);
    assert.equal(commitment.status, "WRITTEN");
    const stored = JSON.parse(readFileSync(join(directory, commitment.relativePath), "utf8"));
    assert.equal(stored.batch_sha256, prepared.sha256);
    assert.equal(stored.pick_count, 1);

    const dry = revealSubscriberBatch(directory, privateFile, { dryRun: true });
    assert.equal(existsSync(join(directory, dry.revealPath)), false);
    const revealed = revealSubscriberBatch(directory, privateFile);
    assert.equal(revealed.writtenPicks.length, 1);
    assert.deepEqual(
      readFileSync(join(directory, revealed.revealPath)),
      readFileSync(privateFile),
      "reveal bytes must be exactly the committed bytes",
    );
    const evidence = loadPublicationEvidence(directory, loadPicks(directory), { requireEveryPick: true });
    assert.equal(evidence.commitments.get("pxb-20260903-1600").status, "REVEALED");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("batch preparation rejects weak nonce and reveal refuses modified bytes", () => {
  const directory = root();
  try {
    const source = { batch_id: "pxb-20260903-1600", picks: [pick()] };
    assert.throws(() => prepareSubscriberBatch(source, { nonce: "abcd" }), /nonce must be 64 lowercase hex/u);
    const prepared = prepareSubscriberBatch(source, { nonce: "33".repeat(32) });
    const privateFile = join(directory, "private-batch.json");
    writeFileSync(privateFile, prepared.bytes);
    recordBatchCommitment(directory, privateFile, {
      url: "https://x.com/patternxi/status/1964280000000000002",
      publishedAt: "2026-09-06T14:30:00Z",
    });
    writeFileSync(privateFile, `${prepared.bytes} `);
    assert.throws(() => revealSubscriberBatch(directory, privateFile), /do not match commitment/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
