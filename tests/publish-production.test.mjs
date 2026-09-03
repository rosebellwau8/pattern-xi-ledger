import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  publicationBranchName,
  publishProduction,
  validatePublicationBundle,
} from "../scripts/publish-production.mjs";
import { normalizeProductionExport } from "../scripts/import-production.mjs";

test("production publication branch names are deterministic and content-addressed", () => {
  const data = { exported_at: "2026-09-02T08:16:09.393094+00:00" };
  const first = publicationBranchName(data, Buffer.from("first"));
  assert.match(first, /^publish\/2026-09-02-[0-9a-f]{8}$/u);
  assert.equal(publicationBranchName(data, Buffer.from("first")), first);
  assert.notEqual(publicationBranchName(data, Buffer.from("second")), first);
  assert.notEqual(publicationBranchName(data, Buffer.from("first"), Buffer.from("receipt")), first);
});

test("production publication dry-run validates the full handoff without GitHub writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "pattern-xi-publish-test-"));
  try {
    const file = join(directory, "export.json");
    writeFileSync(file, JSON.stringify({
      schema: "production-public-export.v1",
      exported_at: "2030-01-01T08:00:00Z",
      matches: [{
        league: "Premier Division",
        kickoff: { local: "2030-01-01 20:00", timezone: "Europe/London" },
        home_team: "Northbridge Athletic",
        away_team: "Kingsport City",
        asian_handicap: {
          recommendation: "AWAY",
          provider: "Crown",
          market: "full_time_asian_handicap",
          observed_at: "2030-01-01T07:59:00Z",
          recommended_handicap: "-0.75",
          recommended_water_raw: "0.97",
        },
      }],
    }));
    const result = publishProduction(file, { dryRun: true });
    assert.equal(result.written.length, 1);
    assert.equal(result.pr, null);
    assert.equal(result.branch, null);
    assert.equal(result.posts.length, 1);
    assert.match(result.posts[0].text, /Official Pick/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a production publication bundle requires one valid two-hour X receipt per eligible pick", () => {
  const data = {
    schema: "production-public-export.v1",
    exported_at: "2030-01-01T08:00:00Z",
    matches: [{
      league: "Premier Division",
      kickoff: { local: "2030-01-01 20:00", timezone: "Europe/London" },
      home_team: "Northbridge Athletic",
      away_team: "Kingsport City",
      asian_handicap: {
        recommendation: "AWAY",
        provider: "Crown",
        market: "full_time_asian_handicap",
        observed_at: "2030-01-01T07:59:00Z",
        recommended_handicap: "-0.75",
        recommended_water_raw: "0.97",
      },
    }],
  };
  const id = normalizeProductionExport(data).picks[0].id;
  const receiptInput = (publishedAt = "2030-01-01T17:00:00Z") => Buffer.from(JSON.stringify({
    schema: "pattern-xi.publication-receipts-input.v1",
    receipts: [{
      pick_id: id,
      url: "https://x.com/patternxi/status/1964280000000000000",
      published_at: publishedAt,
    }],
  }));
  assert.equal(validatePublicationBundle(data, receiptInput()).written.length, 1);
  assert.throws(
    () => validatePublicationBundle(data, receiptInput("2030-01-01T18:00:00.001Z")),
    /at least 2 hours/u,
  );
  assert.throws(
    () => validatePublicationBundle(data, Buffer.from(JSON.stringify({
      schema: "pattern-xi.publication-receipts-input.v1",
      receipts: [],
    }))),
    /missing/u,
  );
});
