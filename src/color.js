// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Ported from LoFi Logic core/processor.py and core/kernels.py
// (https://github.com/lofilogic/flashback-raw-editor).
// Modified 2026-11-09 by Lucas Van De Weerd: JavaScript port. Matrices that
// upstream computes with colour-science at import time are written out as
// the numbers it produces.

// AsShotNeutral measured from a grey patch under D50 (upstream ASN_D50).
export const ASN_D50 = [0.541, 1.0, 0.597];

// (raw / ASN) -> ACEScg: XYZ_D50_TO_ACESCG @ FM1. Row-major, out = M @ rgb.
export const FM1_WB_TO_ACESCG = [
  [0.8218363523483276, 0.11412245035171509, 0.10277268290519714],
  [-0.21453669667243958, 1.4513344764709473, -0.24468983709812164],
  [0.05503483861684799, -0.4080877900123596, 1.2358322143554688],
];

export const XYZ_D50_TO_ACESCG = [
  [1.6217992305755615, -0.3342346251010895, -0.23128734529018402],
  [-0.6674062609672546, 1.6223080158233643, 0.01614714413881302],
  [0.014671995304524899, -0.01340832095593214, 1.0692698955535889],
];

const XYZ_D60_TO_ACESCG = [
  [1.6410233797, -0.3248032942, -0.2364246952],
  [-0.6636628587, 1.6153315917, 0.0167563477],
  [0.0117218943, -0.0082844420, 0.9883948585],
];

// linear sRGB -> ACEScg (inverse of upstream ACESCG_TO_LINSRGB).
export const LINSRGB_TO_ACESCG = [
  [0.6130985021591187, 0.33952417969703674, 0.047380730509757996],
  [0.07019608467817307, 0.9163590669631958, 0.013454047963023186],
  [0.020614199340343475, 0.10957042127847672, 0.8698165416717529],
];

// Applied upstream as row-vector @ M, i.e. out[j] = sum_i rgb[i] * M[i][j].
export const ACESCG_TO_PROPHOTO_ROWVEC = [
  [0.8550006747245789, 0.05183567479252815, -0.007084489334374666],
  [0.033093180507421494, 0.9368420243263245, 0.0018182897474616766],
  [0.1120852530002594, 0.011281534098088741, 1.0055404901504517],
];
export const PROPHOTO_TO_LINSRGB_ROWVEC = [
  [2.036491632461548, -0.22571797668933868, -0.010545128956437111],
  [-0.7375906705856323, 1.2231764793395996, -0.13487984240055084],
  [-0.29925987124443054, 0.002725224709138274, 1.1452101469039917],
];

export function matmul3(a, b) {
  return a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
}
export const transpose3 = (m) => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]);

// ---- white balance ------------------------------------------------------------

// CIE daylight locus (colour.temperature.CCT_to_xy_CIE_D), 4000-25000 K.
function cctToXyCieD(t) {
  const x = t <= 7000
    ? -4.607e9 / t ** 3 + 2.9678e6 / t ** 2 + 0.09911e3 / t + 0.244063
    : -2.0064e9 / t ** 3 + 1.9018e6 / t ** 2 + 0.24748e3 / t + 0.23704;
  return [x, -3 * x * x + 2.87 * x - 0.275];
}

// Kang et al. 2002 Planckian approximation (colour CCT_to_xy_Kang2002).
function cctToXyKang2002(t) {
  const x = t <= 4000
    ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991
    : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039;
  let y;
  if (t <= 2222) y = -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683;
  else if (t <= 4000) y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
  else y = 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

export function planckianXyz(cct) {
  const [x, y] = cct >= 4000 ? cctToXyCieD(cct) : cctToXyKang2002(cct);
  return [x / y, 1, (1 - x - y) / y];
}

const mulVec = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

// Per-channel ACEScg gain to shift white balance, G normalised to 1.
export function kelvinToAcescgGain(targetK, baseK = 5500) {
  const base = mulVec(XYZ_D60_TO_ACESCG, planckianXyz(baseK));
  const target = mulVec(XYZ_D60_TO_ACESCG, planckianXyz(targetK));
  const g = base.map((b, i) => b / target[i]);
  return [g[0] / g[1], 1, g[2] / g[1]];
}

// Green-magenta correction. Positive = magenta (less green).
export const tintToAcescgGain = (tint) => [1, 1 / (1 + tint * 0.018), 1];

// ---- transfer functions ---------------------------------------------------

export function acescctEncode(v) {
  v = Math.max(v, 1e-10);
  return v <= 0.0078125 ? 10.5402377416545 * v + 0.0729055341958355 : (Math.log2(v) + 9.72) / 17.52;
}
export function acescctDecode(v) {
  return v < 0.155251141552511 ? (v - 0.0729055341958355) / 10.5402377416545 : 2 ** (v * 17.52 - 9.72);
}
export function srgbOetf(x) {
  x = Math.min(1, Math.max(0, x));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}
export function srgbEotf(x) {
  x = Math.min(1, Math.max(0, x));
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

// ---- tone curves ------------------------------------------------------------

// Piecewise-linear profile tone curve as a 4096-entry table (np.interp).
export function buildToneCurveLut(pairs, size = 4096) {
  const xs = [], ys = [];
  for (let i = 0; i < pairs.length; i += 2) { xs.push(pairs[i]); ys.push(pairs[i + 1]); }
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    let k = 0;
    while (k < xs.length - 2 && x > xs[k + 1]) k++;
    const t = (x - xs[k]) / (xs[k + 1] - xs[k]);
    out[i] = ys[k] + Math.min(1, Math.max(0, t)) * (ys[k + 1] - ys[k]);
  }
  return out;
}

// Natural cubic spline through 0-255 points, sampled to `size` (scipy
// CubicSpline with bc_type='natural'), clipped to 0..1.
export function buildNaturalSplineLut(points, size = 4096) {
  const xs = points.map((p) => p[0] / 255), ys = points.map((p) => p[1] / 255);
  const n = xs.length - 1;
  const h = [], alpha = [0];
  for (let i = 0; i < n; i++) h.push(xs[i + 1] - xs[i]);
  for (let i = 1; i < n; i++) alpha.push((3 / h[i]) * (ys[i + 1] - ys[i]) - (3 / h[i - 1]) * (ys[i] - ys[i - 1]));
  const l = [1], mu = [0], z = [0];
  for (let i = 1; i < n; i++) {
    l.push(2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1]);
    mu.push(h[i] / l[i]);
    z.push((alpha[i] - h[i - 1] * z[i - 1]) / l[i]);
  }
  const c = new Array(n + 1).fill(0), b = new Array(n).fill(0), d = new Array(n).fill(0);
  for (let j = n - 1; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (ys[j + 1] - ys[j]) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    let k = 0;
    while (k < n - 1 && x > xs[k + 1]) k++;
    const dx = x - xs[k];
    out[i] = Math.min(1, Math.max(0, ys[k] + b[k] * dx + c[k] * dx * dx + d[k] * dx ** 3));
  }
  return out;
}
