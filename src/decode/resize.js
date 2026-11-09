// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Area (box) downscaling, the same idea as OpenCV's INTER_AREA that LoFi Logic
// uses for V1 negatives and grain tiles. New code, 2026-11-09.

/**
 * Downscale an interleaved Float32 image by area averaging.
 * Works for any ratio >= 1; each output pixel averages the source area it
 * covers, with fractional weights at the edges.
 */
export function areaResize(src, sw, sh, ch, dw, dh) {
  const out = new Float32Array(dw * dh * ch);
  const sx = sw / dw, sy = sh / dh;
  // Precompute horizontal spans.
  const xs = [];
  for (let x = 0; x < dw; x++) {
    const f0 = x * sx, f1 = (x + 1) * sx;
    const i0 = Math.floor(f0), i1 = Math.min(sw, Math.ceil(f1));
    const w = [];
    for (let i = i0; i < i1; i++) w.push(Math.min(f1, i + 1) - Math.max(f0, i));
    xs.push([i0, w]);
  }
  const row = new Float32Array(dw * ch);
  for (let y = 0; y < dh; y++) {
    const f0 = y * sy, f1 = (y + 1) * sy;
    const j0 = Math.floor(f0), j1 = Math.min(sh, Math.ceil(f1));
    const o = y * dw * ch;
    let wsumY = 0;
    for (let j = j0; j < j1; j++) {
      const wy = Math.min(f1, j + 1) - Math.max(f0, j);
      wsumY += wy;
      row.fill(0);
      const srow = j * sw * ch;
      for (let x = 0; x < dw; x++) {
        const [i0, w] = xs[x];
        for (let k = 0; k < w.length; k++) {
          const s = srow + (i0 + k) * ch;
          for (let c = 0; c < ch; c++) row[x * ch + c] += src[s + c] * w[k];
        }
      }
      for (let x = 0; x < dw * ch; x++) out[o + x] += row[x] * wy;
    }
    const norm = 1 / (wsumY * sx);
    for (let x = 0; x < dw * ch; x++) out[o + x] *= norm;
  }
  return out;
}

/** Size that fits `longEdge`, keeping the aspect ratio (cv2 rounding). */
export function fitLongEdge(w, h, longEdge) {
  if (Math.max(w, h) <= longEdge) return [w, h];
  const s = longEdge / Math.max(w, h);
  return [Math.round(w * s), Math.round(h * s)];
}
