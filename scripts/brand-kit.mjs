// Pattern XI brand kit: vector master geometry plus a dependency-free,
// deterministic rasterizer for the fixed-size brand PNGs (favicon set, mobile
// icon, X avatar/banner, social share card). Same input, same bytes — no
// network, no clock, no canvas library — so the site build can regenerate
// every asset anywhere and stay byte-identical.
//
// Colour system matches the site stylesheet (see STYLE in build-site.mjs):
// deep blue-black surfaces, off-white "XI" mark, one pitch-centre-circle
// accent in brand blue. Green is reserved for positive settled results and
// never appears in brand artwork.

import { deflateSync } from "node:zlib";

import { UPEM, GLYPHS } from "./brand-type.mjs";

export const BRAND = {
  bg: "#101820",
  card: "#17222D",
  line: "#314252",
  text: "#F4F0E6",
  muted: "#AAB7C4",
  faint: "#8FA1B3",
  blue: "#2563EB",
  blueLight: "#7DB4FF",
  positive: "#65C995",
  negative: "#F08A8A",
  pending: "#E7BE67",
};

// Shared share-card identity copy. Never carries ROI, win-rate, return
// promises or countdown copy.
export const SHARE_TAGLINE = "Independent football picks. Public record.";
export const SHARE_AUX_LINE = "Frozen lines & prices · Transparent results";
export const X_HANDLE_URL = "x.com/patternxi_xi";
export const X_PROFILE_URL = "https://x.com/patternxi_xi";
export const OG_IMAGE_FILENAME = "og-image-v2.png";

export function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

// ---------------------------------------------------------------------------
// Master geometry. One parametric "XI" lockup feeds the SVG masters and the
// rasterizer, so every size renders the same mark.
//
// Proportions (relative to letter height h, from the 512-unit master):
//   X letter width 0.88h, bar half-width barW (0.09h master, wider for favicon)
//   I letter width 0.18h, gap between letters 0.13h; total width 1.19h.
export function xiLockup({ height, barWidth }) {
  const h = height;
  const w = barWidth;
  const xWidth = 0.88 * h;
  const gap = 0.13 * h;
  const iWidth = 0.18 * h;
  const total = xWidth + gap + iWidth;
  const x0 = -total / 2;
  const y0 = -h / 2;
  const bar = (ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    const nx = (-dy / length) * w;
    const ny = (dx / length) * w;
    return [
      [ax + nx, ay + ny],
      [bx + nx, by + ny],
      [bx - nx, by - ny],
      [ax - nx, ay - ny],
    ];
  };
  const xLeft = x0;
  const xRight = x0 + xWidth;
  const iLeft = xRight + gap;
  const iRight = iLeft + iWidth;
  return [
    bar(xLeft, y0, xRight, y0 + h),
    bar(xRight, y0, xLeft, y0 + h),
    [
      [iLeft, y0],
      [iRight, y0],
      [iRight, y0 + h],
      [iLeft, y0 + h],
    ],
  ];
}

// Pitch centre circle around the lockup (512 master: r=199, stroke 13 at
// letter height 200).
export function circleForHeight(letterHeight) {
  return { radius: 0.995 * letterHeight, width: 0.065 * letterHeight };
}

const MASTER_LETTER_HEIGHT = 200;
const MASTER_BAR_WIDTH = 18;

function polygonPoints(polys, centre) {
  return polys.map((points) =>
    points.map(([x, y]) => {
      const fixed = (x + centre).toFixed(1).replace(/\.0$/, "");
      const fixedY = (y + centre).toFixed(1).replace(/\.0$/, "");
      return `${fixed},${fixedY}`;
    }).join(" "));
}

