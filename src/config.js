// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Ported from LoFi Logic core/config.py (https://github.com/lofilogic/flashback-raw-editor).
// Modified 2026-11-09 by Lucas Van De Weerd: rewritten in JavaScript for the
// browser; desktop-only fields (DNG profile name, legacy LUT path, user LUT
// refs) dropped.

// ---- raw pipeline constants ------------------------------------------------
export const SENSOR_BLACK = 64;
export const SENSOR_WHITE = 1023;          // 10-bit, the DNG has no WhiteLevel tag
export const SENSOR_WIDTH = 4144;
export const SENSOR_HEIGHT = 3088;

// WB slider zero: D55, the ForwardMatrix1 calibration illuminant.
export const BASE_KELVIN = 5500;

// Profile tone curve (in, out) pairs, used when no LUT is active.
export const PROFILE_TONE_CURVE = [
  0.0, 0.0, 0.02, 0.02, 0.06, 0.10, 0.20, 0.42,
  0.40, 0.70, 0.78, 0.95, 1.0, 1.0,
];

// ---- exposure pipeline tuning ----------------------------------------------
export const BASE_EXPOSURE_OFFSET_V2 = 2.0;
export const POST_AE_EXPOSURE_BOOST_EV = 2.0;
export const REVERSE_AE_STRENGTH = 0.3;
export const PUSH_PULL_RANGE_EV = 2.0;

// ---- effect defaults (user-facing units) -------------------------------------
export const GRAIN_TILE_SCALE = 0.8;
export const GRAIN_HIGHLIGHT_BIAS = 0.3;

const CNR_SIGMA_MAX = 20.0;
const CNR_DESPIKE_T_HI = 40.0;
const CNR_DESPIKE_T_LO = 4.0;
const VIGNETTE_COLOR_MAX = 0.2;

// Long edge of the V2 half-size develop. Pixel-sized effects are tuned here.
export const WORKING_LONG_EDGE = 2072;

// Camera JPEG input (experimental upstream too).
export const JPEG_TONE_CURVE = [[0, 0], [39, 45], [136, 121], [158, 143], [181, 193], [200, 222], [255, 255]];
export const JPEG_EXPOSURE_EV = 0.0;
export const JPEG_CONTRAST = 1.0;
export const JPEG_SATURATION = 0.9;
export const JPEG_SHADOW_SATURATION = 0.5;
export const JPEG_SHADOW_SAT_END_EV = 1.0;
export const JPEG_SPATIAL_MULT = 1;
export const JPEG_VIGNETTE_MULT = 3.0;

// ---- unit conversions ------------------------------------------------------
export const pct = (v) => v / 100;

export function caPixelsToScale(pixels, longEdge) {
  return longEdge <= 0 ? 0 : pixels / (longEdge / 2);
}

export const vignetteCurveToPower = (curve) => 2 ** (-curve / 50);
export const cnrPctToSigma = (amountPct) => pct(amountPct) * CNR_SIGMA_MAX;
export const cnrSigmaColor = (sigma) => Math.max(15, sigma * 3);
export const vignetteColorPctToShift = (colorPct) => pct(colorPct) * VIGNETTE_COLOR_MAX;

export function cnrDespikeThresholds(amountPct, biasPct) {
  const amt = pct(amountPct);
  if (amt <= 0) return [0, 0];
  const thrGreen = CNR_DESPIKE_T_HI - amt * (CNR_DESPIKE_T_HI - CNR_DESPIKE_T_LO);
  const bias = Math.min(0.999, Math.max(0, pct(biasPct)));
  return [thrGreen, thrGreen / (1 - bias)];
}

// Stops above 18% grey -> ACEScct value (ignores the toe).
export function stopsAboveMidGreyToAcescct(stops) {
  const linear = 0.18 * 2 ** stops;
  return (Math.log2(Math.max(linear, 1e-10)) + 9.72) / 17.52;
}

// Halation scales: [radiusMult, threshOffset, weight, greenFrac, blueFrac, kind]
export const HALATION_SCALES = [
  [1.0, 0.0, 1.00, 0.45, 0.12, 'disc'],
  [2.5, 0.10, 0.18, 0.28, 0.05, 'exp'],
  [5.0, 0.20, 0.07, 0.16, 0.02, 'exp'],
];

export function halationScaleTint(greenFrac, blueFrac, weight, warmthPct) {
  const e = Math.max(warmthPct, 0) / 100;
  return [weight, weight * greenFrac ** e, weight * blueFrac ** e];
}

// ---- vibe config ------------------------------------------------------------
export function defaultVibe() {
  return {
    enable_halation: true,
    enable_chromatic_aberration: true,
    enable_softness: true,
    enable_edge_softness: false,
    enable_grain: true,
    enable_sharpen: true,
    enable_cnr: true,
    enable_lut: true,
    enable_vignette: true,
    enable_bloom: true,

    halation_threshold_stops: 4.5,
    halation_blur_radius: 8.0,
    halation_strength_pct: 75.0,
    halation_warmth_pct: 120.0,
    ca_pixels: 5.0,
    softness_sigma: 0.5,
    edge_softness_strength_pct: 60.0,
    edge_softness_sigma: 3.0,
    edge_softness_start_pct: 40.0,
    grain_strength_pct: 50.0,
    sharpen_strength_pct: 50.0,
    sharpen_radius: 1.0,
    cnr_amount_pct: 20.0,
    cnr_despike_pct: 60.0,
    cnr_despike_bias_pct: 75.0,
    vignette_strength_pct: 50.0,
    vignette_color_pct: 25.0,
    vignette_curve: 0.0,
    bloom_strength_pct: 30.0,
    bloom_threshold_stops: 3.0,

    enable_reverse_autoexposure: false,
    reverse_autoexposure_t_ref: 1e-3,
    enable_post_ae_exposure_boost: false,
    post_ae_exposure_boost_ev: POST_AE_EXPOSURE_BOOST_EV,
    reverse_ae_strength: REVERSE_AE_STRENGTH,

    base_exposure_offset_v2: BASE_EXPOSURE_OFFSET_V2,
    lut: '',
  };
}

