// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Minimal TIFF/DNG reader. The IFD walk follows LoFi Logic's
// _read_dng_baseline_exposure in core/processor.py
// (https://github.com/lofilogic/flashback-raw-editor); modified 2026-11-09 by
// Lucas Van De Weerd: JavaScript, reads every IFD and SubIFD and all tag types.

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8 };

export const TAG = {
  NewSubfileType: 254,
  ImageWidth: 256,
  ImageLength: 257,
  BitsPerSample: 258,
  Compression: 259,
  Photometric: 262,
  Make: 271,
  Model: 272,
  StripOffsets: 273,
  Orientation: 274,
  SamplesPerPixel: 277,
  RowsPerStrip: 278,
  StripByteCounts: 279,
  SubIFDs: 330,
  ExposureTime: 33434,
  ExifIFD: 34665,
  CFARepeatPatternDim: 33421,
  CFAPattern: 33422,
  BlackLevel: 50714,
  WhiteLevel: 50717,
  BaselineExposure: 50730,
  AsShotNeutral: 50728,
  ForwardMatrix1: 50964,
};

/**
 * Parse a TIFF file. Returns { le, ifds: [{ tags: Map<tag, value[]|string>, sub: [...] }] }.
 * Values are arrays of numbers (rationals as floats) or strings for ASCII.
 */
export function parseTiff(buffer) {
  const dv = new DataView(buffer);
  if (dv.byteLength < 8) throw new Error('Not a TIFF/DNG file (too short)');
  const bo = dv.getUint16(0, false);
  if (bo !== 0x4949 && bo !== 0x4d4d) throw new Error('Not a TIFF/DNG file');
  const le = bo === 0x4949;
  if (dv.getUint16(2, le) !== 42) throw new Error('Not a TIFF/DNG file (bad magic)');

  const seen = new Set();
  function readValue(type, count, off) {
    const size = (TYPE_SIZE[type] || 1) * count;
    if (off + size > dv.byteLength) return [];
    if (type === 2) {
      let s = '';
      for (let i = 0; i < count; i++) { const c = dv.getUint8(off + i); if (!c) break; s += String.fromCharCode(c); }
      return s;
    }
    const out = [];
    for (let i = 0; i < count; i++) {
      const o = off + i * (TYPE_SIZE[type] || 1);
      switch (type) {
        case 1: case 7: out.push(dv.getUint8(o)); break;
        case 6: out.push(dv.getInt8(o)); break;
        case 3: out.push(dv.getUint16(o, le)); break;
        case 8: out.push(dv.getInt16(o, le)); break;
        case 4: case 13: out.push(dv.getUint32(o, le)); break;
        case 9: out.push(dv.getInt32(o, le)); break;
        case 5: { const d = dv.getUint32(o + 4, le); out.push(d ? dv.getUint32(o, le) / d : 0); break; }
        case 10: { const d = dv.getInt32(o + 4, le); out.push(d ? dv.getInt32(o, le) / d : 0); break; }
        case 11: out.push(dv.getFloat32(o, le)); break;
        case 12: out.push(dv.getFloat64(o, le)); break;
        case 16: out.push(Number(dv.getBigUint64(o, le))); break;
        default: out.push(dv.getUint8(o));
      }
    }
    return out;
  }

  function readIfd(off, depth) {
    if (!off || off + 2 > dv.byteLength || seen.has(off) || depth > 4) return null;
    seen.add(off);
    const n = dv.getUint16(off, le);
    const tags = new Map();
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > dv.byteLength) break;
      const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), count = dv.getUint32(e + 4, le);
      const size = (TYPE_SIZE[type] || 1) * count;
      const valOff = size > 4 ? dv.getUint32(e + 8, le) : e + 8;
      tags.set(tag, readValue(type, count, valOff));
    }
    const next = off + 2 + n * 12 + 4 <= dv.byteLength ? dv.getUint32(off + 2 + n * 12, le) : 0;
    const sub = [];
    for (const t of [TAG.SubIFDs, TAG.ExifIFD]) {
      const v = tags.get(t);
      if (Array.isArray(v)) for (const o of v) { const s = readIfd(o, depth + 1); if (s) sub.push(s); }
    }
    return { tags, sub, next };
  }

  const ifds = [];
  let off = dv.getUint32(4, le);
  while (off && ifds.length < 16) {
    const ifd = readIfd(off, 0);
    if (!ifd) break;
    ifds.push(ifd);
    off = ifd.next;
  }
  return { le, ifds };
}

/** First value of a tag anywhere in the tree (IFD0 first). */
export function findTag(tiff, tag) {
  const stack = [...tiff.ifds];
  while (stack.length) {
    const ifd = stack.shift();
    if (ifd.tags.has(tag)) return ifd.tags.get(tag);
    stack.push(...ifd.sub);
  }
  return undefined;
}

/** The IFD holding CFA raw data (Photometric 32803), or undefined. */
export function findRawIfd(tiff) {
  const stack = [...tiff.ifds];
  while (stack.length) {
    const ifd = stack.shift();
    if (ifd.tags.get(TAG.Photometric)?.[0] === 32803) return ifd;
    stack.push(...ifd.sub);
  }
  return undefined;
}

/** Quick metadata for the file list: make, model, exposure. */
export function readMeta(buffer) {
  try {
    const t = parseTiff(buffer);
    const make = String(findTag(t, TAG.Make) ?? '').trim();
    return {
      make,
      model: String(findTag(t, TAG.Model) ?? '').trim(),
      isFlashback: make.toLowerCase() === 'flashback',
      exposureTime: findTag(t, TAG.ExposureTime)?.[0] ?? null,
      baselineExposure: findTag(t, TAG.BaselineExposure)?.[0] ?? null,
      orientation: findTag(t, TAG.Orientation)?.[0] ?? 1,
    };
  } catch {
    return null;
  }
}
