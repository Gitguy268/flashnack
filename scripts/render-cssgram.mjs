// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Written 2026-11-23 for Flashnack.
//
// Turns CSSgram's Instagram-style CSS filters (Una Kravets, MIT,
// https://github.com/una/CSSgram) into 64³ LUT tile PNGs: Chromium draws an
// identity LUT image through each filter and we read the pixels back.
//
// A LUT can only hold colour, not position, so each gradient overlay is
// replaced by the colour it has in the middle of the photo (radial: its first
// stop; linear: the mean of its first two stops). Vignettes drop out.
//
// Usage: node scripts/render-cssgram.mjs <CSSgram checkout> <out folder>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { buildTable, tableToTiles, tilesToTable } from '../src/looks/lut-format.js';

const NAMED = { transparent: [0, 0, 0, 0], black: [0, 0, 0, 1], white: [255, 255, 255, 1] };
function parseColour(s) {
  if (NAMED[s]) return NAMED[s];
  if (s.startsWith('#')) {
    const h = s.length === 4 ? [...s.slice(1)].map((c) => c + c).join('') : s.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const v = s.slice(s.indexOf('(') + 1, -1).split(',').map(Number);
  return v.length === 3 ? [...v, 1] : v;
}
function flatten(gradient) {
  const stops = gradient.match(/rgba?\([^)]*\)|#[0-9a-f]{3,6}\b|\btransparent\b|\bblack\b|\bwhite\b/gi).map((s) => parseColour(s.toLowerCase()));
  const c = /^(-webkit-)?radial/.test(gradient) ? stops[0] : stops[0].map((v, i) => (v + stops[1][i]) / 2);
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${c[3].toFixed(3)})`;
}

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node scripts/render-cssgram.mjs <CSSgram checkout> <out folder>'); process.exit(1); }
mkdirSync(out, { recursive: true });

let css = readFileSync(join(src, 'source/css/cssgram.css'), 'utf8');
// Willow sets `background-color: radial-gradient(...)`, which browsers ignore; keep it ignored.
css = css.replace(/(background-color:\s*)?((-webkit-)?(radial|linear)-gradient\((?:[^()]|\([^()]*\))*\))/g, (m, bc, g) => (bc ? m : flatten(g)));
const classes = [...new Set(css.match(/^\.[a-z0-9_]+(?= \{)/gm).map((s) => s.slice(1)))];

const identity = tableToTiles(buildTable(64), 64);
const png = new PNG({ width: identity.w, height: identity.h });
png.data = Buffer.from(identity.rgba.buffer);
const dataUrl = `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;

const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><style>${css} html,body{margin:0;background:#000} figure{margin:0;width:512px;height:512px} img{display:block;width:512px;height:512px}</style>
  <figure id="f"><img id="i" src="${dataUrl}"></figure>`);
await page.waitForFunction(() => document.getElementById('i').complete);

async function grab(cls) {
  await page.evaluate((c) => { document.getElementById('f').className = c; }, cls);
  const buf = await page.locator('#f').screenshot({ animations: 'disabled' });
  const p = PNG.sync.read(buf);
  return tilesToTable(p.data, p.width, p.height).table;
}

// The page must hand back the identity image unchanged, or the readback is wrong.
const id = await grab('');
const ref = buildTable(64);
let maxErr = 0;
for (let i = 0; i < ref.length; i++) maxErr = Math.max(maxErr, Math.abs(id[i] - ref[i]) / 257);
if (maxErr > 1) throw new Error(`identity readback is off by ${maxErr} levels; check the colour profile flags`);
console.log(`identity readback: max error ${maxErr.toFixed(2)} levels`);

for (const cls of classes) {
  const t = await grab(cls);
  const tiles = tableToTiles(t, 64);
  const o = new PNG({ width: tiles.w, height: tiles.h });
  o.data = Buffer.from(tiles.rgba.buffer);
  writeFileSync(join(out, `${cls.replace(/^_/, '')}.png`), PNG.sync.write(o));
  console.log(cls);
}
await browser.close();
