import { describe, it, expect } from 'vitest';
import { makeDng } from '../fixtures/make-dng.mjs';
import { parseTiff, readMeta } from '../../src/decode/tiff.js';
import { readV2Raw, unpackBits, halfSize, developV2 } from '../../src/decode/dng-v2.js';
import { extractNegatives } from '../../src/decode/v1.js';
import { zipSync } from 'fflate';

const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

describe('DNG reading', () => {
  it('reads tags and recognises a Flashback file', () => {
    const { bytes } = makeDng();
    const meta = readMeta(ab(bytes));
    expect(meta.isFlashback).toBe(true);
    expect(meta.model).toBe('Flashback ONE35 V2');
    expect(meta.exposureTime).toBeCloseTo(1 / 60);
    expect(parseTiff(ab(bytes)).ifds.length).toBe(1);
  });

  it('unpacks 10-bit MSB-first samples exactly', () => {
    const { bytes, raw } = makeDng();
    const r = readV2Raw(ab(bytes));
    expect(r.width).toBe(416);
    expect(Array.from(r.raw)).toEqual(Array.from(raw));
  });

  it('matches the generic bit reader on odd widths', () => {
    // 3 samples of 10 bits = 30 bits -> 4 bytes per row.
    const bytes = new Uint8Array([0b11111111, 0b11000000, 0b00001111, 0b11111100, 0, 0, 0, 0]);
    expect(Array.from(unpackBits(bytes, 3, 2, 10, true))).toEqual([1023, 0, 1023, 0, 0, 0]);
  });

  it('bins 2x2 like LibRaw half_size', () => {
    const raw = { raw: new Uint16Array([64, 1023, 543, 1023]), width: 2, height: 2, cfa: [0, 1, 1, 2] };
    const h = halfSize(raw);
    expect(h.width).toBe(1);
    expect(h.rgb[0]).toBe(0);                                   // black
    expect(h.rgb[1]).toBeCloseTo(Math.trunc(((65535 + Math.trunc(Math.fround(479 * Math.fround(65535 / 959)))) / 2)) / 65535, 6);
    expect(h.rgb[2]).toBe(1);                                   // white
  });

  it('develops to half-size ACEScg', () => {
    const d = developV2(ab(makeDng().bytes));
    expect(d.width).toBe(208);
    expect(d.height).toBe(156);
    expect(d.data.length).toBe(208 * 156 * 4);
    expect(d.data.every(Number.isFinite)).toBe(true);
  });
});

describe('V1 negatives zip', () => {
  it('pairs raw and json by base name and ignores bad entries', () => {
    const neg = new Uint8Array(4 * 3).fill(100);
    const zip = zipSync({
      'roll/abc': neg,
      'roll/abc.json': new TextEncoder().encode(JSON.stringify({ width: 4, height: 3 })),
      'roll/short.raw': new Uint8Array(5),
      'roll/short.json': new TextEncoder().encode(JSON.stringify({ width: 4, height: 3 })),
      '../../evil.json': new TextEncoder().encode('{}'),
    });
    const out = extractNegatives(zip);
    expect(out.map((n) => n.name)).toEqual(['abc']);
    expect(out[0].mosaic.length).toBe(12);
  });
});
