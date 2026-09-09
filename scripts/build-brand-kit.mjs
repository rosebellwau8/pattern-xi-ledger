#!/usr/bin/env node
// Generates the reviewable brand kit into brand/: SVG masters plus the
// fixed-size PNG exports for X and social sharing. Everything is rendered by
// scripts/brand-kit.mjs from one vector master, so re-running this script is
// idempotent byte-for-byte. Run manually: node scripts/build-brand-kit.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isMainScript, REPO_ROOT } from "./lib.mjs";
import {
  brandIconSvg,
  renderAvatarPng,
  renderBannerPng,
  renderShareCardPng,
  renderSquareIconPng,
  wordmarkSvg,
} from "./brand-kit.mjs";

export function buildBrandKit(root = REPO_ROOT) {
  const out = join(root, "brand");
  mkdirSync(out, { recursive: true });

  writeFileSync(join(out, "icon.svg"), brandIconSvg({ size: 512, tile: "rounded", ring: true, tileRadius: 96 }));
  writeFileSync(join(out, "wordmark.svg"), wordmarkSvg());
  writeFileSync(join(out, "favicon.svg"), brandIconSvg({ size: 64, tile: "rounded", ring: false, tileRadius: 96 }));
  writeFileSync(join(out, "home-screen-icon-180.png"), renderSquareIconPng(180));
  writeFileSync(join(out, "x-avatar-400.png"), renderAvatarPng());
  writeFileSync(join(out, "x-banner-1500x500.png"), renderBannerPng());
  writeFileSync(join(out, "share-preview-1200x630.png"), renderShareCardPng());
  return out;
}

if (isMainScript(import.meta.url)) {
  const out = buildBrandKit();
  console.log(`brand kit written to ${out}`);
}
