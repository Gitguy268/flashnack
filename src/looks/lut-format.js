// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Written 2026-11-23 for Flashnack.
//
// 3D LUT image formats. Every table here is a Uint16Array laid out as
// table[r][g][b][rgb] with 0..65535 meaning 0..1, the order lut_tex.wgsl and
// display_lut_tex.wgsl index.
//
// Tile image ("LUT PNG", the Flashback app format): an n³ LUT drawn as
// (w / n) × (h / n) tiles of n × n pixels. Inside a tile x is red and y is
// green; tiles are numbered row by row and the tile number is blue.
// 64³ fits in 512 × 512 (8 × 8 tiles).
//
// HaldCLUT (RawTherapee, G'MIC, darktable): level L is an L³ × L³ image of an
// L²-sized cube, one entry per pixel in reading order with red fastest:
// pixel index = r + g·N + b·N².

export const LOOK_LUT_SIZE = 64;

const u16 = (v8) => v8 * 257;

/** Size of the cube in a tile image, or 0 when it is not one. */
export function tileCubeSize(w, h) {
  const n = Math.round(Math.cbrt(w * h));
  return n ** 3 === w * h && w % n === 0 && h % n === 0 ? n : 0;
}

/** RGBA pixels of a tile image -> table. */
export function tilesToTable(rgba, w, h) {
  const n = tileCubeSize(w, h);
  if (!n) throw new Error(`${w}×${h} is not a LUT tile image`);
  const perRow = w / n;
  const out = new Uint16Array(n ** 3 * 3);
  for (let b = 0; b < n; b++) {
    const tx = (b % perRow) * n, ty = Math.floor(b / perRow) * n;
    for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      const s = ((ty + g) * w + tx + r) * 4, d = ((r * n + g) * n + b) * 3;
      out[d] = u16(rgba[s]); out[d + 1] = u16(rgba[s + 1]); out[d + 2] = u16(rgba[s + 2]);
    }
  }
  return { table: out, size: n };
}

/** Table -> RGBA pixels of a square-ish tile image (64³ -> 512 × 512). */
export function tableToTiles(table, n) {
  const perRow = Math.round(Math.sqrt(n));
  if (perRow * perRow !== n) throw new Error(`a ${n}³ LUT has no square tile layout`);
  const w = n * perRow, h = w;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let b = 0; b < n; b++) {
    const tx = (b % perRow) * n, ty = Math.floor(b / perRow) * n;
    for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      const s = ((r * n + g) * n + b) * 3, d = ((ty + g) * w + tx + r) * 4;
      rgba[d] = Math.round(table[s] / 257); rgba[d + 1] = Math.round(table[s + 1] / 257); rgba[d + 2] = Math.round(table[s + 2] / 257); rgba[d + 3] = 255;
    }
  }
  return { rgba, w, h };
}

/** RGBA pixels of a HaldCLUT -> table. */
export function haldToTable(rgba, w, h) {
  const level = Math.round(Math.cbrt(w));
  if (w !== h || level ** 3 !== w) throw new Error(`${w}×${h} is not a HaldCLUT`);
  const n = level * level;
  const out = new Uint16Array(n ** 3 * 3);
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const s = (r + g * n + b * n * n) * 4, d = ((r * n + g) * n + b) * 3;
    out[d] = u16(rgba[s]); out[d + 1] = u16(rgba[s + 1]); out[d + 2] = u16(rgba[s + 2]);
  }
  return { table: out, size: n };
}

/** Trilinear resample of an n³ table to m³. */
export function resampleTable(table, n, m) {
  if (n === m) return table;
  const out = new Uint16Array(m ** 3 * 3);
  const at = (r, g, b, c) => table[((r * n + g) * n + b) * 3 + c];
  const axis = (i) => { const x = (i * (n - 1)) / (m - 1), i0 = Math.min(Math.floor(x), n - 2); return [i0, x - i0]; };
  for (let r = 0; r < m; r++) {
    const [r0, fr] = axis(r);
    for (let g = 0; g < m; g++) {
      const [g0, fg] = axis(g);
      for (let b = 0; b < m; b++) {
        const [b0, fb] = axis(b);
        for (let c = 0; c < 3; c++) {
          const lerp = (a, z, t) => a + (z - a) * t;
          const c00 = lerp(at(r0, g0, b0, c), at(r0 + 1, g0, b0, c), fr);
          const c10 = lerp(at(r0, g0 + 1, b0, c), at(r0 + 1, g0 + 1, b0, c), fr);
          const c01 = lerp(at(r0, g0, b0 + 1, c), at(r0 + 1, g0, b0 + 1, c), fr);
          const c11 = lerp(at(r0, g0 + 1, b0 + 1, c), at(r0 + 1, g0 + 1, b0 + 1, c), fr);
          out[((r * m + g) * m + b) * 3 + c] = Math.round(lerp(lerp(c00, c10, fg), lerp(c01, c11, fg), fb));
        }
      }
    }
  }
  return out;
}

/** Identity table of size n, built by fn(r, g, b) -> [r, g, b] in 0..1 (default: identity). */
export function buildTable(n, fn = (r, g, b) => [r, g, b]) {
  const out = new Uint16Array(n ** 3 * 3);
  for (let r = 0; r < n; r++) for (let g = 0; g < n; g++) for (let b = 0; b < n; b++) {
    const v = fn(r / (n - 1), g / (n - 1), b / (n - 1));
    const d = ((r * n + g) * n + b) * 3;
    for (let c = 0; c < 3; c++) out[d + c] = Math.round(Math.min(1, Math.max(0, v[c])) * 65535);
  }
  return out;
}

/** Identity HaldCLUT pixels of a level (for tests and for rendering CSS looks). */
export function identityHald(level) {
  const n = level * level, w = level ** 3;
  const rgba = new Uint8ClampedArray(w * w * 4);
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const i = (r + g * n + b * n * n) * 4;
    rgba[i] = Math.round((r * 255) / (n - 1)); rgba[i + 1] = Math.round((g * 255) / (n - 1)); rgba[i + 2] = Math.round((b * 255) / (n - 1)); rgba[i + 3] = 255;
  }
  return { rgba, w, h: w };
}
