// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// CPU backend: the same stages as the WebGPU shaders, in plain JavaScript,
// for browsers without WebGPU. Each function follows its shader in
// src/gpu/shaders (from LoFi Logic core/shaders and the numpy fallbacks in
// core/effects.py, https://github.com/lofilogic/flashback-raw-editor).
// Written 2026-11-09 by Lucas Van De Weerd. Very wide Gaussian blurs (bloom)
// use three box passes here, so CPU output is close to, not identical with,
// the GPU output.

import { HALATION_SCALES, halationScaleTint, cnrSigmaColor, PROFILE_TONE_CURVE } from '../config.js';
import { buildToneCurveLut, ACESCG_TO_PROPHOTO_ROWVEC as A2P, PROPHOTO_TO_LINSRGB_ROWVEC as P2S } from '../color.js';
import { gaussKernel, expKernel, pyRound } from '../gpu/kernels.js';
import { bakeFrame, renderFrame } from '../render.js';

const frame = (w, h) => ({ data: new Float32Array(w * h * 4), w, h });
const clampi = (v, a, b) => (v < a ? a : v > b ? b : v);

function encodeV(v) {
  if (v !== v) v = 0;
  v = Math.max(v, 1e-10);
  return v <= 0.0078125 ? 10.5402377416545 * v + 0.0729055341958355 : (Math.log2(v) + 9.72) / 17.52;
}
const oetf = (x) => { const c = clampi(x, 0, 1); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; };
const eotf = (x) => { const c = clampi(x, 0, 1); return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

function map(f, fn) {
  const o = frame(f.w, f.h), s = f.data, d = o.data;
  for (let i = 0; i < s.length; i += 4) { fn(s, d, i); d[i + 3] = 1; }
  return o;
}

export class CpuBackend {
  constructor() {
    this.luts = new Map();
    this.tone = this.tone.bind(this);
    this.curve = buildToneCurveLut(PROFILE_TONE_CURVE, 4096);
  }

  begin() {}
  end() {}
  release() {}
  keepAs(f) { return f === this._develop ? { data: f.data.slice(), w: f.w, h: f.h } : f; }
  get hasGrain() { return !!this.tiles; }
  hasLut(id) { return !!id && this.luts.has(id); }
  setLut(id, table, size) {
    if (this.luts.has(id)) return;
    const f = new Float32Array(table.length);
    for (let i = 0; i < table.length; i++) f[i] = table[i] / 65535;
    this.luts.set(id, { t: f, n: size });
  }
  setGrainTiles(tiles) { this.tiles = tiles; }

  bake(img, vibe, rotation) { this._develop = img.develop; bakeFrame(this, img, vibe, rotation); }
  render(img, vibe, adj, opts) { return renderFrame(this, img, vibe, adj, opts); }

  // ---- geometry ----
  rotate(f, q) {
    const [w, h] = q % 2 ? [f.h, f.w] : [f.w, f.h];
    const o = frame(w, h), s = f.data, d = o.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sx, sy;
      if (q === 1) { sx = y; sy = f.h - 1 - x; } else if (q === 2) { sx = f.w - 1 - x; sy = f.h - 1 - y; } else { sx = f.w - 1 - y; sy = x; }
      const a = (sy * f.w + sx) * 4, b = (y * w + x) * 4;
      d[b] = s[a]; d[b + 1] = s[a + 1]; d[b + 2] = s[a + 2]; d[b + 3] = 1;
    }
    return o;
  }

  downsampleTo(f, w, h) {
    const o = frame(w, h), s = f.data, d = o.data, sx = f.w / w, sy = f.h / h;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * sy), y1 = Math.min(Math.max(y0 + 1, Math.floor((y + 1) * sy)), f.h);
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * sx), x1 = Math.min(Math.max(x0 + 1, Math.floor((x + 1) * sx)), f.w);
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * f.w + xx) * 4; r += s[i]; g += s[i + 1]; b += s[i + 2]; n++; }
        const o4 = (y * w + x) * 4; n = Math.max(n, 1);
        d[o4] = r / n; d[o4 + 1] = g / n; d[o4 + 2] = b / n; d[o4 + 3] = 1;
      }
    }
    return o;
  }
  downsample(f, factor) { return this.downsampleTo(f, Math.max(4, Math.floor(f.w / factor)), Math.max(4, Math.floor(f.h / factor))); }

  /** Bilinear sample of `small` at small-space position (cv2 convention, clamp to edge). */
  _bilinear(small, px, py, out) {
    const p0x = clampi(px, 0, small.w - 1), p0y = clampi(py, 0, small.h - 1);
    const x0 = Math.floor(p0x), y0 = Math.floor(p0y), fx = p0x - x0, fy = p0y - y0;
    const x1 = Math.min(x0 + 1, small.w - 1), y1 = Math.min(y0 + 1, small.h - 1), s = small.data;
    const a = (y0 * small.w + x0) * 4, b = (y0 * small.w + x1) * 4, c = (y1 * small.w + x0) * 4, e = (y1 * small.w + x1) * 4;
    for (let k = 0; k < 3; k++) {
      const top = s[a + k] + (s[b + k] - s[a + k]) * fx, bot = s[c + k] + (s[e + k] - s[c + k]) * fx;
      out[k] = top + (bot - top) * fy;
    }
  }
  upsample(small, w, h) {
    const o = frame(w, h), d = o.data, rx = small.w / w, ry = small.h / h, t = [0, 0, 0];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      this._bilinear(small, (x + 0.5) * rx - 0.5, (y + 0.5) * ry - 0.5, t);
      const i = (y * w + x) * 4; d[i] = t[0]; d[i + 1] = t[1]; d[i + 2] = t[2]; d[i + 3] = 1;
    }
    return o;
  }

  // ---- blurs ----
  _separable(f, k) {
    const n = k.length, half = n >> 1, { w, h } = f;
    const tmp = new Float32Array(w * h * 4), o = frame(w, h), s = f.data, d = o.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < n; j++) { const i = (y * w + clampi(x + j - half, 0, w - 1)) * 4, kv = k[j]; r += s[i] * kv; g += s[i + 1] * kv; b += s[i + 2] * kv; }
      const i = (y * w + x) * 4; tmp[i] = r; tmp[i + 1] = g; tmp[i + 2] = b;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < n; j++) { const i = (clampi(y + j - half, 0, h - 1) * w + x) * 4, kv = k[j]; r += tmp[i] * kv; g += tmp[i + 1] * kv; b += tmp[i + 2] * kv; }
      const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 1;
    }
    return o;
  }
  _boxPass(f, r) {
    // Horizontal then vertical running-sum box of width 2r+1, clamp to edge.
    const { w, h } = f, s = f.data, tmp = new Float32Array(w * h * 4), o = frame(w, h), d = o.data, n = 2 * r + 1;
    for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += s[(y * w + clampi(j, 0, w - 1)) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = acc / n;
        acc += s[(y * w + clampi(x + r + 1, 0, w - 1)) * 4 + c] - s[(y * w + clampi(x - r, 0, w - 1)) * 4 + c];
      }
    }
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += tmp[(clampi(j, 0, h - 1) * w + x) * 4 + c];
      for (let y = 0; y < h; y++) {
        d[(y * w + x) * 4 + c] = acc / n;
        acc += tmp[(clampi(y + r + 1, 0, h - 1) * w + x) * 4 + c] - tmp[(clampi(y - r, 0, h - 1) * w + x) * 4 + c];
      }
    }
    for (let i = 3; i < d.length; i += 4) d[i] = 1;
    return o;
  }
  blur(f, sigma) {
    if (sigma <= 0) return f;
    if (sigma > 12) {
      // Three box passes approximate a Gaussian of this sigma.
      const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
      return this._boxPass(this._boxPass(this._boxPass(f, r), r), r);
    }
    return this._separable(f, gaussKernel(sigma));
  }
  blurExp(f, lam) { return lam <= 0 ? f : this._separable(f, expKernel(lam)); }
  disc(f, radius) {
    if (radius <= 0) return f;
    const r = pyRound(radius), r2 = r * r, { w, h } = f, s = f.data, o = frame(w, h), d = o.data;
    const offs = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r2) offs.push(dx, dy);
    const n = offs.length / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0;
      for (let k = 0; k < offs.length; k += 2) { const i = (clampi(y + offs[k + 1], 0, h - 1) * w + clampi(x + offs[k], 0, w - 1)) * 4; a += s[i]; b += s[i + 1]; c += s[i + 2]; }
      const i = (y * w + x) * 4; d[i] = a / n; d[i + 1] = b / n; d[i + 2] = c / n; d[i + 3] = 1;
    }
    return o;
  }

  // ---- pre-LUT ----
  gainStage(f, g) { return map(f, (s, d, i) => { d[i] = s[i] * g[0]; d[i + 1] = s[i + 1] * g[1]; d[i + 2] = s[i + 2] * g[2]; }); }

  halation(f, threshold, blurRadius, strength, warmthPct, k = 20) {
    const glows = HALATION_SCALES.map(([rm, off, weight, gf, bf, kind]) => {
      const tint = halationScaleTint(gf, bf, weight, warmthPct), thr = Math.min(threshold + off, 0.98);
      let mask = map(f, (s, d, i) => { const m = 1 / (1 + Math.exp(-k * (encodeV(Math.max(s[i], s[i + 1], s[i + 2])) - thr))); d[i] = d[i + 1] = d[i + 2] = m; });
      mask = this.blur(mask, 2.0);
      const md = mask.data;
      const hi = map(f, (s, d, i) => { d[i] = s[i] * md[i] * tint[0]; d[i + 1] = s[i + 1] * md[i] * tint[1]; d[i + 2] = s[i + 2] * md[i] * tint[2]; });
      let small = this.downsample(hi, 2);
      const size = blurRadius * rm;
      small = kind === 'disc' ? this.disc(small, size * 0.5) : this.blurExp(small, size * 0.5);
      return this.upsample(small, f.w, f.h).data;
    });
    return map(f, (s, d, i) => {
      for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, s[i + c] + (glows[0][i + c] + glows[1][i + c] + glows[2][i + c]) * strength);
    });
  }

  vignette(f, strength, colorShift, feather) {
    if (strength <= 0) return f;
    const { w, h } = f, o = frame(w, h), s = f.data, d = o.data;
    const dx = Math.max(w - 1, 1), dy = Math.max(h - 1, 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = (x / dx) * 2 - 1, Y = (y / dy) * 2 - 1;
      const r = clampi(Math.hypot(X, Y) * 0.70710678118655, 0, 1);
      const base = 0.5 * (1 + Math.cos(Math.PI * r));
      const fall = base <= 0 ? 0 : base ** feather;
      const dark = 1 - strength * (1 - fall), edge = 1 - fall, i = (y * w + x) * 4;
      d[i] = Math.max(0, s[i] * (dark - colorShift * edge));
      d[i + 1] = Math.max(0, s[i + 1] * dark);
      d[i + 2] = Math.max(0, s[i + 2] * (dark + colorShift * 0.4 * edge));
      d[i + 3] = 1;
    }
    return o;
  }

  bloom(f, strength, threshold) {
    if (strength <= 0) return f;
    const bw = Math.max(4, Math.floor(f.w / 4)), bh = Math.max(4, Math.floor(f.h / 4));
    const small = this.downsampleTo(f, bw, bh), sd = small.data;
    for (let i = 0; i < sd.length; i += 4) {
      const l = 0.2722 * sd[i] + 0.6741 * sd[i + 1] + 0.0537 * sd[i + 2];
      const m = clampi((encodeV(l) - threshold) / Math.max(0.01, 1 - threshold), 0, 1);
      sd[i] *= m; sd[i + 1] *= m; sd[i + 2] *= m;
    }
    const blurred = this.blur(small, Math.max(2, Math.floor(Math.max(bw, bh) / 5)));
    const up = this.upsample(blurred, f.w, f.h).data;
    return map(f, (s, d, i) => { for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, s[i + c] + up[i + c] * strength); });
  }

  cnr(f, sigma, [thrGreen, thrOther]) {
    if (sigma <= 0 && thrGreen <= 0) return f;
    const { w, h } = f;
    let lab = map(f, (s, d, i) => toLab(s, i, d));
    if (thrGreen > 0) {
      const src = lab.data, o = frame(w, h), d = o.data, va = new Float32Array(9), vb = new Float32Array(9);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = (clampi(y + dy, 0, h - 1) * w + clampi(x + dx, 0, w - 1)) * 4; va[k] = src[j + 1]; vb[k] = src[j + 2]; k++; }
        va.sort(); vb.sort();
        const i = (y * w + x) * 4;
        d[i] = src[i];
        d[i + 1] = clampi(src[i + 1], va[4] - thrGreen, va[4] + thrOther);
        d[i + 2] = clampi(src[i + 2], vb[4] - thrOther, vb[4] + thrOther);
        d[i + 3] = 1;
      }
      lab = o;
    }
    if (sigma > 0) {
      let dd = Math.max(5, Math.trunc(sigma) * 2 + 3);
      if (dd % 2 === 0) dd += 1;
      const rad = Math.floor(dd / 2), r2 = rad * rad, cs = -0.5 / (sigma * sigma), sc = cnrSigmaColor(sigma), cr = -0.5 / (sc * sc);
      const offs = [];
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= r2) offs.push(dx, dy, Math.exp((dx * dx + dy * dy) * cs));
      const src = lab.data, o = frame(w, h), d = o.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, ca = src[i + 1], cb = src[i + 2];
        let aa = 0, ab = 0, wa = 0, wb = 0;
        for (let k = 0; k < offs.length; k += 3) {
          const j = (clampi(y + offs[k + 1], 0, h - 1) * w + clampi(x + offs[k], 0, w - 1)) * 4, ws = offs[k + 2];
          const da = src[j + 1] - ca, db = src[j + 2] - cb;
          const xa = ws * Math.exp(da * da * cr), xb = ws * Math.exp(db * db * cr);
          aa += src[j + 1] * xa; ab += src[j + 2] * xb; wa += xa; wb += xb;
        }
        d[i] = src[i]; d[i + 1] = aa / Math.max(wa, 1e-12); d[i + 2] = ab / Math.max(wb, 1e-12); d[i + 3] = 1;
      }
      lab = o;
    }
    return map(lab, (s, d, i) => fromLab(s, i, d));
  }

  // ---- LUT / tone ----
  encode(f) { return map(f, (s, d, i) => { d[i] = encodeV(s[i]); d[i + 1] = encodeV(s[i + 1]); d[i + 2] = encodeV(s[i + 2]); }); }

  lutStage(f, id) {
    const { t, n } = this.luts.get(id), m = n - 1;
    const at = (r, g, b, c) => t[((r * n + g) * n + b) * 3 + c];
    return map(f, (s, d, i) => {
      const R = clampi(s[i], 0, 1) * m, G = clampi(s[i + 1], 0, 1) * m, B = clampi(s[i + 2], 0, 1) * m;
      const r0 = Math.min(Math.trunc(R), n - 2), g0 = Math.min(Math.trunc(G), n - 2), b0 = Math.min(Math.trunc(B), n - 2);
      const rx = R - r0, gx = G - g0, bx = B - b0;
      for (let c = 0; c < 3; c++) {
        const c000 = at(r0, g0, b0, c), c111 = at(r0 + 1, g0 + 1, b0 + 1, c);
        let v;
        if (rx >= gx && gx >= bx) v = (1 - rx) * c000 + (rx - gx) * at(r0 + 1, g0, b0, c) + (gx - bx) * at(r0 + 1, g0 + 1, b0, c) + bx * c111;
        else if (rx >= bx && bx > gx) v = (1 - rx) * c000 + (rx - bx) * at(r0 + 1, g0, b0, c) + (bx - gx) * at(r0 + 1, g0, b0 + 1, c) + gx * c111;
        else if (gx > rx && rx >= bx) v = (1 - gx) * c000 + (gx - rx) * at(r0, g0 + 1, b0, c) + (rx - bx) * at(r0 + 1, g0 + 1, b0, c) + bx * c111;
        else if (bx > rx && rx >= gx) v = (1 - bx) * c000 + (bx - rx) * at(r0, g0, b0 + 1, c) + (rx - gx) * at(r0 + 1, g0, b0 + 1, c) + gx * c111;
        else if (gx >= bx && bx > rx) v = (1 - gx) * c000 + (gx - bx) * at(r0, g0 + 1, b0, c) + (bx - rx) * at(r0, g0 + 1, b0 + 1, c) + rx * c111;
        else v = (1 - bx) * c000 + (bx - gx) * at(r0, g0, b0 + 1, c) + (gx - rx) * at(r0, g0 + 1, b0 + 1, c) + rx * c111;
        d[i + c] = v;
      }
    });
  }

  tone(f) {
    const cv = this.curve, n = cv.length - 1;
    const tc = (x) => cv[Math.trunc(clampi(x * n, 0, n))];
    return map(f, (s, d, i) => {
      const v = [s[i], s[i + 1], s[i + 2]];
      const pp = [0, 1, 2].map((j) => tc(clampi(v[0] * A2P[0][j] + v[1] * A2P[1][j] + v[2] * A2P[2][j], 0, 1)));
      for (let j = 0; j < 3; j++) d[i + j] = oetf(clampi(pp[0] * P2S[0][j] + pp[1] * P2S[1][j] + pp[2] * P2S[2][j], 0, 1));
    });
  }

  // ---- post-LUT ----
  ca(f, scale, samples = 16) {
    if (scale <= 0) return f;
    const { w, h } = f, o = frame(w, h), d = o.data, cx = w / 2, cy = h / 2, t = [0, 0, 0];
    const bands = [], scs = [];
    for (let k = 0; k < samples; k++) {
      const tt = samples > 1 ? k / (samples - 1) : 0, s2 = 2 * 0.25 * 0.25;
      bands.push([Math.exp(-(tt ** 2) / s2), Math.exp(-((tt - 0.5) ** 2) / s2), Math.exp(-((tt - 1) ** 2) / s2)]);
      scs.push(1 / (1 + scale * tt));
    }
    const ws = [0, 1, 2].map((c) => Math.max(bands.reduce((a, b) => a + b[c], 0), 1e-8));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < samples; k++) {
        this._bilinear(f, cx + (x - cx) * scs[k], cy + (y - cy) * scs[k], t);
        r += t[0] * bands[k][0]; g += t[1] * bands[k][1]; b += t[2] * bands[k][2];
      }
      const i = (y * w + x) * 4; d[i] = r / ws[0]; d[i + 1] = g / ws[1]; d[i + 2] = b / ws[2]; d[i + 3] = 1;
    }
    return o;
  }

  edgeSoftness(f, sigma, strength, start) {
    if (strength <= 0 || sigma <= 0) return f;
    const bl = this.blur(f, sigma).data, { w, h } = f, cx = w / 2, cy = h / 2, R = Math.max(Math.hypot(cx, cy), 1e-6);
    return map(f, (s, d, i) => {
      const p = i / 4, x = p % w, y = (p - x) / w;
      const r = Math.hypot(x - cx, y - cy) / R;
      const t = clampi((r - start) / Math.max(1 - start, 1e-6), 0, 1), wgt = t * t * (3 - 2 * t) * strength;
      for (let c = 0; c < 3; c++) d[i + c] = s[i + c] + (bl[i + c] - s[i + c]) * wgt;
    });
  }

  grainLayer(w, h, seed, spatial) {
    const o = frame(w, h), d = o.data, tiles = this.tiles, tw = tiles[0].w, th = tiles[0].h;
    const cw = Math.max(1, Math.round(tw * spatial)), ch = Math.max(1, Math.round(th * spatial));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = hash((seed ^ hash(Math.imul(Math.floor(x / cw), 73856093) ^ Math.imul(Math.floor(y / ch), 19349663))) >>> 0);
      const tile = tiles[r % tiles.length];
      let tx = x % cw, ty = y % ch;
      if (r & 0x100) tx = cw - 1 - tx;
      if (r & 0x200) ty = ch - 1 - ty;
      tx = Math.min(Math.floor((tx * tw) / cw), tw - 1); ty = Math.min(Math.floor((ty * th) / ch), th - 1);
      const s = (ty * tw + tx) * 4, i = (y * w + x) * 4;
      d[i] = tile.data[s]; d[i + 1] = tile.data[s + 1]; d[i + 2] = tile.data[s + 2]; d[i + 3] = 1;
    }
    return o;
  }

  grain(f, layer, intensity, minGrain, bias) {
    const g = layer.data;
    return map(f, (s, d, i) => {
      for (let c = 0; c < 3; c++) {
        const v = s[i + c], delta = (2 * g[i + c] - 1) * intensity;
        const wgt = (1 - bias) * (1 - v) + bias * v;
        d[i + c] = clampi(v + delta * (minGrain + wgt * (1 - minGrain)), 0, 1);
      }
    });
  }

  sharpen(f, strength, radius) {
    const b = this.blur(f, radius).data;
    return map(f, (s, d, i) => { for (let c = 0; c < 3; c++) d[i + c] = s[i + c] + (s[i + c] - b[i + c]) * strength; });
  }

  finish(f, postGain, apply) {
    return map(f, (s, d, i) => {
      for (let c = 0; c < 3; c++) d[i + c] = clampi(apply ? oetf(eotf(s[i + c]) * postGain) : s[i + c], 0, 1);
    });
  }
}

