// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Decode worker: turns a photo into the linear ACEScg develop off the main
// thread, and encodes JPEGs for export. Written 2026-11-09 for Flashnack.

import { developV2 } from './dng-v2.js';
import { developV1, extractNegatives } from './v1.js';
import { developSrgb, decodeImage } from './generic.js';
import { areaResize, fitLongEdge } from './resize.js';
import { readMeta } from './tiff.js';
import { encode as encodeJpeg, decode as decodeJpeg } from '@jsquash/jpeg';

export const SMALL_LONG_EDGE = 360;

function small(dev) {
  const [w, h] = fitLongEdge(dev.width, dev.height, SMALL_LONG_EDGE);
  return { data: areaResize(dev.data, dev.width, dev.height, 4, w, h), width: w, height: h };
}

async function develop(msg) {
  const { kind } = msg;
  if (kind === 'v2') return developV2(msg.buffer);
  if (kind === 'v1') return developV1(msg.negative, msg.seed || 0);
  if (kind === 'image') {
    const b = new Uint8Array(msg.buffer, 0, 3);
    const isJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    // JPEGs decode in wasm, which also avoids canvas readback noise in Brave.
    const img = isJpeg
      ? await decodeJpeg(msg.buffer, { preserveOrientation: true }).then((d) => ({ rgba: d.data, width: d.width, height: d.height }))
      : await decodeImage(new Blob([msg.buffer]));
    return developSrgb(img.rgba, img.width, img.height);
  }
  throw new Error(`Unknown kind ${kind}`);
}

self.onmessage = async ({ data: msg }) => {
  const { id, op } = msg;
  try {
    if (op === 'develop') {
      const dev = await develop(msg);
      const s = msg.wantSmall ? small(dev) : null;
      const out = { id, ok: true, width: dev.width, height: dev.height, data: msg.wantFull === false ? null : dev.data, small: s, exposureTime: dev.exposureTime ?? null };
      const transfer = [s?.data.buffer, out.data?.buffer].filter(Boolean);
      self.postMessage(out, transfer);
    } else if (op === 'unzip') {
      const negs = extractNegatives(new Uint8Array(msg.buffer));
      self.postMessage({ id, ok: true, negatives: negs.map((n) => ({ name: n.name, width: n.width, height: n.height, mosaic: n.mosaic })) }, negs.map((n) => n.mosaic.buffer).filter((b, i, a) => a.indexOf(b) === i && b.byteLength));
    } else if (op === 'meta') {
      self.postMessage({ id, ok: true, meta: readMeta(msg.buffer) });
    } else if (op === 'jpeg') {
      const img = new ImageData(new Uint8ClampedArray(msg.rgba.buffer, msg.rgba.byteOffset, msg.rgba.byteLength), msg.width, msg.height);
      const buf = await encodeJpeg(img, { quality: msg.quality ?? 95 });
      self.postMessage({ id, ok: true, bytes: new Uint8Array(buf) }, [buf]);
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message || e) });
  }
};
