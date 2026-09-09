# Pattern XI brand kit

One vector master — off-white geometric **XI** plus the blue pitch centre
circle on a deep blue-black ground — drives every asset below. Everything in
this folder is regenerated deterministically by:

```bash
node scripts/build-brand-kit.mjs
```

(Dependencies: none. The PNGs are rasterised from code by
`scripts/brand-kit.mjs`; glyph outlines come from `scripts/brand-type.mjs`,
generated from the bundled Inter files by
`scripts/tools/extract-brand-type.py`.)

## Files

| File | Purpose | Size |
| --- | --- | --- |
| `icon.svg` | Brand icon master: XI + centre circle on rounded tile | vector |
| `wordmark.svg` | Horizontal lockup: icon + "Pattern XI" (live text, Inter) | vector |
| `favicon.svg` | Small-size variant: letters only, the thin circle drops out | vector |
| `home-screen-icon-180.png` | Mobile home-screen icon (`apple-touch-icon`) | 180×180 |
| `x-avatar-400.png` | X profile image, opaque ground, ring survives circular crop | 400×400 |
| `x-banner-1500x500.png` | X banner: identity block centre-right, bottom-left kept clear for the avatar overlay | 1500×500 |
| `share-preview-1200x630.png` | Social share card (its own layout, not a banner crop) | 1200×630 |

The website build (`npm run build`) emits the same master into `site-dist/`
as `favicon.svg`, `favicon-32.png`, `favicon.ico`, `apple-touch-icon.png` and
`og-image-v2.png` (the share card), plus the hosted Inter woff2 files under
`site-dist/fonts/`.

## Colour

| Role | Value |
| --- | --- |
| Background / tile | `#101820` |
| Card / panel | `#17222D` |
| Hairlines / borders | `#314252` |
| Text / mark | `#F4F0E6` |
| Secondary text | `#AAB7C4` |
| Brand blue (accent circle, primary buttons) | `#2563EB` |
| Light blue (links on dark) | `#7DB4FF` |
| Positive results | `#65C995` |
| Negative results | `#F08A8A` |
| Pending | `#E7BE67` |

Green is reserved for positive settled outcomes and never appears in brand
artwork. Status colours always accompany a text label.

## Type

Inter (SIL OFL 1.1), hosted locally in `site-assets/fonts` with the license
in `site-assets/fonts/OFL.txt`. Brand images embed real Inter outlines; the
SVG wordmark references Inter by name with system fallbacks.

## X upload notes

Upload `x-avatar-400.png` and `x-banner-1500x500.png` manually in X settings.
Already-posted tweets may keep cached previews of the old images; new posts
pick up the new assets. The site X link points at
`https://x.com/patternxi_xi`.
