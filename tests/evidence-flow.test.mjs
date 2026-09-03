import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildSite } from "../scripts/build-site.mjs";
import { recordPublicReceipt } from "../scripts/publication.mjs";
import { main as writeSettlements } from "../scripts/settle.mjs";
import { main as writeStandings } from "../scripts/standings.mjs";
import { validatePullRequest } from "../scripts/validate-pr.mjs";
import { runValidation } from "../scripts/validate.mjs";

function runGit(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function writeJson(root, relativePath, value) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

test("synthetic X-receipt publication flows through settlement, standings, and site", () => {
  const root = mkdtempSync(join(tmpdir(), "pattern-xi-evidence-flow-"));
  const pickId = "2026-09-06-north-south-synthetic-ah";
  const pickPath = `picks/2026/${pickId}.json`;
  try {
    runGit(root, ["init", "--initial-branch=main"]);
    runGit(root, ["config", "user.name", "Pattern XI rehearsal"]);
    runGit(root, ["config", "user.email", "rehearsal@example.invalid"]);
    writeFileSync(join(root, ".gitattributes"), "* -text\n");
    runGit(root, ["add", ".gitattributes"]);
    runGit(root, ["commit", "-m", "base"]);
    const baseSha = runGit(root, ["rev-parse", "HEAD"]);

    runGit(root, ["switch", "-c", "publish/synthetic"]);
    writeJson(root, pickPath, {
      schema: "pattern-xi.pick.v1",
      id: pickId,
      match: "North FC v South FC",
      competition: "Synthetic League",
      kickoff_utc: "2026-09-06T16:30:00Z",
      market: "asian_handicap",
      selection: "HOME",
      line: "-0.50",
      published_price: "0.95",
      published_price_format: "HONG_KONG_ODDS",
      normalized_decimal_price: "1.95",
      price_source: "Synthetic operator input",
    });
    const receipt = recordPublicReceipt(root, pickPath, {
      url: "https://x.com/patternxi/status/1964280000000000000",
      publishedAt: "2026-09-06T13:00:00Z",
    });
    runGit(root, ["add", pickPath, receipt.relativePath]);
    runGit(root, ["commit", "-m", "publish synthetic pick"]);
    const headSha = runGit(root, ["rev-parse", "HEAD"]);

    assert.deepEqual(validatePullRequest(root, baseSha, headSha), []);

    runGit(root, ["switch", "main"]);
    runGit(root, ["merge", "--no-ff", "--no-edit", headSha]);

    const resultPath = `results/2026/${pickId}.json`;
    writeJson(root, resultPath, {
      schema: "pattern-xi.result.v1",
      pick_id: pickId,
      status: "PLAYED",
      home_score: 2,
      away_score: 0,
    });
    assert.deepEqual(runValidation(root, {
      now: Date.parse("2026-09-06T18:30:00Z"),
      resultGatePaths: [resultPath],
      requirePublicationEvidence: true,
    }), []);

    writeSettlements(root);
    writeStandings(root);
    buildSite(root);

    const settlement = JSON.parse(readFileSync(
      join(root, `settlements/2026/${pickId}.json`),
      "utf8",
    ));
    const standings = JSON.parse(readFileSync(join(root, "standings/standings.json"), "utf8"));
    assert.equal(settlement.current.classification, "WIN");
    assert.equal(standings.n, 1);
    assert.ok(existsSync(join(root, `site-dist/picks/${pickId}.html`)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
