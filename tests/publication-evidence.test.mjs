import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { loadPicks } from "../scripts/lib.mjs";
import {
  BATCH_SCHEMA,
  COMMITMENT_SCHEMA,
  RECEIPT_SCHEMA,
  loadPublicationEvidence,
} from "../scripts/publication-evidence.mjs";

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "pattern-xi-publication-evidence-"));
}

function writeJson(root, relativePath, value) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function samplePick(id = "2026-09-06-arsenal-chelsea-ah", kickoff = "2026-09-06T16:30:00Z") {
  return {
    schema: "pattern-xi.pick.v1",
    id,
    match: "Arsenal v Chelsea",
    competition: "Premier League",
    kickoff_utc: kickoff,
    market: "asian_handicap",
    selection: "AWAY",
    line: "+0.25",
    published_price: "0.96",
    published_price_format: "HONG_KONG_ODDS",
    normalized_decimal_price: "1.96",
    price_source: "Operator input",
  };
}

function writePick(root, pick = samplePick()) {
  return writeJson(root, `picks/${pick.id.slice(0, 4)}/${pick.id}.json`, pick);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function publicReceipt(pick, pickHash, patch = {}) {
  return {
    schema: RECEIPT_SCHEMA,
    pick_id: pick.id,
    channel: "X",
    url: "https://x.com/patternxi/status/1964280000000000000",
    published_at: "2026-09-06T14:30:00Z",
    pick_sha256: pickHash,
    ...patch,
  };
}

test("an X receipt binds exact pick bytes and accepts the two-hour equality boundary", () => {
  const root = makeRoot();
  try {
    const pick = samplePick();
    const pickFile = writePick(root, pick);
    writeJson(root, `publication/receipts/2026/${pick.id}.json`, publicReceipt(pick, sha256(pickFile)));

    const evidence = loadPublicationEvidence(root, loadPicks(root), { requireEveryPick: true });
    assert.equal(evidence.receipts.get(pick.id).data.published_at, "2026-09-06T14:30:00Z");
    assert.equal(evidence.pickEvidence.get(pick.id).type, "PUBLIC_RECEIPT");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("public receipts fail closed for late time, wrong bytes, malformed URL, and unknown fields", () => {
  for (const [name, patch, expected] of [
    ["late", { published_at: "2026-09-06T14:30:00.001Z" }, /at least 2 hours/u],
    ["hash", { pick_sha256: "0".repeat(64) }, /does not match exact bytes/u],
    ["url", { url: "https://example.com/status/1964280000000000000" }, /canonical X status URL/u],
    ["unknown", { extra: true }, /unknown field/u],
  ]) {
    const root = makeRoot();
    try {
      const pick = samplePick();
      const pickFile = writePick(root, pick);
      writeJson(root, `publication/receipts/2026/${pick.id}.json`, publicReceipt(pick, sha256(pickFile), patch));
      assert.throws(
        () => loadPublicationEvidence(root, loadPicks(root), { requireEveryPick: true }),
        expected,
        name,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a formal pick without a public receipt or revealed batch is rejected", () => {
  const root = makeRoot();
  try {
    const pick = samplePick();
    writePick(root, pick);
    assert.throws(
      () => loadPublicationEvidence(root, loadPicks(root), { requireEveryPick: true }),
      /has no publication evidence/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function subscriberBatch(picks, patch = {}) {
  return {
    schema: BATCH_SCHEMA,
    batch_id: "pxb-20260903-1600",
    nonce: "a1".repeat(32),
    picks,
    ...patch,
  };
}

function commitmentFor(path, patch = {}) {
  return {
    schema: COMMITMENT_SCHEMA,
    batch_id: "pxb-20260903-1600",
    pick_count: 1,
    earliest_kickoff_utc: "2026-09-06T16:30:00Z",
    batch_sha256: sha256(path),
    receipt: {
      channel: "X",
      url: "https://x.com/patternxi/status/1964280000000000001",
      published_at: "2026-09-06T14:30:00Z",
    },
    ...patch,
  };
}

test("a salted exact-byte subscriber batch reveal becomes publication evidence", () => {
  const root = makeRoot();
  try {
    const pick = samplePick();
    writePick(root, pick);
    const reveal = writeJson(
      root,
      "publication/reveals/2026/pxb-20260903-1600.json",
      subscriberBatch([pick]),
    );
    writeJson(
      root,
      "publication/commitments/2026/pxb-20260903-1600.json",
      commitmentFor(reveal),
    );

    const evidence = loadPublicationEvidence(root, loadPicks(root), { requireEveryPick: true });
    assert.equal(evidence.commitments.size, 1);
    assert.equal(evidence.pickEvidence.get(pick.id).type, "SUBSCRIBER_BATCH");
    assert.equal(evidence.pickEvidence.get(pick.id).batchId, "pxb-20260903-1600");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pending commitments are valid evidence records but do not admit undisclosed picks", () => {
  const root = makeRoot();
  try {
    const bytes = Buffer.from("not-yet-public exact batch bytes");
    const hash = createHash("sha256").update(bytes).digest("hex");
    writeJson(root, "publication/commitments/2026/pxb-20260903-1600.json", {
      ...commitmentFor(writeJson(root, "tmp/hash-source.json", { placeholder: true })),
      batch_sha256: hash,
      pick_count: 10,
    });
    rmSync(join(root, "tmp"), { recursive: true, force: true });

    const evidence = loadPublicationEvidence(root, loadPicks(root), { requireEveryPick: true });
    assert.equal(evidence.commitments.get("pxb-20260903-1600").status, "COMMITTED");
    assert.equal(evidence.pickEvidence.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("subscriber commitments reject tampering, weak nonce, wrong metadata, and duplicate pick evidence", () => {
  for (const [name, mutate, expected] of [
    ["tamper", ({ reveal }) => writeFileSync(reveal, `${readFileSync(reveal, "utf8")} `), /does not match exact reveal bytes/u],
    ["nonce", ({ root, pick, reveal }) => writeJson(root, "publication/reveals/2026/pxb-20260903-1600.json", subscriberBatch([pick], { nonce: "abcd" })), /nonce must be 64 lowercase hex/u],
    ["count", ({ root, commitment }) => writeJson(root, "publication/commitments/2026/pxb-20260903-1600.json", { ...commitment, pick_count: 2 }), /pick_count 2 does not match reveal count 1/u],
    ["earliest", ({ root, commitment }) => writeJson(root, "publication/commitments/2026/pxb-20260903-1600.json", { ...commitment, earliest_kickoff_utc: "2026-09-07T16:30:00Z" }), /earliest_kickoff_utc does not match/u],
    ["late", ({ root, commitment }) => writeJson(root, "publication/commitments/2026/pxb-20260903-1600.json", { ...commitment, receipt: { ...commitment.receipt, published_at: "2026-09-06T14:30:00.001Z" } }), /at least 2 hours/u],
    ["duplicate", ({ root, pick, pickFile }) => writeJson(root, `publication/receipts/2026/${pick.id}.json`, publicReceipt(pick, sha256(pickFile))), /has competing publication evidence/u],
  ]) {
    const root = makeRoot();
    try {
      const pick = samplePick();
      const pickFile = writePick(root, pick);
      const reveal = writeJson(root, "publication/reveals/2026/pxb-20260903-1600.json", subscriberBatch([pick]));
      const commitment = commitmentFor(reveal);
      writeJson(root, "publication/commitments/2026/pxb-20260903-1600.json", commitment);
      mutate({ root, pick, pickFile, reveal, commitment });
      assert.throws(
        () => loadPublicationEvidence(root, loadPicks(root), { requireEveryPick: true }),
        expected,
        name,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("revealed pick facts must exactly match the canonical ledger pick", () => {
  const root = makeRoot();
  try {
    const pick = samplePick();
    writePick(root, pick);
    const disclosed = { ...pick, line: "+0.50" };
    const reveal = writeJson(root, "publication/reveals/2026/pxb-20260903-1600.json", subscriberBatch([disclosed]));
    writeJson(root, "publication/commitments/2026/pxb-20260903-1600.json", commitmentFor(reveal));
    assert.throws(
      () => loadPublicationEvidence(root, loadPicks(root), { requireEveryPick: true }),
      /does not match canonical ledger pick/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
