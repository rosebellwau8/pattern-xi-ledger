// Lightweight publication evidence for the public ledger.
//
// Public picks use an X status as a human-verifiable third-party receipt. The
// receipt binds that URL and its platform timestamp to the exact bytes of the
// canonical pick file. Subscriber-only picks use a public salted batch
// commitment; after disclosure, the exact reveal bytes and every pick are
// checked against the commitment and the canonical ledger.

import { isDeepStrictEqual } from "node:util";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

import {
  LedgerError,
  parseUtcStamp,
  sha256File,
  validatePickObject,
} from "./lib.mjs";

export const RECEIPT_SCHEMA = "pattern-xi.publication-receipt.v1";
export const COMMITMENT_SCHEMA = "pattern-xi.batch-commitment.v1";
export const BATCH_SCHEMA = "pattern-xi.subscriber-batch.v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const NONCE = /^[0-9a-f]{64}$/u;
const BATCH_ID = /^pxb-(\d{4})\d{4}-\d{4}(?:-[a-z0-9]+)*$/u;
const TWO_HOURS = 2 * 60 * 60 * 1000;

function fail(message) {
  throw new LedgerError(message);
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a JSON object`);
  }
  return value;
}

function requireString(data, key, label) {
  const value = data[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function checkNoExtras(data, allowed, label) {
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) fail(`${label} has unknown field "${key}"`);
  }
}

function readJson(absolutePath, relativePath) {
  let raw;
  try {
    raw = readFileSync(absolutePath, "utf8");
  } catch (error) {
    fail(`cannot read ${relativePath}: ${error.message}`);
  }
  try {
    return { data: JSON.parse(raw), raw };
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

function jsonFilesUnder(root, directory) {
  const absoluteDirectory = join(root, directory);
  let entries;
  try {
    entries = readdirSync(absoluteDirectory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...jsonFilesUnder(root, relativePath));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(join(root, relativePath));
    else if (entry.isFile() && entry.name !== ".gitkeep") {
      fail(`unexpected non-JSON file in ${directory}: ${entry.name}`);
    }
  }
  return files.sort();
}

function relative(root, absolutePath) {
  return absolutePath.slice(root.length + 1).replaceAll(sep, "/");
}

function validateXUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} must be a canonical X status URL`);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "x.com"
    || parts.length !== 3 || !/^[A-Za-z0-9_]{1,15}$/u.test(parts[0] ?? "")
    || parts[1] !== "status" || !/^\d+$/u.test(parts[2] ?? "")
    || url.search !== "" || url.hash !== "") {
    fail(`${label} must be a canonical X status URL such as https://x.com/patternxi/status/123`);
  }
  return value;
}

function validateTwoHourReceipt(publishedAt, kickoffEpoch, label) {
  const publishedEpoch = parseUtcStamp(publishedAt, `${label}.published_at`);
  if (kickoffEpoch - publishedEpoch < TWO_HOURS) {
    fail(`${label} must be published at least 2 hours before kickoff`);
  }
  return publishedEpoch;
}

export function validateReceiptObject(data, label, relativePath, picks) {
  requireObject(data, label);
  if (data.schema !== RECEIPT_SCHEMA) fail(`${label}.schema must be "${RECEIPT_SCHEMA}"`);
  checkNoExtras(data, ["schema", "pick_id", "channel", "url", "published_at", "pick_sha256"], label);
  const pickId = requireString(data, "pick_id", label);
  const pick = picks.get(pickId);
  if (pick === undefined) fail(`${label} references unknown pick ${pickId}`);
  const expectedPath = `publication/receipts/${pickId.slice(0, 4)}/${pickId}.json`;
  if (relativePath !== undefined && relativePath !== expectedPath) {
    fail(`${label} path must be ${expectedPath}, found ${relativePath}`);
  }
  if (data.channel !== "X") fail(`${label}.channel must be "X"`);
  validateXUrl(requireString(data, "url", label), `${label}.url`);
  validateTwoHourReceipt(requireString(data, "published_at", label), pick.kickoffEpoch, label);
  const hash = requireString(data, "pick_sha256", label);
  if (!SHA256.test(hash)) fail(`${label}.pick_sha256 must be a lowercase sha256 hex string`);
  const actualHash = sha256File(pick.absolutePath);
  if (hash !== actualHash) fail(`${label}.pick_sha256 does not match exact bytes of ${pick.path}`);
  return { pickId, data, relativePath };
}

function validateCommitmentReceipt(data, label, earliestKickoffEpoch) {
  requireObject(data, label);
  checkNoExtras(data, ["channel", "url", "published_at"], label);
  if (data.channel !== "X") fail(`${label}.channel must be "X"`);
  validateXUrl(requireString(data, "url", label), `${label}.url`);
  validateTwoHourReceipt(
    requireString(data, "published_at", label),
    earliestKickoffEpoch,
    label,
  );
}

export function validateCommitmentObject(data, label, relativePath) {
  requireObject(data, label);
  if (data.schema !== COMMITMENT_SCHEMA) fail(`${label}.schema must be "${COMMITMENT_SCHEMA}"`);
  checkNoExtras(data, [
    "schema", "batch_id", "pick_count", "earliest_kickoff_utc", "batch_sha256", "receipt",
  ], label);
  const batchId = requireString(data, "batch_id", label);
  const match = BATCH_ID.exec(batchId);
  if (match === null) fail(`${label}.batch_id must look like pxb-20260903-1600`);
  const expectedPath = `publication/commitments/${match[1]}/${batchId}.json`;
  if (relativePath !== undefined && relativePath !== expectedPath) {
    fail(`${label} path must be ${expectedPath}, found ${relativePath}`);
  }
  if (!Number.isInteger(data.pick_count) || data.pick_count <= 0) {
    fail(`${label}.pick_count must be a positive integer`);
  }
  const earliestText = requireString(data, "earliest_kickoff_utc", label);
  const earliestKickoffEpoch = parseUtcStamp(earliestText, `${label}.earliest_kickoff_utc`);
  const hash = requireString(data, "batch_sha256", label);
  if (!SHA256.test(hash)) fail(`${label}.batch_sha256 must be a lowercase sha256 hex string`);
  validateCommitmentReceipt(data.receipt, `${label}.receipt`, earliestKickoffEpoch);
  return { batchId, year: match[1], earliestKickoffEpoch, data, relativePath };
}

