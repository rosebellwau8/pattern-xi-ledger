import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUtcStamp } from "./lib.mjs";

export function validateFormalWindow(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "end_utc,start_utc") {
    throw new Error("formal window must contain only start_utc and end_utc");
  }
  if (value.start_utc === null && value.end_utc === null) return { ...value };
  const start = parseUtcStamp(value.start_utc, "formal window start_utc");
  const end = parseUtcStamp(value.end_utc, "formal window end_utc");
  if (end - start !== 90 * 24 * 60 * 60 * 1000) throw new Error("formal window must span exactly 90 UTC days");
  return { ...value };
}

export function loadFormalWindow(root) {
  return validateFormalWindow(JSON.parse(readFileSync(join(root, "config/formal-window.json"), "utf8")));
}

export function inFormalWindow(pick, window) {
  return window.start_utc !== null && pick.kickoffEpoch >= Date.parse(window.start_utc)
    && pick.kickoffEpoch < Date.parse(window.end_utc);
}
