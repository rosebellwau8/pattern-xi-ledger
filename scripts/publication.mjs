#!/usr/bin/env node
// Operator-side tools for the lightweight publication evidence model.
// No network calls are made here: the operator publishes the rendered text on
// X, then records the canonical status URL and platform timestamp.

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  BATCH_SCHEMA,
  COMMITMENT_SCHEMA,
  RECEIPT_SCHEMA,
  loadPublicationEvidence,
  validateBatchObject,
  validateCommitmentObject,
  validateReceiptObject,
} from "./publication-evidence.mjs";
import {
  isMainScript,
  loadPicks,
  REPO_ROOT,
  sha256File,
  validatePickObject,
} from "./lib.mjs";

function safeRelativePath(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim() === "" || isAbsolute(relativePath)) {
    throw new Error("ledger path must be a non-empty relative path");
  }
  const absolute = resolve(root, relativePath);
  const boundary = `${resolve(root)}${sep}`;
  if (!absolute.startsWith(boundary)) throw new Error(`ledger path escapes the repository: ${relativePath}`);
  return absolute;
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function writeNewOrSame(path, bytes, label, dryRun) {
  if (existsSync(path)) {
    if (!readFileSync(path).equals(bytes)) throw new Error(`${label} conflicts with existing content`);
    return "UNCHANGED";
  }
  if (!dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  return dryRun ? "WOULD_WRITE" : "WRITTEN";
}

function selectedTeam(pick) {
  const teams = pick.match.split(" v ");
  if (teams.length !== 2) return pick.selection;
  return pick.selection === "HOME" ? teams[0] : teams[1];
}

export function renderXPost(pick, {
  siteBaseUrl = "https://rosebellwau8.github.io/pattern-xi-ledger",
} = {}) {
  validatePickObject(pick, "pick");
  const priceSuffix = pick.published_price_format === "HONG_KONG_ODDS" ? "HK" : "decimal";
  const kickoff = pick.kickoff_utc
    .replace(/:00(?:\.000)?Z$/u, "Z")
    .replace("T", " ")
    .replace("Z", " UTC");
  return [
    pick.id,
    "",
    pick.match,
    `${selectedTeam(pick)} ${pick.line}`,
    `${pick.published_price} ${priceSuffix}`,
    "",
    `Kickoff ${kickoff}`,
    "Official Pick",
    `${siteBaseUrl.replace(/\/$/u, "")}/picks/${pick.id}.html`,
  ].join("\n");
}

export function recordPublicReceipt(
  root,
  pickRelativePath,
  { url, publishedAt },
  { dryRun = false } = {},
) {
  const picks = loadPicks(root);
  const normalizedPath = pickRelativePath.replaceAll("\\", "/");
  safeRelativePath(root, normalizedPath);
  const pick = [...picks.values()].find((value) => value.path === normalizedPath);
  if (pick === undefined) throw new Error(`${normalizedPath} is not a loaded canonical pick`);
  const relativePath = `publication/receipts/${pick.id.slice(0, 4)}/${pick.id}.json`;
  const data = {
    schema: RECEIPT_SCHEMA,
    pick_id: pick.id,
    channel: "X",
    url,
    published_at: publishedAt,
    pick_sha256: sha256File(pick.absolutePath),
  };
  validateReceiptObject(data, relativePath, relativePath, picks);
  const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
  const status = writeNewOrSame(join(root, relativePath), bytes, relativePath, dryRun);
  return { status, relativePath, data, post: renderXPost(pick.data) };
}

function validateBatchSource(source) {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("batch source must be a JSON object");
  }
  for (const key of Object.keys(source)) {
    if (key !== "batch_id" && key !== "picks") throw new Error(`batch source has unknown field "${key}"`);
  }
  if (typeof source.batch_id !== "string" || source.batch_id === "") {
    throw new Error("batch source.batch_id must be a non-empty string");
  }
  if (!Array.isArray(source.picks) || source.picks.length === 0) {
    throw new Error("batch source.picks must be a non-empty array");
  }
}

