// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Flashback ONE35 V1 negatives. Ported from LoFi Logic core/v1_negative.py
// (https://github.com/lofilogic/flashback-raw-editor). Modified 2026-11-09 by
// Lucas Van De Weerd: JavaScript port; zip entries are read in memory with
// fflate; the demosaic is a gradient-directed one written for Flashnack
// instead of OpenCV's COLOR_BayerRG2RGB_EA, so V1 output is close to, not
// identical with, the desktop app.

import { unzipSync } from 'fflate';
import { recoverHighlights, toRgba } from './dng-v2.js';
import { areaResize, fitLongEdge } from './resize.js';
import { XYZ_D50_TO_ACESCG, matmul3, kelvinToAcescgGain, tintToAcescgGain } from '../color.js';
import { BASE_KELVIN } from '../config.js';

export const V1_BLACK_LEVEL = 3.0;
export const V1_WHITE_LEVEL = 255.0;
export const V1_TARGET_LONG_EDGE = 2072;
export const V1_DITHER_LSB = 0.5;
export const V1_EXPOSURE_EV = -1.2;
export const V1_HIGHLIGHT_THRESHOLD = 0.97;
export const V1_WB_TEMP = -75.0;
export const V1_TINT = -4.0;
export const V1_ASN_D50 = [0.876826, 1.0, 0.862259];
export const V1_FORWARD_MATRIX = [
  [0.752684, 0.212928, -0.001412],
  [-0.006849, 1.438282, -0.431433],
  [0.24638, -1.381695, 1.960215],
];

const basename = (n) => n.split(/[\\/]/).pop();

/**
 * Pull V1 negatives out of a roll zip: each <stem>.json with a matching
 * <stem> or <stem>.raw of exactly width*height bytes. Only base names are
 * used, so archive paths can't point anywhere.
 */
export function extractNegatives(zipBytes) {
  const files = unzipSync(zipBytes);
  const byBase = new Map();
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/') || name.includes('__MACOSX')) continue;
    const b = basename(name);
    if (b && !b.startsWith('._')) byBase.set(b, data);
  }
  const out = [];
  for (const [b, json] of byBase) {
    if (!b.toLowerCase().endsWith('.json')) continue;
    const stem = b.slice(0, -5);
    const raw = byBase.get(stem) || byBase.get(`${stem}.raw`);
    if (!raw) continue;
    let meta;
    try { meta = JSON.parse(new TextDecoder().decode(json)); } catch { continue; }
    const w = parseInt(meta.width, 10), h = parseInt(meta.height, 10);
    if (!(w > 0 && h > 0) || raw.length !== w * h) continue;
    out.push({ name: stem, width: w, height: h, mosaic: raw, meta });
  }
  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}

// Small seeded RNG (mulberry32) for the dither, so a frame develops the same each time.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * RGGB demosaic: green by the smaller gradient, red/blue by bilinear colour
 * differences against green. In: Float32 mosaic 0..1. Out: Float32 RGB.
 */
export function demosaicRGGB(m, w, h) {
  const at = (x, y) => m[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const G = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const isG = ((x + y) & 1) === 1;
      if (isG) { G[i] = m[i]; continue; }
      const l = at(x - 1, y), r = at(x + 1, y), u = at(x, y - 1), d = at(x, y + 1);
      const c = m[i];
      const dh = Math.abs(l - r) + Math.abs(2 * c - at(x - 2, y) - at(x + 2, y));
      const dv = Math.abs(u - d) + Math.abs(2 * c - at(x, y - 2) - at(x, y + 2));
      G[i] = dh < dv ? (l + r) / 2 : dv < dh ? (u + d) / 2 : (l + r + u + d) / 4;
    }
  }
  const gAt = (x, y) => G[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const diff = (x, y) => at(x, y) - gAt(x, y);
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 3, g = G[i];
      const ry = y & 1, rx = x & 1; // R at (0,0), B at (1,1)
      let R, B;
      if (!ry && !rx) { // red site
        R = m[i];
        B = g + (diff(x - 1, y - 1) + diff(x + 1, y - 1) + diff(x - 1, y + 1) + diff(x + 1, y + 1)) / 4;
      } else if (ry && rx) { // blue site
        B = m[i];
        R = g + (diff(x - 1, y - 1) + diff(x + 1, y - 1) + diff(x - 1, y + 1) + diff(x + 1, y + 1)) / 4;
      } else if (!ry) { // green on a red row: red left/right, blue up/down
        R = g + (diff(x - 1, y) + diff(x + 1, y)) / 2;
        B = g + (diff(x, y - 1) + diff(x, y + 1)) / 2;
      } else { // green on a blue row
        B = g + (diff(x - 1, y) + diff(x + 1, y)) / 2;
        R = g + (diff(x, y - 1) + diff(x, y + 1)) / 2;
      }
      out[o] = Math.min(1, Math.max(0, R)); out[o + 1] = g; out[o + 2] = Math.min(1, Math.max(0, B));
    }
  }
  return out;
}

/** Develop one V1 negative to linear ACEScg RGBA. */
export function developV1({ mosaic, width, height }, seed = 0) {
  const rand = rng(seed);
  const n = width * height;
  const lin = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = mosaic[i] + (rand() - rand()) * V1_DITHER_LSB;
    // 16-bit quantisation, as upstream feeds OpenCV a uint16 image.
    lin[i] = Math.trunc(Math.min(1, Math.max(0, (x - V1_BLACK_LEVEL) / (V1_WHITE_LEVEL - V1_BLACK_LEVEL))) * 65535) / 65535;
  }
  let rgb = demosaicRGGB(lin, width, height);
  let [w, h] = [width, height];
  const [tw, th] = fitLongEdge(width, height, V1_TARGET_LONG_EDGE);
  if (tw !== w || th !== h) { rgb = areaResize(rgb, w, h, 3, tw, th); w = tw; h = th; }

  const wb = recoverHighlights(rgb, w, h, V1_ASN_D50, V1_HIGHLIGHT_THRESHOLD);
  const expGain = 2 ** V1_EXPOSURE_EV;
  const match = kelvinToAcescgGain(BASE_KELVIN + V1_WB_TEMP).map((g, i) => g * tintToAcescgGain(V1_TINT)[i]);
  // ACEScg = match * (XYZ_D50_TO_ACESCG @ FM) @ (rgb * expGain)
  const M = matmul3(XYZ_D50_TO_ACESCG, V1_FORWARD_MATRIX).map((row, r) => row.map((v) => v * expGain * match[r]));
  return { data: toRgba(wb, w * h, M), width: w, height: h };
}
