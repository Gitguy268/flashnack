// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Flashback ONE35 V2 DNG develop. Highlight recovery and the colour matrix are
// ported from LoFi Logic core/processor.py (_recover_highlights, load_image)
// (https://github.com/lofilogic/flashback-raw-editor). Modified 2026-11-09 by
// Lucas Van De Weerd: JavaScript port. Upstream reads the raw through
// rawpy/LibRaw; the 10-bit unpack and the 2x2 half-size binning here are new
// code written to match rawpy.postprocess(half_size=True, user_black=64,
// user_wb=[1,1,1,1], output_color=raw, gamma=(1,1), output_bps=16).

import { parseTiff, findRawIfd, findTag, TAG } from './tiff.js';
import { SENSOR_BLACK, SENSOR_WHITE } from '../config.js';
import { ASN_D50, FM1_WB_TO_ACESCG } from '../color.js';

/** Unpack an uncompressed CFA strip (MSB-first bit packing) into Uint16. */
export function unpackBits(bytes, width, height, bits, le) {
  const out = new Uint16Array(width * height);
  if (bits === 16) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < out.length; i++) out[i] = dv.getUint16(i * 2, le);
    return out;
  }
  if (bits === 8) { out.set(bytes.subarray(0, out.length)); return out; }
  // Rows start on a byte boundary (TIFF), samples are packed MSB-first.
  const rowBytes = Math.ceil((width * bits) / 8);
  if (bits === 10 && (width * 10) % 8 === 0) {
    // Fast path: 4 samples in 5 bytes.
    let o = 0;
    for (let y = 0; y < height; y++) {
      let p = y * rowBytes;
      for (let x = 0; x < width; x += 4) {
        const b0 = bytes[p], b1 = bytes[p + 1], b2 = bytes[p + 2], b3 = bytes[p + 3], b4 = bytes[p + 4];
        out[o++] = (b0 << 2) | (b1 >> 6);
        out[o++] = ((b1 & 0x3f) << 4) | (b2 >> 4);
        out[o++] = ((b2 & 0x0f) << 6) | (b3 >> 2);
        out[o++] = ((b3 & 0x03) << 8) | b4;
        p += 5;
      }
    }
    return out;
  }
  const mask = (1 << bits) - 1;
  let o = 0;
  for (let y = 0; y < height; y++) {
    let bitPos = y * rowBytes * 8;
    for (let x = 0; x < width; x++) {
      let acc = 0, need = bits;
      while (need > 0) {
        const byte = bytes[bitPos >> 3], avail = 8 - (bitPos & 7), take = Math.min(avail, need);
        acc = (acc << take) | ((byte >> (avail - take)) & ((1 << take) - 1));
        need -= take; bitPos += take;
      }
      out[o++] = acc & mask;
    }
  }
  return out;
}

/** Read the raw mosaic of a Flashback V2 DNG. */
export function readV2Raw(buffer) {
  const tiff = parseTiff(buffer);
  const ifd = findRawIfd(tiff);
  if (!ifd) throw new Error('No raw image in this DNG');
  const t = (k) => ifd.tags.get(k);
  const width = t(TAG.ImageWidth)[0], height = t(TAG.ImageLength)[0], bits = t(TAG.BitsPerSample)[0];
  if ((t(TAG.Compression)?.[0] ?? 1) !== 1) throw new Error('Compressed DNG: not a Flashback V2 file');
  const offsets = t(TAG.StripOffsets), counts = t(TAG.StripByteCounts);
  const total = counts ? counts.reduce((a, b) => a + b, 0) : Math.ceil((width * bits) / 8) * height;
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (let i = 0; i < offsets.length; i++) {
    const n = counts ? counts[i] : total - pos;
    bytes.set(new Uint8Array(buffer, offsets[i], Math.min(n, buffer.byteLength - offsets[i])), pos);
    pos += n;
  }
  const raw = unpackBits(bytes, width, height, bits, tiff.le);
  const cfa = t(TAG.CFAPattern) || [0, 1, 1, 2];
  return {
    raw, width, height, bits, cfa,
    exposureTime: findTag(tiff, TAG.ExposureTime)?.[0] ?? null,
    make: String(findTag(tiff, TAG.Make) ?? ''),
  };
}

/**
 * 2x2 binning like LibRaw half_size: (raw - black) * 65535 / (white - black),
 * truncated and clipped to 16 bits, the two greens averaged with >> 1.
 * Returns Float32Array RGB in 0..1 (value / 65535) plus its size.
 */
