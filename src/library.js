// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Turning dropped files into photos, and export file names. The naming is
// ported from LoFi Logic core/export_naming.py
// (https://github.com/lofilogic/flashback-raw-editor); modified 2026-11-09 by
// Lucas Van De Weerd: JavaScript port, the V1 roll token is a SHA-256 prefix
// (upstream uses BLAKE2s) because browsers have no BLAKE2.

import { VIBE_EXPORT_SUFFIX } from './config.js';

const RAW_EXT = new Set(['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'srw', '3fr', 'erf', 'kdc', 'dcr', 'mrw', 'x3f', 'iiq', 'rwl', 'mef', 'mos']);
const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif']);

export const ext = (name) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
export const stem = (name) => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

/** Collect files from a drop, including folders (recursively). */
export async function filesFromDrop(dt) {
  const items = [...(dt.items || [])].filter((i) => i.kind === 'file');
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])];
  const out = [];
  async function walk(entry, path) {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      out.push(Object.assign(f, { relPath: path + f.name }));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${path}${entry.name}/`);
      }
    }
  }
  for (const e of entries) await walk(e, '');
  return out;
}

/**
 * Sort files into photo sources. Loose V1 negatives (<stem> or <stem>.raw
 * next to <stem>.json) are paired up here; zips are returned separately so
 * the caller can unzip them in the worker.
 */
export async function classify(files) {
  const photos = [], zips = [], skipped = [];
  const byStem = new Map();
  for (const f of files) {
    const name = f.name;
    if (name.startsWith('.') || name.startsWith('._')) continue;
    const e = ext(name);
    if (e === 'zip') { zips.push(f); continue; }
    if (e === 'json' || e === 'raw' || e === '') { byStem.set(e === '' ? name : `${stem(name)}.${e}`, f); continue; }
    if (e === 'dng') photos.push({ file: f, name, kind: 'dng' });
    else if (RAW_EXT.has(e)) photos.push({ file: f, name, kind: 'raw' });
    else if (IMG_EXT.has(e)) photos.push({ file: f, name, kind: 'image', isJpeg: e === 'jpg' || e === 'jpeg' });
    else if (e === 'tif' || e === 'tiff') skipped.push({ name, reason: 'TIFF files are not supported; open the original DNG' });
    else skipped.push({ name, reason: 'Not a photo Flashnack can open' });
  }
  // Loose V1 negatives.
  for (const [key, json] of byStem) {
    if (!key.endsWith('.json')) continue;
    const s = key.slice(0, -5);
    const raw = byStem.get(s) || byStem.get(`${s}.raw`);
    if (!raw) continue;
    try {
      const meta = JSON.parse(await json.text());
      const w = parseInt(meta.width, 10), h = parseInt(meta.height, 10);
      if (raw.size !== w * h) continue;
      const mosaic = new Uint8Array(await raw.arrayBuffer());
      photos.push({ name: s, kind: 'v1', negative: { name: s, width: w, height: h, mosaic }, roll: json.relPath?.split('/').slice(-2, -1)[0] || 'roll' });
    } catch { /* not a negative */ }
  }
  photos.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { photos, zips, skipped };
}

// ---- export names (export_naming.py) ------------------------------------------

const V2_FRAME_RE = /^SN\d+_(\d+)$/i;
const pad5 = (s) => (/^\d+$/.test(s) ? String(parseInt(s, 10)).padStart(5, '0') : s);

export async function rollToken(rollId) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rollId)));
  return [...d.slice(0, 2)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Export name without the look suffix or extension. */
export async function exportBasename(photo) {
  if (photo.kind === 'v1') return `FBV1_${await rollToken(photo.roll || 'roll')}_${pad5(photo.negative.name)}`;
  const s = stem(photo.name);
  const m = s.match(V2_FRAME_RE);
  if (m) return `FBV2_${String(parseInt(m[1], 10)).padStart(5, '0')}`;
  if (photo.isJpeg) return `${s}_jpg`;
  return s;
}

export async function exportName(photo, vibeId) {
  return `${await exportBasename(photo)}_${VIBE_EXPORT_SUFFIX[vibeId] || 'edit'}.jpg`;
}

/** Make names unique within one export ("a.jpg", "a-2.jpg"). */
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = (seen.get(k) || 0) + 1;
    seen.set(k, c);
    return c === 1 ? n : n.replace(/\.jpg$/, `-${c}.jpg`);
  });
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