export function prepareSubscriberBatch(source, { nonce = randomBytes(32).toString("hex") } = {}) {
  validateBatchSource(source);
  const picks = [...source.picks].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const data = { schema: BATCH_SCHEMA, batch_id: source.batch_id, nonce, picks };
  const validated = validateBatchObject(data, "subscriber batch");
  const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
  return {
    data,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    pickCount: picks.length,
    earliestKickoffUtc: validated.earliest.data.kickoff_utc,
  };
}

export function renderBatchCommitment({ data, sha256, pickCount, earliestKickoffUtc }) {
  return [
    "Pattern XI Official Batch",
    data.batch_id,
    "",
    `${pickCount} Subscriber-only Pick${pickCount === 1 ? "" : "s"}`,
    "Subscriber commitment:",
    `SHA256: ${sha256}`,
    `Earliest kickoff: ${earliestKickoffUtc.replace("T", " ").replace("Z", " UTC")}`,
  ].join("\n");
}

function inspectBatchFile(batchFile) {
  const bytes = readFileSync(batchFile);
  const data = parseJsonBytes(bytes, batchFile);
  const validated = validateBatchObject(data, batchFile);
  return {
    data,
    bytes,
    validated,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function recordBatchCommitment(
  root,
  batchFile,
  { url, publishedAt },
  { dryRun = false } = {},
) {
  const inspected = inspectBatchFile(batchFile);
  const { data: batch, validated } = inspected;
  const relativePath = `publication/commitments/${validated.year}/${batch.batch_id}.json`;
  const data = {
    schema: COMMITMENT_SCHEMA,
    batch_id: batch.batch_id,
    pick_count: batch.picks.length,
    earliest_kickoff_utc: validated.earliest.data.kickoff_utc,
    batch_sha256: inspected.sha256,
    receipt: { channel: "X", url, published_at: publishedAt },
  };
  validateCommitmentObject(data, relativePath, relativePath);
  const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
  const status = writeNewOrSame(join(root, relativePath), bytes, relativePath, dryRun);
  return { status, relativePath, data };
}

export function revealSubscriberBatch(root, batchFile, { dryRun = false } = {}) {
  const inspected = inspectBatchFile(batchFile);
  const { data: batch, validated } = inspected;
  const existingPicks = loadPicks(root);
  const evidence = loadPublicationEvidence(root, existingPicks);
  const commitment = evidence.commitments.get(batch.batch_id);
  if (commitment === undefined) throw new Error(`${batch.batch_id} has no public commitment`);
  if (commitment.status !== "COMMITTED") throw new Error(`${batch.batch_id} has already been revealed`);
  if (commitment.data.batch_sha256 !== inspected.sha256) {
    throw new Error(`${batch.batch_id} exact batch bytes do not match commitment`);
  }
  if (commitment.data.pick_count !== batch.picks.length) {
    throw new Error(`${batch.batch_id} pick count does not match commitment`);
  }
  if (commitment.data.earliest_kickoff_utc !== validated.earliest.data.kickoff_utc) {
    throw new Error(`${batch.batch_id} earliest kickoff does not match commitment`);
  }

  const writes = [];
  const unchangedPicks = [];
  for (const disclosed of batch.picks) {
    const info = validatePickObject(disclosed, `${batch.batch_id}:${disclosed.id}`);
    if (evidence.pickEvidence.has(info.id)) throw new Error(`${info.id} already has publication evidence`);
    const relativePath = `picks/${info.id.slice(0, 4)}/${info.id}.json`;
    const absolutePath = join(root, relativePath);
    const canonicalBytes = Buffer.from(`${JSON.stringify(disclosed, null, 2)}\n`);
    if (existsSync(absolutePath)) {
      const current = parseJsonBytes(readFileSync(absolutePath), relativePath);
      if (!isDeepStrictEqual(current, disclosed)) throw new Error(`${relativePath} conflicts with revealed pick`);
      unchangedPicks.push(relativePath);
    } else {
      writes.push({ relativePath, absolutePath, bytes: canonicalBytes });
    }
  }

  const revealPath = `publication/reveals/${validated.year}/${batch.batch_id}.json`;
  const revealAbsolute = join(root, revealPath);
  const revealAlreadyExists = existsSync(revealAbsolute);
  if (revealAlreadyExists && !readFileSync(revealAbsolute).equals(inspected.bytes)) {
    throw new Error(`${revealPath} conflicts with existing content`);
  }
  if (!dryRun) {
    for (const write of writes) {
      mkdirSync(dirname(write.absolutePath), { recursive: true });
      writeFileSync(write.absolutePath, write.bytes);
    }
    if (!revealAlreadyExists) {
      mkdirSync(dirname(revealAbsolute), { recursive: true });
      writeFileSync(revealAbsolute, inspected.bytes);
    }
    loadPublicationEvidence(root, loadPicks(root), { requireEveryPick: true });
  }
  return {
    revealPath,
    revealStatus: revealAlreadyExists ? "UNCHANGED" : dryRun ? "WOULD_WRITE" : "WRITTEN",
    writtenPicks: writes.map((write) => write.relativePath),
    unchangedPicks,
  };
}

function flag(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function requiredFlag(args, name) {
  const value = flag(args, name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const root = process.env.PATTERN_XI_LEDGER_ROOT ?? REPO_ROOT;
  try {
    if (command === "render") {
      const pickPath = args.find((argument) => !argument.startsWith("--"));
      if (pickPath === undefined) throw new Error("usage: publication render <pick-path>");
      const picks = loadPicks(root);
      const pick = [...picks.values()].find((item) => item.path === pickPath.replaceAll("\\", "/"));
      if (pick === undefined) throw new Error(`${pickPath} is not a loaded canonical pick`);
      console.log(renderXPost(pick.data));
    } else if (command === "record") {
      const pickPath = args.find((argument) => !argument.startsWith("--")
        && argument !== flag(args, "--url") && argument !== flag(args, "--published-at"));
      if (pickPath === undefined) throw new Error("usage: publication record <pick-path> --url <x-url> --published-at <UTC>");
      const result = recordPublicReceipt(root, pickPath, {
        url: requiredFlag(args, "--url"),
        publishedAt: requiredFlag(args, "--published-at"),
      }, { dryRun: args.includes("--dry-run") });
      console.log(`${result.status}: ${result.relativePath}`);
    } else if (command === "batch-prepare") {
      const sourcePath = args[0];
      const outputPath = args[1];
      if (sourcePath === undefined || outputPath === undefined) {
        throw new Error("usage: publication batch-prepare <source.json> <private-output.json> [--nonce <64-hex>]");
      }
      const source = parseJsonBytes(readFileSync(sourcePath), sourcePath);
      const prepared = prepareSubscriberBatch(source, { nonce: flag(args, "--nonce") });
      writeFileSync(outputPath, prepared.bytes, { flag: "wx" });
      console.log(renderBatchCommitment(prepared));
    } else if (command === "batch-commit") {
      const batchFile = args[0];
      if (batchFile === undefined) throw new Error("usage: publication batch-commit <private-batch.json> --url <x-url> --published-at <UTC>");
      const result = recordBatchCommitment(root, batchFile, {
        url: requiredFlag(args, "--url"),
        publishedAt: requiredFlag(args, "--published-at"),
      }, { dryRun: args.includes("--dry-run") });
      console.log(`${result.status}: ${result.relativePath}`);
    } else if (command === "batch-reveal") {
      const batchFile = args[0];
      if (batchFile === undefined) throw new Error("usage: publication batch-reveal <private-batch.json> [--dry-run]");
      const result = revealSubscriberBatch(root, batchFile, { dryRun: args.includes("--dry-run") });
      console.log(`${result.revealStatus}: ${result.revealPath}; picks: ${result.writtenPicks.length} new, ${result.unchangedPicks.length} unchanged`);
    } else {
      throw new Error("usage: publication <render|record|batch-prepare|batch-commit|batch-reveal> ...");
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (isMainScript(import.meta.url)) main();
