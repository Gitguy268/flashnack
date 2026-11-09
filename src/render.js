// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Render order and parameters, shared by the WebGPU and CPU backends. Ported
// from LoFi Logic core/processor.py (_render, _bake_halation,
// _resident_pre_lut_stages, _resident_post_lut_stages)
// (https://github.com/lofilogic/flashback-raw-editor). Modified 2026-11-09 by
// Lucas Van De Weerd: JavaScript port written against a backend interface;
// reverse auto-exposure (an upstream LUT-profiling tool) is left out.

import {
  pct, caPixelsToScale, vignetteCurveToPower, cnrPctToSigma, cnrDespikeThresholds,
  vignetteColorPctToShift, stopsAboveMidGreyToAcescct, grainHighlightBias,
  BASE_KELVIN, WORKING_LONG_EDGE, JPEG_SPATIAL_MULT, JPEG_VIGNETTE_MULT,
} from './config.js';
import { kelvinToAcescgGain, tintToAcescgGain } from './color.js';

const halationKey = (v, rotation) => JSON.stringify([rotation, v.enable_halation, v.halation_strength_pct,
  v.halation_threshold_stops, v.halation_blur_radius, v.halation_warmth_pct]);

/** Rotate the develop and bake halation in, once per image (until those settings change). */
export function bakeFrame(b, img, vibe, rotation = 0) {
  const key = halationKey(vibe, rotation);
  if (img.bakedKey === key && img.baked) return;
  b.begin();
  let f = img.develop;
  const q = (((rotation % 360) + 360) % 360) / 90;
  if (q) f = b.rotate(f, q);
  const spatial = (Math.max(f.w, f.h) / WORKING_LONG_EDGE) * (img.isJpeg ? JPEG_SPATIAL_MULT : 1);
  if (vibe.enable_halation && vibe.halation_strength_pct > 0) {
    f = b.halation(f, stopsAboveMidGreyToAcescct(vibe.halation_threshold_stops),
      vibe.halation_blur_radius * spatial, pct(vibe.halation_strength_pct), vibe.halation_warmth_pct);
  }
  img.baked = b.keepAs(f, img.baked);
  b.end();
  img.bakedKey = key;
}

/**
 * Render the baked intermediate to display sRGB, 0..1.
 * opts: { lutId, seed, preview: {w, h} | null, plain: bool (no look, for compare) }
 * Returns a frame the caller releases with b.release().
 */
export function renderFrame(b, img, vibe, adj, opts = {}) {
  const preview = opts.preview || null;
  const v = vibe;
  b.begin();
  let f = img.baked;
  if (preview) f = b.downsampleTo(f, preview.w, preview.h);

  const pushPull = adj.push_pull_ev || 0;
  const boostEv = v.enable_post_ae_exposure_boost ? v.post_ae_exposure_boost_ev : 0;
  const preLutEv = v.reverse_ae_strength * boostEv + pushPull;
  const wb = kelvinToAcescgGain(BASE_KELVIN + (adj.wb_temp || 0));
  const tint = tintToAcescgGain(adj.tint || 0);
  const ev = 2 ** ((adj.exposure_ev || 0) + v.base_exposure_offset_v2 + preLutEv);
  const gain = [wb[0] * tint[0] * ev, wb[1] * tint[1] * ev, wb[2] * tint[2] * ev];
  if (gain.some((g) => Math.abs(g - 1) > 1e-8)) f = b.gainStage(f, gain);

  const spatial = (Math.max(img.baked.w, img.baked.h) / WORKING_LONG_EDGE) * (img.isJpeg ? JPEG_SPATIAL_MULT : 1);
  const vignetteScale = img.isJpeg ? JPEG_VIGNETTE_MULT : 1;
  const lut = !opts.plain && v.enable_lut && b.hasLut(opts.lutId) ? opts.lutId : null;
  const effects = !preview && !opts.plain;

  if (effects) {
    if (v.enable_vignette && v.vignette_strength_pct > 0) {
      f = b.vignette(f, Math.min(1, pct(v.vignette_strength_pct) * vignetteScale),
        vignetteColorPctToShift(v.vignette_color_pct), vignetteCurveToPower(v.vignette_curve));
    }
    if (v.enable_bloom && v.bloom_strength_pct > 0) f = b.bloom(f, pct(v.bloom_strength_pct), stopsAboveMidGreyToAcescct(v.bloom_threshold_stops));
    if (lut && v.enable_cnr && (v.cnr_amount_pct > 0 || v.cnr_despike_pct > 0)) {
      f = b.cnr(f, v.cnr_amount_pct > 0 ? cnrPctToSigma(v.cnr_amount_pct) : 0, cnrDespikeThresholds(v.cnr_despike_pct, v.cnr_despike_bias_pct));
    }
  }

  f = lut ? b.lutStage(b.encode(f), lut) : b.tone(f);

  if (effects) {
    if (v.enable_chromatic_aberration && v.ca_pixels > 0) f = b.ca(f, caPixelsToScale(v.ca_pixels * spatial, Math.max(f.w, f.h)));
    if (v.enable_edge_softness && v.edge_softness_strength_pct > 0 && v.edge_softness_sigma > 0) {
      f = b.edgeSoftness(f, v.edge_softness_sigma * spatial, pct(v.edge_softness_strength_pct), pct(v.edge_softness_start_pct));
    }
    if (v.enable_softness && v.softness_sigma > 0) f = b.blur(f, v.softness_sigma * spatial);
    if (v.enable_grain && v.grain_strength_pct > 0 && b.hasGrain) {
      const layer = b.grainLayer(f.w, f.h, opts.seed ?? 1, spatial);
      f = b.grain(f, layer, pct(v.grain_strength_pct), 0.2, grainHighlightBias(pushPull));
    }
    if (v.enable_sharpen && v.sharpen_strength_pct > 0) f = b.sharpen(f, pct(v.sharpen_strength_pct), v.sharpen_radius * spatial);
  }

  const postGain = 2 ** -preLutEv;
  const out = b.finish(f, postGain, Math.abs(postGain - 1) > 1e-8);
  b.end([out]);
  return out;
}
