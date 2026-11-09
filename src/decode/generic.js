// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Camera JPEG/PNG and other RAW files. Ported from LoFi Logic
// core/processor.py (_develop_srgb_jpeg, _jpeg_pre_grade, _jpeg_tone_curve,
// _develop_generic_raw, _wb_shift_to_kelvin, _read_generic_raw_boost_ev)
// (https://github.com/lofilogic/flashback-raw-editor). Modified 2026-11-09 by
// Lucas Van De Weerd: JavaScript port; other RAWs decode through libraw-wasm
// instead of rawpy, with its gamma curve undone (see libraw709Inverse).

import {
  LINSRGB_TO_ACESCG, srgbEotf, acescctEncode, acescctDecode,
  buildNaturalSplineLut, planckianXyz,
} from '../color.js';
import {
  JPEG_TONE_CURVE, JPEG_EXPOSURE_EV, JPEG_CONTRAST, JPEG_SATURATION,
  JPEG_SHADOW_SATURATION, JPEG_SHADOW_SAT_END_EV, BASE_KELVIN,
} from '../config.js';

const AP1_LUMA = [0.2722287, 0.6740818, 0.0536895];
const PS_LUMA = [0.30, 0.59, 0.11];
let jpegCurve = null;

/** sRGB 8-bit RGBA pixels -> linear ACEScg RGBA, with the JPEG pre-grade. */
export function developSrgb(rgba, w, h, baseEv = 2.0) {
  jpegCurve ||= buildNaturalSplineLut(JPEG_TONE_CURVE, 4096);
  const n = w * h, out = new Float32Array(n * 4);
  const eotf = new Float32Array(256);
  for (let i = 0; i < 256; i++) eotf[i] = srgbEotf(i / 255);
  const M = LINSRGB_TO_ACESCG, gain = 2 ** baseEv, nC = jpegCurve.length;
  const expG = 2 ** JPEG_EXPOSURE_EV;
  for (let i = 0; i < n; i++) {
    const r = eotf[rgba[i * 4]], g = eotf[rgba[i * 4 + 1]], b = eotf[rgba[i * 4 + 2]];
    let x = [
      M[0][0] * r + M[0][1] * g + M[0][2] * b,
      M[1][0] * r + M[1][1] * g + M[1][2] * b,
      M[2][0] * r + M[2][1] * g + M[2][2] * b,
    ];
    // Tone curve in ACEScct with the base offset, luminance only.
    const enc = x.map((v) => acescctEncode(Math.max(v * gain, 1e-10)));
    const cl = enc.map((v) => Math.min(1, Math.max(0, v)));
    const d = cl.reduce((acc, v, c) => acc + (jpegCurve[Math.trunc(v * (nC - 1) + 0.5)] - v) * PS_LUMA[c], 0);
    x = enc.map((v) => acescctDecode(v + d) / gain);
    x = x.map((v) => v * expG);
    if (JPEG_CONTRAST !== 1) x = x.map((v) => 0.18 * (Math.max(v, 0) / 0.18) ** JPEG_CONTRAST);
    let y = x[0] * AP1_LUMA[0] + x[1] * AP1_LUMA[1] + x[2] * AP1_LUMA[2];
    if (JPEG_SATURATION !== 1) x = x.map((v) => y + (v - y) * JPEG_SATURATION);
    if (JPEG_SHADOW_SATURATION !== 1) {
      y = x[0] * AP1_LUMA[0] + x[1] * AP1_LUMA[1] + x[2] * AP1_LUMA[2];
      const ev = Math.log2(Math.max(y, 1e-6) / 0.18);
      let t = Math.min(1, Math.max(0, (ev + 5) / (JPEG_SHADOW_SAT_END_EV + 5)));
      t = t * t * (3 - 2 * t);
      const sat = JPEG_SHADOW_SATURATION + (1 - JPEG_SHADOW_SATURATION) * t;
      x = x.map((v) => y + (v - y) * sat);
    }
    out[i * 4] = x[0]; out[i * 4 + 1] = x[1]; out[i * 4 + 2] = x[2]; out[i * 4 + 3] = 1;
  }
  return { data: out, width: w, height: h };
}

/** Decode a JPEG/PNG (any browser-supported image) to 8-bit RGBA, EXIF orientation applied. */
export async function decodeImage(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return { rgba: data, width: c.width, height: c.height };
}

// Exposure residual (EV) per make for RAWs without BaselineExposure,
// measured upstream against Adobe Camera Raw.
const BOOST_EV_BY_MAKE = {
  sony: -1.0, fujifilm: 0.0, fuji: 0.0, pentax: 0.5, ricoh: 0.5,
  'ricoh imaging company, ltd.': 0.5, apple: -0.5,
};
const GENERIC_RAW_ANCHOR_EV = 2.0;
const GENERIC_DAYLIGHT_K = 6504;

export function genericBoostEv(make, baselineExposure) {
  if (baselineExposure != null) return GENERIC_RAW_ANCHOR_EV + baselineExposure;
  return GENERIC_RAW_ANCHOR_EV + (BOOST_EV_BY_MAKE[String(make || '').trim().toLowerCase()] ?? 0);
}

