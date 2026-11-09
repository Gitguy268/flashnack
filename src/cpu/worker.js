// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Runs the CPU backend off the main thread. Written 2026-11-09 for Flashnack.
import { CpuBackend } from './backend.js';

const b = new CpuBackend();
const images = new Map();

self.onmessage = ({ data: m }) => {
  try {
    if (m.op === 'lut') b.setLut(m.lutId, m.table, m.size);
    else if (m.op === 'grain') b.setGrainTiles(m.tiles);
    else if (m.op === 'set') images.set(m.key, { develop: { data: m.data, w: m.w, h: m.h }, baked: null, bakedKey: null, isJpeg: m.isJpeg });
    else if (m.op === 'drop') images.delete(m.key);
    else if (m.op === 'draw') {
      const img = images.get(m.key);
      if (!img) throw new Error('Image not loaded');
      b.bake(img, m.vibe, m.adj.rotation || 0);
      const opts = { ...m.opts };
      if (opts.previewScale) opts.preview = { w: Math.max(1, Math.round(img.baked.w * opts.previewScale)), h: Math.max(1, Math.round(img.baked.h * opts.previewScale)) };
      const f = b.render(img, m.vibe, m.adj, opts);
      const out = new Uint8Array(f.w * f.h * 4), s = f.data;
      for (let i = 0; i < s.length; i += 4) { out[i] = s[i] * 255; out[i + 1] = s[i + 1] * 255; out[i + 2] = s[i + 2] * 255; out[i + 3] = 255; }
      self.postMessage({ id: m.id, ok: true, w: f.w, h: f.h, rgba: out }, [out.buffer]);
      return;
    }
    if (m.id) self.postMessage({ id: m.id, ok: true });
  } catch (e) {
    self.postMessage({ id: m.id, ok: false, error: String(e?.message || e) });
  }
};
