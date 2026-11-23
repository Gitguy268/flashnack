// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Written 2026-11-23 for Flashnack. Flashnack's own era looks, built from
// plain colour maths (no source LUT). No free, redistributable decade packs
// exist, so these fill in 60s to 2010s, Y2K digicam and disposable looks.
// Every function maps display sRGB (0..1) to display sRGB.

const clamp = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// ---- building blocks, each c -> c ----------------------------------------------
/** S-curve around 0.5 that keeps 0 and 1 fixed; 0 < k < 0.5 adds contrast, k < 0 removes it. */
const contrast = (k) => (c) => c.map((v) => { const s = v - 0.5; return clamp(0.5 + s * (1 + k) - 4 * k * s * s * s); });
/** Lift blacks and lower whites (a faded print). */
const fade = (black, white = 1) => (c) => c.map((v) => black + v * (white - black));
const saturate = (s) => (c) => { const y = luma(c); return c.map((v) => clamp(y + (v - y) * s)); };
/** Per-channel gain (white balance). */
const gain = (r, g, b) => (c) => [clamp(c[0] * r), clamp(c[1] * g), clamp(c[2] * b)];
/** Per-channel gamma (>1 darkens that channel's mids). */
const gamma = (r, g, b) => (c) => [c[0] ** r, c[1] ** g, c[2] ** b];
/** Tint shadows and highlights with an RGB offset, weighted by brightness. */
const splitTone = (shadow, highlight, amount = 1) => (c) => {
  const y = luma(c), ws = (1 - smooth(0, 0.55, y)) * amount, wh = smooth(0.45, 1, y) * amount;
  return c.map((v, i) => clamp(v + shadow[i] * ws + highlight[i] * wh));
};
/** Push greens toward cyan/teal (a common film shift). */
const greenToTeal = (k) => (c) => { const g = Math.max(0, c[1] - Math.max(c[0], c[2])); return [c[0], c[1], clamp(c[2] + g * k)]; };
/** Soft highlight shoulder: compress above a knee. */
const shoulder = (knee, strength = 1) => (c) => c.map((v) => (v <= knee ? v : knee + (1 - knee) * (1 - Math.exp(-(v - knee) / (1 - knee) * (1 + strength))) / (1 - Math.exp(-(1 + strength)))));
/** Hard highlight clip, like a small CCD sensor. */
const clip = (at) => (c) => c.map((v) => clamp(v / at));
/** Warm skin / cool everything else (teal and orange). */
const tealOrange = (k) => (c) => {
  const y = luma(c), warm = clamp((c[0] - c[2]) * 2);
  const t = [y - 0.08, y + 0.02, y + 0.10], o = [y + 0.12, y + 0.02, y - 0.10];
  return c.map((v, i) => clamp(mix(v, mix(t[i], o[i], warm), k)));
};
const chain = (...fs) => (r, g, b) => fs.reduce((c, f) => f(c), [r, g, b]);