export function validateBatchObject(data, label, relativePath) {
  requireObject(data, label);
  if (data.schema !== BATCH_SCHEMA) fail(`${label}.schema must be "${BATCH_SCHEMA}"`);
  checkNoExtras(data, ["schema", "batch_id", "nonce", "picks"], label);
  const batchId = requireString(data, "batch_id", label);
  const match = BATCH_ID.exec(batchId);
  if (match === null) fail(`${label}.batch_id must look like pxb-20260903-1600`);
  const expectedPath = `publication/reveals/${match[1]}/${batchId}.json`;
  if (relativePath !== undefined && relativePath !== expectedPath) {
    fail(`${label} path must be ${expectedPath}, found ${relativePath}`);
  }
  const nonce = requireString(data, "nonce", label);
  if (!NONCE.test(nonce)) fail(`${label}.nonce must be 64 lowercase hex characters (256 random bits)`);
  if (!Array.isArray(data.picks) || data.picks.length === 0) fail(`${label}.picks must be a non-empty array`);

  const ids = [];
  const validated = [];
  for (const [index, pick] of data.picks.entries()) {
    const pickLabel = `${label}.picks[${index}]`;
    const info = validatePickObject(pick, pickLabel);
    if (ids.includes(info.id)) fail(`${label} contains duplicate pick ${info.id}`);
    ids.push(info.id);
    validated.push({ data: pick, ...info });
  }
  const sorted = [...ids].sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(ids, sorted)) fail(`${label}.picks must be sorted by id`);
  const earliest = validated.reduce((current, pick) =>
    pick.kickoffEpoch < current.kickoffEpoch ? pick : current);
  return { batchId, year: match[1], picks: validated, earliest, data, relativePath };
}

export function loadPublicationEvidence(root, picks, { requireEveryPick = false } = {}) {
  const receipts = new Map();
  const commitments = new Map();
  const reveals = new Map();
  const pickEvidence = new Map();

  for (const absolutePath of jsonFilesUnder(root, "publication/receipts")) {
    const relativePath = relative(root, absolutePath);
    const { data } = readJson(absolutePath, relativePath);
    const receipt = validateReceiptObject(data, relativePath, relativePath, picks);
    if (receipts.has(receipt.pickId)) fail(`duplicate publication receipt for ${receipt.pickId}`);
    receipts.set(receipt.pickId, receipt);
    pickEvidence.set(receipt.pickId, { type: "PUBLIC_RECEIPT", receipt });
  }

  for (const absolutePath of jsonFilesUnder(root, "publication/commitments")) {
    const relativePath = relative(root, absolutePath);
    const { data } = readJson(absolutePath, relativePath);
    const commitment = validateCommitmentObject(data, relativePath, relativePath);
    if (commitments.has(commitment.batchId)) fail(`duplicate batch commitment ${commitment.batchId}`);
    commitments.set(commitment.batchId, { ...commitment, status: "COMMITTED" });
  }

  for (const absolutePath of jsonFilesUnder(root, "publication/reveals")) {
    const relativePath = relative(root, absolutePath);
    const { data } = readJson(absolutePath, relativePath);
    const reveal = validateBatchObject(data, relativePath, relativePath);
    if (reveals.has(reveal.batchId)) fail(`duplicate batch reveal ${reveal.batchId}`);
    const commitment = commitments.get(reveal.batchId);
    if (commitment === undefined) fail(`${relativePath} has no matching public batch commitment`);
    if (sha256File(absolutePath) !== commitment.data.batch_sha256) {
      fail(`${commitment.relativePath}.batch_sha256 does not match exact reveal bytes of ${relativePath}`);
    }
    if (commitment.data.pick_count !== reveal.picks.length) {
      fail(`${commitment.relativePath}.pick_count ${commitment.data.pick_count} does not match reveal count ${reveal.picks.length}`);
    }
    if (commitment.data.earliest_kickoff_utc !== reveal.earliest.data.kickoff_utc) {
      fail(`${commitment.relativePath}.earliest_kickoff_utc does not match the reveal's earliest kickoff`);
    }
    for (const disclosed of reveal.picks) {
      const canonical = picks.get(disclosed.id);
      if (canonical === undefined) fail(`${relativePath} reveals unknown ledger pick ${disclosed.id}`);
      if (!isDeepStrictEqual(canonical.data, disclosed.data)) {
        fail(`${relativePath} pick ${disclosed.id} does not match canonical ledger pick ${canonical.path}`);
      }
      if (pickEvidence.has(disclosed.id)) fail(`${disclosed.id} has competing publication evidence`);
      pickEvidence.set(disclosed.id, {
        type: "SUBSCRIBER_BATCH",
        batchId: reveal.batchId,
        commitment,
        reveal,
      });
    }
    reveals.set(reveal.batchId, reveal);
    commitments.set(reveal.batchId, { ...commitment, status: "REVEALED", reveal });
  }

  if (requireEveryPick) {
    for (const pickId of picks.keys()) {
      if (!pickEvidence.has(pickId)) fail(`${pickId} has no publication evidence`);
    }
  }
  return { receipts, commitments, reveals, pickEvidence };
}