// Same integer hash as grain_layer.wgsl.
function hash(v) {
  let x = v >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

// ---- Lab (cnr.wgsl) ----
const RX = [[0.6624541811, 0.1340042065, 0.1561876744], [0.2722287168, 0.6740817658, 0.0536895174], [-0.0055746495, 0.0040607335, 1.0103391685]];
const XR = [[1.6410233797, -0.3248032942, -0.2364246952], [-0.6636628587, 1.6153315917, 0.0167563477], [0.0117218943, -0.008284442, 0.9883948585]];
const WH = [0.95265, 1.0, 1.00883];
const fl = (t) => (t > 0.00885645167 ? Math.max(t, 0) ** 0.3333333333 : 7.78703703704 * t + 0.13793103448);
const fli = (t) => (t > 0.20689655172 ? t * t * t : (t - 0.13793103448) / 7.78703703704);
function toLab(s, i, d) {
  const xyz = RX.map((r, k) => Math.max(0, r[0] * s[i] + r[1] * s[i + 1] + r[2] * s[i + 2]) / WH[k]);
  const fx = fl(xyz[0]), fy = fl(xyz[1]), fz = fl(xyz[2]);
  d[i] = 116 * fy - 16; d[i + 1] = 500 * (fx - fy); d[i + 2] = 200 * (fy - fz);
}
function fromLab(s, i, d) {
  const fy = (s[i] + 16) / 116;
  const xyz = [fli(s[i + 1] / 500 + fy) * WH[0], fli(fy) * WH[1], fli(fy - s[i + 2] / 200) * WH[2]];
  for (let k = 0; k < 3; k++) d[i + k] = XR[k][0] * xyz[0] + XR[k][1] * xyz[1] + XR[k][2] * xyz[2];
}
