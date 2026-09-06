#!/usr/bin/env node
// Run after rebuilding. Include new, deleted, staged and ignored derived files.
import { execFileSync } from "node:child_process";
import { isMainScript, REPO_ROOT } from "./lib.mjs";

export function assertDerivedCurrent(root) {
  const status = execFileSync("git", ["-C", root, "status", "--porcelain=v1",
    "--untracked-files=all", "--ignored", "--", "settlements", "standings"], { encoding: "utf8" });
  if (status.trim() !== "") throw new Error(`Derived files must be committed and current:\n${status}`);
}

if (isMainScript(import.meta.url)) assertDerivedCurrent(REPO_ROOT);