// Inline/master icon SVG: off-white XI plus blue centre circle on an optional
// deep blue-black tile. `ring: false` is the small-size favicon variant
// (thin circle lines drop out at favicon sizes). The letters carry an
// explicit fill: SVG loaded as a standalone image has no inherited colour
// and would otherwise fall back to black.
export function brandIconSvg({ size = 64, tile = "none", ring = true, tileRadius = 96 }) {
  const polys = xiLockup({
    height: ring ? MASTER_LETTER_HEIGHT : 216,
    barWidth: ring ? MASTER_BAR_WIDTH : 21.6,
  });
  const parts = [];
  if (tile !== "none") {
    const radius = tile === "square" ? 0 : tileRadius;
    parts.push(`<rect width="512" height="512" rx="${radius}" fill="${BRAND.bg}"/>`);
  }
  if (ring) {
    const { radius, width } = circleForHeight(MASTER_LETTER_HEIGHT);
    parts.push(`<circle cx="256" cy="256" r="${radius}" fill="none" stroke="${BRAND.blue}" stroke-width="${width}"/>`);
  }
  const letters = polygonPoints(polys, 256)
    .map((points) => `<polygon points="${points}"/>`)
    .join("\n    ");
  parts.push(`<g fill="${BRAND.text}">\n    ${letters}\n  </g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" role="img" aria-label="Pattern XI">\n  ${parts.join("\n  ")}\n</svg>\n`;
}

// Emits one glyph as an SVG <path> "d" string in device space: same embedded
// Inter outlines the rasterizer uses, curves preserved (no flattening), so
// SVG masters render identically everywhere without shipping a font.
function glyphPathData(character, weight, { x, baseline, size }) {
  const glyph = glyphFor(character, weight);
  const scale = size / UPEM;
  const dX = (fontX) => x + fontX * scale;
  const dY = (fontY) => baseline - fontY * scale;
  const tokens = glyph.d.match(/[MLHVQCTSZmlhvqctsz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let index = 0;
  let px = 0; let py = 0;
  const out = [];
  const fmt = (value) => {
    const fixed = value.toFixed(2).replace(/\.?0+$/, "");
    return fixed === "-0" ? "0" : fixed;
  };
  while (index < tokens.length) {
    const command = tokens[index++];
    const args = [];
    while (index < tokens.length && /[-\d.]/.test(tokens[index][0])) {
      args.push(Number(tokens[index++]));
    }
    let position = 0;
    const take = (count) => args.slice(position, (position += count));
    const relative = command >= "a" && command <= "z";
    switch (command.toUpperCase()) {
      case "M": {
        while (position < args.length) {
          const [dx, dy] = take(2);
          px = relative ? px + dx : dx;
          py = relative ? py + dy : dy;
          out.push(`M${fmt(dX(px))} ${fmt(dY(py))}`);
        }
        break;
      }
      case "L": {
        while (position < args.length) {
          px = relative ? px + args[position] : args[position];
          py = relative ? py + args[position + 1] : args[position + 1];
          position += 2;
          out.push(`L${fmt(dX(px))} ${fmt(dY(py))}`);
        }
        break;
      }
      case "H": {
        while (position < args.length) {
          px = relative ? px + args[position] : args[position];
          position += 1;
          out.push(`H${fmt(dX(px))}`);
        }
        break;
      }
      case "V": {
        while (position < args.length) {
          py = relative ? py + args[position] : args[position];
          position += 1;
          out.push(`V${fmt(dY(py))}`);
        }
        break;
      }
      case "Q": {
        while (position < args.length) {
          const [c1x, c1y, ex, ey] = take(4);
          const acx = relative ? px + c1x : c1x;
          const acy = relative ? py + c1y : c1y;
          px = relative ? px + ex : ex;
          py = relative ? py + ey : ey;
          out.push(`Q${fmt(dX(acx))} ${fmt(dY(acy))} ${fmt(dX(px))} ${fmt(dY(py))}`);
        }
        break;
      }
      case "C": {
        while (position < args.length) {
          const [c1x, c1y, c2x, c2y, ex, ey] = take(6);
          const a1x = relative ? px + c1x : c1x;
          const a1y = relative ? py + c1y : c1y;
          const a2x = relative ? px + c2x : c2x;
          const a2y = relative ? py + c2y : c2y;
          px = relative ? px + ex : ex;
          py = relative ? py + ey : ey;
          out.push(`C${fmt(dX(a1x))} ${fmt(dY(a1y))} ${fmt(dX(a2x))} ${fmt(dY(a2y))} ${fmt(dX(px))} ${fmt(dY(py))}`);
        }
        break;
      }
      case "Z": {
        out.push("Z");
        break;
      }
      default:
        throw new Error(`unsupported glyph path command: ${command}`);
    }
  }
  return out.join("");
}

// Horizontal lockup master: icon + "Pattern XI" drawn as real Inter outlines
// (scripts/brand-type.mjs), so every environment renders identical letterforms
// with no font dependency. "XI" carries the light-blue accent.
export function wordmarkSvg() {
  const icon = brandIconSvg({ size: 128, ring: true }).replace("<svg ", '<svg x="0" y="16" ');
  const size = 76;
  const spacing = -1.5;
  const baseline = 104;
  const startX = 172;
  const groups = [
    { text: "Pattern ", color: BRAND.text },
    { text: "XI", color: BRAND.blueLight },
  ];
  const paths = [];
  let penX = startX;
  for (const group of groups) {
    const segments = [];
    for (const character of group.text) {
      const glyph = GLYPHS[String(800)][character];
      if (!glyph) throw new Error(`no Inter glyph for ${JSON.stringify(character)}`);
      if (glyph.d) segments.push(glyphPathData(character, 800, { x: penX, baseline, size }));
      penX += glyph.w * (size / UPEM) + spacing;
    }
    paths.push(`<path fill="${group.color}" d="${segments.join("")}"/>`);
  }
  const width = Math.ceil(penX - spacing) + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 160" width="${width}" height="160" role="img" aria-label="Pattern XI">
  ${icon.trim()}
  ${paths.join("\n  ")}
</svg>
`;
}

// ---------------------------------------------------------------------------
// Rasterizer. RGBA byte canvas, source-over blending, analytic coverage with
// 4x4 supersampling, even-odd polygon fill, distance-based ring stroke.

export function createCanvas(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4, 0) };
}

function setPixel(canvas, x, y, [r, g, b], alpha) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const offset = (y * canvas.width + x) * 4;
  const dstA = canvas.data[offset + 3] / 255;
  const srcA = Math.min(Math.max(alpha, 0), 1);
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const src = [r, g, b][channel];
    const dst = canvas.data[offset + channel];
    canvas.data[offset + channel] = Math.round((src * srcA + dst * dstA * (1 - srcA)) / outA);
  }
  canvas.data[offset + 3] = Math.round(outA * 255);
}

export function clearCanvas(canvas, color = null) {
  if (color === null) {
    canvas.data.fill(0);
    return;
  }
  const [r, g, b] = color;
  for (let offset = 0; offset < canvas.data.length; offset += 4) {
    canvas.data[offset] = r;
    canvas.data[offset + 1] = g;
    canvas.data[offset + 2] = b;
    canvas.data[offset + 3] = 255;
  }
}

const SAMPLES = 4;
const SAMPLE_STEP = 1 / SAMPLES;

// Nonzero-winding fill. TrueType outlines are outer contours and counters
// wound in opposite directions, and instances may legitimately overlap outer
// contours — nonzero fills unions correctly where even-odd would punch holes.
function fillLoopsNonZero(canvas, loops, color, alpha = 1) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const loop of loops) {
    for (const [x, y] of loop) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (loops.length === 0 || minX > maxX || minY > maxY) return;
  const edges = [];
  for (const loop of loops) {
    for (let index = 0; index < loop.length; index += 1) {
      const [ax, ay] = loop[index];
      const [bx, by] = loop[(index + 1) % loop.length];
      if (ay !== by) edges.push([ax, ay, bx, by]);
    }
  }
  const startPixelX = Math.max(0, Math.floor(minX) - 1);
  const endPixelX = Math.min(canvas.width - 1, Math.ceil(maxX) + 1);
  const startPixelY = Math.max(0, Math.floor(minY) - 1);
  const endPixelY = Math.min(canvas.height - 1, Math.ceil(maxY) + 1);
  const totalSamples = SAMPLES * SAMPLES;
  for (let py = startPixelY; py <= endPixelY; py += 1) {
    for (let px = startPixelX; px <= endPixelX; px += 1) {
      let inside = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        const pointY = py + (sy + 0.5) * SAMPLE_STEP;
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const pointX = px + (sx + 0.5) * SAMPLE_STEP;
          let winding = 0;
          for (const [ax, ay, bx, by] of edges) {
            if ((ay <= pointY && by > pointY) || (by <= pointY && ay > pointY)) {
              const t = (pointY - ay) / (by - ay);
              if (ax + t * (bx - ax) > pointX) winding += by > ay ? 1 : -1;
            }
          }
          if (winding !== 0) inside += 1;
        }
      }
      if (inside > 0) setPixel(canvas, px, py, color, alpha * (inside / totalSamples));
    }
  }
}

// Fills each polygon on its own (union semantics); used for the icon lockup
// where the two X strokes deliberately overlap.
export function fillPolys(canvas, polys, color, { translateX = 0, translateY = 0, scale = 1, alpha = 1 } = {}) {
  for (const points of polys) {
    const loop = points.map(([x, y]) => [translateX + x * scale, translateY + y * scale]);
    fillLoopsNonZero(canvas, [loop], color, alpha);
  }
}

export function fillRect(canvas, x, y, width, height, color, alpha = 1) {
  fillLoopsNonZero(canvas, [[[x, y], [x + width, y], [x + width, y + height], [x, y + height]]], color, alpha);
}

export function fillCircle(canvas, cx, cy, radius, color, alpha = 1) {
  const startPixelX = Math.max(0, Math.floor(cx - radius) - 1);
  const endPixelX = Math.min(canvas.width - 1, Math.ceil(cx + radius) + 1);
  const startPixelY = Math.max(0, Math.floor(cy - radius) - 1);
  const endPixelY = Math.min(canvas.height - 1, Math.ceil(cy + radius) + 1);
  const totalSamples = SAMPLES * SAMPLES;
  for (let py = startPixelY; py <= endPixelY; py += 1) {
    for (let px = startPixelX; px <= endPixelX; px += 1) {
      let inside = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        const dy = py + (sy + 0.5) * SAMPLE_STEP - cy;
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const dx = px + (sx + 0.5) * SAMPLE_STEP - cx;
          if (dx * dx + dy * dy <= radius * radius) inside += 1;
        }
      }
      if (inside > 0) setPixel(canvas, px, py, color, alpha * (inside / totalSamples));
    }
  }
}

export function strokeRing(canvas, cx, cy, radius, width, color, alpha = 1) {
  const half = width / 2;
  const inner = radius - half;
  const outer = radius + half;
  const startPixelX = Math.max(0, Math.floor(cx - outer) - 1);
  const endPixelX = Math.min(canvas.width - 1, Math.ceil(cx + outer) + 1);
  const startPixelY = Math.max(0, Math.floor(cy - outer) - 1);
  const endPixelY = Math.min(canvas.height - 1, Math.ceil(cy + outer) + 1);
  const totalSamples = SAMPLES * SAMPLES;
  for (let py = startPixelY; py <= endPixelY; py += 1) {
    for (let px = startPixelX; px <= endPixelX; px += 1) {
      let inside = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        const dy = py + (sy + 0.5) * SAMPLE_STEP - cy;
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const dx = px + (sx + 0.5) * SAMPLE_STEP - cx;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance >= inner && distance <= outer) inside += 1;
        }
      }
      if (inside > 0) setPixel(canvas, px, py, color, alpha * (inside / totalSamples));
    }
  }
}

function roundedRectLoop(x, y, width, height, radius, segmentsPerCorner = 8) {
  const points = [];
  const corner = (cx, cy, startAngle) => {
    for (let step = 0; step <= segmentsPerCorner; step += 1) {
      const angle = startAngle + (step / segmentsPerCorner) * (Math.PI / 2);
      points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
  };
  const right = x + width;
  const bottom = y + height;
  corner(right - radius, y + radius, -Math.PI / 2);
  corner(right - radius, bottom - radius, 0);
  corner(x + radius, bottom - radius, Math.PI / 2);
  corner(x + radius, y + radius, Math.PI);
  return points;
}

// Renders the master lockup scaled from the 512-unit design space.
export function drawMasterLockup(canvas, { scale, centreX = 0, centreY = 0, ring = true, alpha = 1 }) {
  const cx = centreX + 256 * scale;
  const cy = centreY + 256 * scale;
  if (ring) {
    const circle = circleForHeight(MASTER_LETTER_HEIGHT);
    strokeRing(canvas, cx, cy, circle.radius * scale, circle.width * scale, hexToRgb(BRAND.blue), alpha);
  }
  const polys = xiLockup({
    height: (ring ? MASTER_LETTER_HEIGHT : 216) * scale,
    barWidth: (ring ? MASTER_BAR_WIDTH : 21.6) * scale,
  });
  fillPolys(canvas, polys, hexToRgb(BRAND.text), { translateX: cx, translateY: cy, alpha });
}

// ---------------------------------------------------------------------------
// Deterministic PNG encoding (RGBA, deflate level 9) — same encoder contract
// the site build has always used.

export function encodePng(canvas) {
  const { width, height, data } = canvas;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const tagged = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tagged));
    return Buffer.concat([length, tagged, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Text rendering from the extracted Inter outlines (scripts/brand-type.mjs).
// Glyph coordinates are font units (y-up); they are flattened to fixed
// device-space loops (8 segments per curve) and filled even-odd.

const SEGMENTS_PER_CURVE = 8;
const PATH_TOKEN = /[MLHVQCTSZmlhvqctsz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g;

function flattenGlyphPath(path, mapX, mapY) {
  const loops = [];
  let loop = null;
  let px = 0; let py = 0; // current point (font units)
  let sx = 0; let sy = 0; // subpath start
  let qx = 0; let qy = 0; // last quadratic control
  let cx = 0; let cy = 0; // last cubic control
  let hasQuad = false;
  let hasCubic = false;

  const startSubpath = (x, y) => {
    if (loop !== null && loop.length > 1) loops.push(loop);
    loop = [[mapX(x), mapY(y)]];
    px = sx = x;
    py = sy = y;
  };
  const lineTo = (x, y) => {
    loop.push([mapX(x), mapY(y)]);
    px = x;
    py = y;
  };
  const quadTo = (ctrlX, ctrlY, x, y) => {
    const x0 = px;
    const y0 = py;
    for (let step = 1; step <= SEGMENTS_PER_CURVE; step += 1) {
      const t = step / SEGMENTS_PER_CURVE;
      const mt = 1 - t;
      const fx = mt * mt * x0 + 2 * mt * t * ctrlX + t * t * x;
      const fy = mt * mt * y0 + 2 * mt * t * ctrlY + t * t * y;
      loop.push([mapX(fx), mapY(fy)]);
    }
    px = x;
    py = y;
    qx = ctrlX;
    qy = ctrlY;
    hasQuad = true;
  };
  const cubicTo = (c1x, c1y, c2x, c2y, x, y) => {
    const x0 = px;
    const y0 = py;
    for (let step = 1; step <= SEGMENTS_PER_CURVE; step += 1) {
      const t = step / SEGMENTS_PER_CURVE;
      const mt = 1 - t;
      const fx = mt * mt * mt * x0 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x;
      const fy = mt * mt * mt * y0 + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y;
      loop.push([mapX(fx), mapY(fy)]);
    }
    px = x;
    py = y;
    cx = c2x;
    cy = c2y;
    hasCubic = true;
  };

  const tokens = path.match(PATH_TOKEN) ?? [];
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++];
    const numbers = [];
    while (index < tokens.length && /[-\d.]/.test(tokens[index][0])) {
      numbers.push(Number(tokens[index++]));
    }
    let position = 0;
    const take = (count) => {
      const values = numbers.slice(position, position + count);
      position += count;
      return values;
    };
    const relative = command >= "a" && command <= "z";
    switch (command.toUpperCase()) {
      case "M": {
        let first = true;
        while (position < numbers.length) {
          const [dx, dy] = take(2);
          const x = relative ? px + dx : dx;
          const y = relative ? py + dy : dy;
          if (first) startSubpath(x, y);
          else lineTo(x, y);
          first = false;
        }
        break;
      }
      case "L": {
        while (position < numbers.length) {
          const [dx, dy] = take(2);
          lineTo(relative ? px + dx : dx, relative ? py + dy : dy);
        }
        break;
      }
      case "H": {
        while (position < numbers.length) {
          const [dx] = take(1);
          lineTo(relative ? px + dx : dx, py);
        }
        break;
      }
      case "V": {
        while (position < numbers.length) {
          const [dy] = take(1);
          lineTo(px, relative ? py + dy : dy);
        }
        break;
      }
      case "Q": {
        while (position < numbers.length) {
          const [c1x, c1y, x, y] = take(4);
          quadTo(relative ? px + c1x : c1x, relative ? py + c1y : c1y, relative ? px + x : x, relative ? py + y : y);
        }
        break;
      }
      case "T": {
        while (position < numbers.length) {
          const [x, y] = take(2);
          const absoluteX = relative ? px + x : x;
          const absoluteY = relative ? py + y : y;
          const ctrlX = hasQuad ? 2 * px - qx : px;
          const ctrlY = hasQuad ? 2 * py - qy : py;
          quadTo(ctrlX, ctrlY, absoluteX, absoluteY);
        }
        break;
      }
      case "C": {
        while (position < numbers.length) {
          const [c1x, c1y, c2x, c2y, x, y] = take(6);
          cubicTo(
            relative ? px + c1x : c1x, relative ? py + c1y : c1y,
            relative ? px + c2x : c2x, relative ? py + c2y : c2y,
            relative ? px + x : x, relative ? py + y : y,
          );
        }
        break;
      }
      case "S": {
        while (position < numbers.length) {
          const [c2x, c2y, x, y] = take(4);
          const c1x = hasCubic ? 2 * px - cx : px;
          const c1y = hasCubic ? 2 * py - cy : py;
          cubicTo(c1x, c1y, relative ? px + c2x : c2x, relative ? py + c2y : c2y, relative ? px + x : x, relative ? py + y : y);
        }
        break;
      }
      case "Z": {
        if (loop !== null && loop.length > 1) loops.push(loop);
        loop = null;
        px = sx;
        py = sy;
        break;
      }
      default:
        throw new Error(`unsupported glyph path command: ${command}`);
    }
  }
  if (loop !== null && loop.length > 1) loops.push(loop);
  return loops;
}

function glyphFor(character, weight) {
  const table = GLYPHS[String(weight)];
  const glyph = table?.[character];
  if (!glyph) throw new Error(`no Inter glyph for ${JSON.stringify(character)} at weight ${weight}`);
  return glyph;
}

function textWidth(text, sizePx, weight, letterSpacingPx) {
  let width = 0;
  for (const character of text) {
    width += (character === "·" ? 0.26 * UPEM : glyphFor(character, weight).w) * (sizePx / UPEM) + letterSpacingPx;
  }
  return width - letterSpacingPx;
}

// Draws one line of text with the embedded Inter outlines. `letterSpacing`
// and `align` ("left" | "center" | "right") follow CSS intuition; the
// middle dot is drawn analytically because the latin subset has no U+00B7.
export function drawText(canvas, text, {
  x = 0,
  baseline = 0,
  size = 32,
  weight = 800,
  color = BRAND.text,
  alpha = 1,
  letterSpacing = 0,
  align = "left",
} = {}) {
  const rgb = hexToRgb(color);
  const scale = size / UPEM;
  const spacingPx = letterSpacing * size;
  let penX = align === "left" ? x : align === "center" ? x - textWidth(text, size, weight, spacingPx) / 2 : x - textWidth(text, size, weight, spacingPx);
  for (const character of text) {
    if (character === "·") {
      fillCircle(canvas, penX + 0.13 * UPEM * scale, baseline - 0.27 * size, 0.058 * size, rgb, alpha);
      penX += 0.26 * UPEM * scale + spacingPx;
      continue;
    }
    const glyph = glyphFor(character, weight);
    const originX = penX;
    const mapX = (fontX) => originX + fontX * scale;
    const mapY = (fontY) => baseline - fontY * scale;
    fillLoopsNonZero(canvas, flattenGlyphPath(glyph.d, mapX, mapY), rgb, alpha);
    penX += glyph.w * scale + spacingPx;
  }
  return penX;
}

// ---------------------------------------------------------------------------
// Fixed-size asset renderers. Every function returns a PNG Buffer and depends
// only on its arguments — never on the clock, the locale or the network.

// Site favicon raster (transparent rounded tile, letters only — the thin
// centre circle is dropped at this size).
export function renderFaviconPng(size = 32) {
  const canvas = createCanvas(size, size);
  const radius = Math.round(size * 0.22);
  fillLoopsNonZero(canvas, [roundedRectLoop(0, 0, size, size, radius)], hexToRgb(BRAND.bg));
  const polys = xiLockup({ height: size * 0.62, barWidth: size * 0.124 });
  fillPolys(canvas, polys, hexToRgb(BRAND.text), { translateX: size / 2, translateY: size / 2 });
  return encodePng(canvas);
}

// Legacy .ico container wrapping the 32px PNG (Vista+ icon format).
export function renderFaviconIco() {
  const png = renderFaviconPng(32);
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  header.writeUInt8(32, 6); // width
  header.writeUInt8(32, 7); // height
  header.writeUInt8(0, 8); // palette
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // offset: 6-byte dir + 16-byte entry
  return Buffer.concat([header, png]);
}

// Mobile home-screen icon and X avatar share the full-bleed master: opaque
// deep blue-black ground, blue centre circle, off-white XI. No transparency,
// so neither platform can composite it onto white.
export function renderSquareIconPng(size) {
  const canvas = createCanvas(size, size);
  clearCanvas(canvas, hexToRgb(BRAND.bg));
  drawMasterLockup(canvas, { scale: size / 512 });
  return encodePng(canvas);
}

// X profile image (circular crop keeps the full ring visible).
export function renderAvatarPng() {
  return renderSquareIconPng(400);
}

// X banner: identity block sits centre-right, the bottom-left quadrant stays
// clear because X overlays the circular avatar there. Pitch rings bleed off
// the right edge as the only decoration.
export function renderBannerPng() {
  const canvas = createCanvas(1500, 500);
  clearCanvas(canvas, hexToRgb(BRAND.bg));
  strokeRing(canvas, 1520, 250, 260, 1.5, hexToRgb(BRAND.line), 0.55);
  strokeRing(canvas, 1520, 250, 208, 3, hexToRgb(BRAND.blue), 0.9);
  fillRect(canvas, 564, 130, 64, 7, hexToRgb(BRAND.blue));
  drawText(canvas, "PATTERN XI", { x: 564, baseline: 232, size: 108, weight: 800, color: BRAND.text, letterSpacing: 0.01 });
  drawText(canvas, SHARE_TAGLINE, { x: 564, baseline: 300, size: 32, weight: 500, color: BRAND.muted });
  drawText(canvas, X_HANDLE_URL, { x: 564, baseline: 352, size: 27, weight: 500, color: BRAND.faint });
  return encodePng(canvas);
}

// Social share card (Open Graph / X summary_large_image). Its own layout —
// never a crop of the banner.
export function renderShareCardPng() {
  const canvas = createCanvas(1200, 630);
  clearCanvas(canvas, hexToRgb(BRAND.bg));
  strokeRing(canvas, 1180, 700, 300, 1.5, hexToRgb(BRAND.line), 0.5);
  strokeRing(canvas, 1180, 700, 240, 3, hexToRgb(BRAND.blue), 0.8);
  drawMasterLockup(canvas, { scale: 64 / 512, centreX: 96, centreY: 72 });
  drawText(canvas, "PATTERN XI", { x: 176, baseline: 116, size: 34, weight: 800, color: BRAND.text, letterSpacing: 0.02 });
  drawText(canvas, "Independent football picks.", { x: 96, baseline: 302, size: 58, weight: 700, color: BRAND.text, letterSpacing: -0.01 });
  drawText(canvas, "Public record.", { x: 96, baseline: 372, size: 58, weight: 700, color: BRAND.text, letterSpacing: -0.01 });
  fillRect(canvas, 96, 428, 500, 1.5, hexToRgb(BRAND.line));
  drawText(canvas, SHARE_AUX_LINE, { x: 96, baseline: 486, size: 30, weight: 500, color: BRAND.muted });
  return encodePng(canvas);
}