/**
 * libraw-wasm 1.5 ignores a linear gamm setting and always applies LibRaw's
 * gamma_curve(gamm[0], gamm[1]), so ask for the default BT.709 curve
 * explicitly and undo it. Same maths as LibRaw's gamma_curve (mode 2, white
 * 0x10000). Returns a 65536-entry table from 16-bit output to linear 0..1.
 */
export function libraw709Inverse(pwr = 0.45, ts = 4.5) {
  const g = [pwr, ts, 0, 0, 0];
  const bnd = [0, 0];
  bnd[g[1] >= 1 ? 1 : 0] = 1;
  for (let i = 0; i < 48; i++) {
    g[2] = (bnd[0] + bnd[1]) / 2;
    bnd[((g[2] / g[1]) ** -g[0] - 1) / g[0] - 1 / g[2] > -1 ? 1 : 0] = g[2];
  }
  g[3] = g[2] / g[1];
  g[4] = g[2] * (1 / g[0] - 1);
  const t = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const y = i / 65536;
    t[i] = y < g[3] * g[1] ? y / g[1] : ((y + g[4]) / (1 + g[4])) ** (1 / g[0]);
  }
  return t;
}
let inv709 = null;

/**
 * Develop any RAW LibRaw can read: half size, linear 16-bit sRGB with the
 * camera's daylight WB, then shifted to 5500 K and lifted by the boost.
 */
// XYZ -> linear sRGB (IEC 61966-2-1), upstream _XYZ_TO_LINSRGB.
const XYZ_TO_LINSRGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];
const GENERIC_DAYLIGHT_WB_FALLBACK = [2.0, 1.0, 1.6, 1.0];

/** Shift Bayer WB multipliers from daylight (6504 K) to targetK (upstream _wb_shift_to_kelvin). */
export function wbShiftToKelvin(daylightWb, targetK, daylightK = GENERIC_DAYLIGHT_K) {
  const toRgb = (k) => { const xyz = planckianXyz(k); return XYZ_TO_LINSRGB.map((r) => Math.max(1e-6, r[0] * xyz[0] + r[1] * xyz[1] + r[2] * xyz[2])); };
  const dl = toRgb(daylightK), tg = toRgb(targetK);
  const scale = dl.map((v, i) => v / tg[i]);
  const s1 = scale[1];
  const wb = [...daylightWb];
  wb[0] = wb[0] * (scale[0] / s1);
  wb[2] = wb[2] * (scale[2] / s1);
  // Sony uses G2 = 0 for "same as G1"; keep the 0.
  if (wb.length > 3 && daylightWb[3] !== 0) wb[3] = wb[1];
  return wb;
}

/**
 * Develop any RAW LibRaw can read, like upstream _develop_generic_raw: half
 * size, linear 16-bit sRGB, the camera's daylight WB shifted to 5500 K, then
 * lifted by the exposure anchor. libraw-wasm decodes in one call, so a quick
 * first pass (no demosaic) reads the daylight multipliers.
 */
export async function developRawWithLibraw(bytes, { make, baselineExposure } = {}) {
  const { default: LibRaw } = await import('libraw-wasm');
  const probe = new LibRaw();
  let daylight, meta;
  try {
    await probe.open(bytes.slice(), { halfSize: true, noInterpolation: true });
    meta = await probe.metadata(true);
    daylight = meta?.color_data?.pre_mul;
  } finally {
    probe.dispose?.();
  }
  if (!daylight || daylight.every((v) => !v)) daylight = GENERIC_DAYLIGHT_WB_FALLBACK;
  const userMul = wbShiftToKelvin([...daylight].slice(0, 4), BASE_KELVIN);
  const raw = new LibRaw();
  try {
    await raw.open(bytes, {
      halfSize: true, outputBps: 16, outputColor: 1, gamm: [0.45, 4.5], noAutoBright: true,
      highlight: 2, userQual: 0, useCameraWb: false, useAutoWb: false, bright: 1, userMul,
    });
    const img = await raw.imageData();
    if (!img) throw new Error('LibRaw could not decode this file');
    const { width: w, height: h } = img;
    const px = img.data;
    const ch = px.length / (w * h);
    const boost = 2 ** genericBoostEv(make || meta?.camera_make || meta?.normalized_make, baselineExposure);
    const M = LINSRGB_TO_ACESCG.map((row) => row.map((v) => v * boost));
    inv709 ||= libraw709Inverse();
    const n = w * h, out = new Float32Array(n * 4), L = inv709;
    for (let i = 0; i < n; i++) {
      const r = L[px[i * ch]], g = L[px[i * ch + 1]], b = L[px[i * ch + 2]];
      out[i * 4] = M[0][0] * r + M[0][1] * g + M[0][2] * b;
      out[i * 4 + 1] = M[1][0] * r + M[1][1] * g + M[1][2] * b;
      out[i * 4 + 2] = M[2][0] * r + M[2][1] * g + M[2][2] * b;
      out[i * 4 + 3] = 1;
    }
    return { data: out, width: w, height: h, make: meta?.camera_make };
  } finally {
    raw.dispose?.();
  }
}