export function defaultAdjustments() {
  return { exposure_ev: 0, wb_temp: 0, tint: 0, push_pull_ev: 0, rotation: 0 };
}

// LUT ids map to public/luts/<id>.bin.
export const LUT_IDS = ['disposable', 'disposable_v1', 'flashback_classic_v1', 'point_shoot', 'rangefinder', 'monochrome'];

// V1 negatives are flatter than V2 DNGs, so some looks have a V1 variant.
const V1_LUT_OVERRIDES = { disposable: 'disposable_v1' };
export const effectiveLut = (lut, isV1) => (isV1 && V1_LUT_OVERRIDES[lut]) || lut;

// Presets in user-facing units; ca_pixels is at the 2072 px working size.
export const VIBE_PRESETS = {
  disposable:           { enable_ca: true,  ca_pixels: 8.0, softness: 0.5, sharpness_pct: 200.0, sharpen_radius: 0.5, grain_pct: 120.0, vignette_pct: 10.0, vignette_curve: 66.0, bloom_pct: 15.0, lut: 'disposable' },
  point_shoot:          { enable_ca: true,  ca_pixels: 2.0, softness: 0.3, sharpness_pct:  50.0, sharpen_radius: 1.0, grain_pct:  80.0, vignette_pct: 10.0, vignette_curve:  0.0, bloom_pct: 10.0, lut: 'point_shoot' },
  rangefinder:          { enable_ca: false, ca_pixels: 0.0, softness: 0.1, sharpness_pct:  80.0, sharpen_radius: 1.0, grain_pct:  50.0, vignette_pct:  5.0, vignette_curve:  0.0, bloom_pct:  5.0, lut: 'rangefinder' },
  monochrome:           { enable_ca: false, ca_pixels: 0.0, softness: 0.1, sharpness_pct:  80.0, sharpen_radius: 1.0, grain_pct: 150.0, vignette_pct: 20.0, vignette_curve:  0.0, bloom_pct:  5.0, lut: 'monochrome' },
  flashback_classic_v1: { enable_ca: true,  ca_pixels: 5.0, softness: 0.3, sharpness_pct:  80.0, sharpen_radius: 0.5, grain_pct: 200.0, vignette_pct: 10.0, vignette_curve: 66.0, bloom_pct:  3.0, lut: 'flashback_classic_v1', base_exposure_offset_v2: 0.0 },
};

// Order and names shown in the app; keys 1-5 follow this order (upstream's).
export const VIBES = [
  { id: 'disposable', name: 'Disposable', blurb: 'Warm, soft, punchy' },
  { id: 'point_shoot', name: 'Point & Shoot', blurb: 'Clean and bright' },
  { id: 'rangefinder', name: 'Rangefinder', blurb: 'Natural and crisp' },
  { id: 'monochrome', name: 'Monochrome', blurb: 'Black and white' },
  { id: 'flashback_classic_v1', name: 'Flashback Classic', blurb: 'The V1 look' },
];

export const VIBE_EXPORT_SUFFIX = {
  disposable: 'disp', point_shoot: 'ps', rangefinder: 'rf', monochrome: 'mono', flashback_classic_v1: 'v1',
};

export function vibeConfigFor(id) {
  const cfg = defaultVibe();
  const p = VIBE_PRESETS[id];
  cfg.enable_chromatic_aberration = p.enable_ca;
  cfg.ca_pixels = p.ca_pixels;
  cfg.softness_sigma = p.softness;
  cfg.sharpen_strength_pct = p.sharpness_pct;
  cfg.sharpen_radius = p.sharpen_radius;
  cfg.grain_strength_pct = p.grain_pct;
  cfg.vignette_strength_pct = p.vignette_pct;
  cfg.vignette_curve = p.vignette_curve ?? 0;
  cfg.bloom_strength_pct = p.bloom_pct;
  cfg.lut = p.lut;
  cfg.base_exposure_offset_v2 = p.base_exposure_offset_v2 ?? BASE_EXPOSURE_OFFSET_V2;
  return cfg;
}

// Grain highlight bias moves with push/pull (upstream _grain_highlight_bias).
export function grainHighlightBias(filmEvDriver) {
  if (!filmEvDriver) return GRAIN_HIGHLIGHT_BIAS;
  const frac = Math.min(Math.abs(filmEvDriver) / PUSH_PULL_RANGE_EV, 1);
  const target = filmEvDriver < 0 ? 1 : 0;
  return GRAIN_HIGHLIGHT_BIAS + (target - GRAIN_HIGHLIGHT_BIAS) * frac;
}