export function halfSize({ raw, width, height, cfa }, black = SENSOR_BLACK, white = SENSOR_WHITE) {
  const w = width >> 1, h = height >> 1;
  const out = new Float32Array(w * h * 3);
  // LibRaw multiplies in float32.
  const scale = Math.fround(65535 / (white - black));
  // Position of each colour inside the 2x2 tile.
  const pos = { 0: [], 1: [], 2: [] };
  for (let i = 0; i < 4; i++) pos[cfa[i]].push([i >> 1, i & 1]);
  if (pos[0].length !== 1 || pos[1].length !== 2 || pos[2].length !== 1) throw new Error('Unsupported CFA pattern');
  const [rY, rX] = pos[0][0], [g1Y, g1X] = pos[1][0], [g2Y, g2X] = pos[1][1], [bY, bX] = pos[2][0];
  const sc = (v) => {
    if (!v) return 0;
    const s = Math.trunc(Math.fround((v - black) * scale));
    return s < 0 ? 0 : s > 65535 ? 65535 : s;
  };
  let o = 0;
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * width;
    for (let x = 0; x < w; x++) {
      const c0 = 2 * x;
      const R = sc(raw[r0 + rY * width + c0 + rX]);
      const G = (sc(raw[r0 + g1Y * width + c0 + g1X]) + sc(raw[r0 + g2Y * width + c0 + g2X])) >> 1;
      const B = sc(raw[r0 + bY * width + c0 + bX]);
      out[o++] = R / 65535; out[o++] = G / 65535; out[o++] = B / 65535;
    }
  }
  return { rgb: out, width: w, height: h };
}

/** Max filter with a (2r+1)^2 square window, separable, clamp at borders. */
function dilate(mask, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    // Running count of set pixels in the window.
    let cnt = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) cnt += mask[row + x];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = cnt > 0 ? 1 : 0;
      const add = x + r + 1, rem = x - r;
      if (add < w) cnt += mask[row + add];
      if (rem >= 0) cnt -= mask[row + rem];
    }
  }
  for (let x = 0; x < w; x++) {
    let cnt = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) cnt += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = cnt > 0 ? 1 : 0;
      const add = y + r + 1, rem = y - r;
      if (add < h) cnt += tmp[add * w + x];
      if (rem >= 0) cnt -= tmp[rem * w + x];
    }
  }
  return out;
}

/**
 * Highlight recovery in raw space, before WB (darktable "inpaint opposed").
 * rgb: Float32Array RGB (modified copy returned) = rgb / asn with clipped
 * channels rebuilt from the other two.
 */
export function recoverHighlights(rgb, w, h, asn, threshold = 0.95) {
  const n = w * h;
  const inv = asn.map((a) => Math.fround(1 / a));
  const wb = new Float32Array(n * 3);
  let anyClip = false;
  const clipAny = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      wb[i * 3 + c] = rgb[i * 3 + c] * inv[c];
      if (rgb[i * 3 + c] >= threshold) { clipAny[i] = 1; anyClip = true; }
    }
  }
  if (!anyClip) return wb;

  // refavg: cube of the mean cube root of the other two channels.
  const refavg = (i, c) => {
    const a = Math.cbrt(Math.max(0, wb[i * 3 + (c + 1) % 3]));
    const b = Math.cbrt(Math.max(0, wb[i * 3 + (c + 2) % 3]));
    return ((a + b) * 0.5) ** 3;
  };
  const near = dilate(clipAny, w, h, 7);
  const chroma = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      if (near[i] && !(rgb[i * 3 + c] >= threshold)) { sum += wb[i * 3 + c] - refavg(i, c); cnt++; }
    }
    if (cnt > 30) chroma[c] = sum / cnt;
  }
  for (let i = 0; i < n; i++) {
    if (!clipAny[i]) continue;
    // All three targets come from the values before any channel is rebuilt.
    const t0 = refavg(i, 0) + chroma[0], t1 = refavg(i, 1) + chroma[1], t2 = refavg(i, 2) + chroma[2];
    const t = [t0, t1, t2];
    for (let c = 0; c < 3; c++) {
      if (rgb[i * 3 + c] >= threshold) wb[i * 3 + c] = Math.max(wb[i * 3 + c], t[c]);
    }
  }
  return wb;
}

/** rgb (Float32 RGB) @ M.T -> Float32 RGBA (alpha 1), ready for an rgba32float texture. */
export function toRgba(rgb, n, M) {
  const out = new Float32Array(n * 4);
  const [a, b, c] = M;
  for (let i = 0, j = 0; i < n * 3; i += 3, j += 4) {
    const r = rgb[i], g = rgb[i + 1], bl = rgb[i + 2];
    out[j] = a[0] * r + a[1] * g + a[2] * bl;
    out[j + 1] = b[0] * r + b[1] * g + b[2] * bl;
    out[j + 2] = c[0] * r + c[1] * g + c[2] * bl;
    out[j + 3] = 1;
  }
  return out;
}

/** Full V2 develop: DNG bytes -> linear ACEScg RGBA at half size. */
export function developV2(buffer) {
  const r = readV2Raw(buffer);
  const half = halfSize(r);
  const wb = recoverHighlights(half.rgb, half.width, half.height, ASN_D50);
  return {
    data: toRgba(wb, half.width * half.height, FM1_WB_TO_ACESCG),
    width: half.width,
    height: half.height,
    exposureTime: r.exposureTime,
  };
}
