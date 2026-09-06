import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertDerivedCurrent } from "../scripts/check-derived.mjs";

test("derived gate rejects omitted, modified, deleted and staged outputs", () => {
  const root = mkdtempSync(join(tmpdir(), "pattern-xi-derived-test-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.invalid");
    git("config", "core.autocrlf", "false");
    mkdirSync(join(root, "standings"));
    mkdirSync(join(root, "settlements"));
    writeFileSync(join(root, "standings/standings.json"), "{}\n");
    git("add", "."); git("commit", "-m", "Base");
    assertDerivedCurrent(root);
    writeFileSync(join(root, "settlements/new.json"), "{}\n");
    git("diff", "--exit-code", "--", "settlements", "standings"); // Old gate missed this.
    assert.throws(() => assertDerivedCurrent(root), /settlements\/new.json/u);
    git("add", ".");
    assert.throws(() => assertDerivedCurrent(root), /must be committed/u);
    git("commit", "-m", "Derived");
    assertDerivedCurrent(root);
    writeFileSync(join(root, "standings/standings.json"), "changed\n");
    assert.throws(() => assertDerivedCurrent(root), /standings\/standings.json/u);
    rmSync(join(root, "settlements/new.json"));
    assert.throws(() => assertDerivedCurrent(root), /settlements\/new.json/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