// ---- the looks --------------------------------------------------------------------
export const ERA_LOOKS = [
  {
    id: 'own-60s-faded-slide', name: '60s Faded Slide', tags: ['60s', 'slide', 'faded', 'warm', 'vintage', 'magenta'],
    fn: chain(gain(1.06, 0.97, 0.9), gamma(0.92, 1.04, 1.12), saturate(0.8), splitTone([0.04, -0.01, 0.03], [0.03, 0.0, -0.06]), fade(0.06, 0.95), contrast(0.12)),
  },
  {
    id: 'own-70s-print', name: '70s Faded Print', tags: ['70s', 'faded', 'warm', 'yellow', 'vintage', 'print'],
    fn: chain(gain(1.05, 1.0, 0.82), gamma(0.95, 1.0, 1.18), saturate(0.72), splitTone([0.03, 0.02, -0.02], [0.04, 0.01, -0.05]), fade(0.09, 0.93), contrast(0.05)),
  },
  {
    id: 'own-80s-mall-flash', name: '80s Mall Flash', tags: ['80s', 'flash', 'warm', 'saturated', 'magenta', 'vivid'],
    fn: chain(gain(1.06, 0.99, 0.95), saturate(1.25), splitTone([0.03, -0.02, 0.04], [0.03, 0.01, -0.03]), contrast(0.28), fade(0.04, 0.97)),
  },
  {
    id: 'own-90s-drugstore', name: '90s Drugstore Print', tags: ['90s', 'warm', 'green shadows', 'print', 'consumer', 'gold'],
    fn: chain(gain(1.05, 1.02, 0.9), splitTone([-0.02, 0.025, 0.0], [0.03, 0.01, -0.04]), saturate(1.1), shoulder(0.78, 1), contrast(0.18), fade(0.035, 0.98)),
  },
  {
    id: 'own-y2k-digicam', name: 'Y2K Digicam', tags: ['y2k', '2000s', 'digicam', 'ccd', 'cool', 'blue', 'crunchy', 'point and shoot'],
    fn: chain(gain(0.95, 1.0, 1.1), saturate(1.3), greenToTeal(0.35), contrast(0.35), clip(0.93), splitTone([-0.01, 0.0, 0.03], [0.0, 0.0, 0.02])),
  },
  {
    id: 'own-2000s-flash-party', name: '2000s Flash Party', tags: ['y2k', '2000s', 'flash', 'party', 'digicam', 'bright', 'cool'],
    fn: chain(gain(1.0, 1.0, 1.06), gamma(0.85, 0.86, 0.84), saturate(1.15), contrast(0.3), clip(0.9), splitTone([0.0, 0.0, 0.04], [0, 0, 0])),
  },
  {
    id: 'own-disposable-400', name: 'Disposable 400', tags: ['disposable', '90s', '2000s', 'y2k', 'green shadows', 'warm', 'grainy', 'flash'],
    fn: chain(gain(1.04, 1.03, 0.93), splitTone([-0.03, 0.035, 0.0], [0.04, 0.015, -0.04]), saturate(1.18), contrast(0.3), fade(0.05, 0.97), shoulder(0.8, 0.5)),
  },
  {
    id: 'own-instant-pastel', name: 'Instant Pastel', tags: ['instant', 'polaroid', 'pastel', 'faded', 'cyan shadows', 'soft'],
    fn: chain(gain(1.02, 1.0, 0.96), splitTone([-0.03, 0.02, 0.05], [0.04, 0.03, -0.02]), saturate(0.82), fade(0.11, 0.95), contrast(-0.08)),
  },
  {
    id: 'own-2010s-matte', name: '2010s Matte', tags: ['2010s', 'matte', 'faded', 'instagram', 'vsco', 'muted', 'teal'],
    fn: chain(saturate(0.78), splitTone([-0.02, 0.01, 0.03], [0.03, 0.01, -0.02]), fade(0.1, 0.96), contrast(0.1)),
  },
  {
    id: 'own-teal-orange', name: 'Teal & Orange', tags: ['cinematic', 'film', 'teal', 'orange', 'blockbuster', '2010s'],
    fn: chain(tealOrange(0.45), contrast(0.18), saturate(1.05)),
  },
  {
    id: 'own-tungsten-night', name: 'Tungsten Night 800', tags: ['cinematic', 'night', 'tungsten', '800t', 'cool', 'neon'],
    fn: chain(gain(0.88, 0.98, 1.14), splitTone([-0.01, 0.01, 0.05], [0.05, 0.0, -0.02]), saturate(1.1), contrast(0.2), fade(0.03, 0.98)),
  },
  {
    id: 'own-newsprint-bw', name: 'Newsprint B&W', tags: ['b&w', 'black and white', 'mono', 'contrast', '50s', 'vintage'],
    fn: chain(saturate(0), contrast(0.45), fade(0.05, 0.94)),
  },
];
