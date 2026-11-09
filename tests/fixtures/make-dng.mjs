// Writes a small synthetic Flashback-style DNG (10-bit packed RGGB, Make
// "Flashback") so tests can run without real photos. Not a real camera file.
import { writeFileSync } from 'node:fs';

export function makeDng({ width = 416, height = 312, seed = 1 } = {}) {
  // Bayer mosaic of a smooth colour gradient with a bright spot (exercises highlight recovery).
  const raw = new Uint16Array(width * height);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = (y & 1) * 2 + (x & 1); // 0 R, 1 G, 2 G, 3 B
    const u = x / width, v = y / height;
    const base = [0.15 + 0.5 * u, 0.25 + 0.4 * v, 0.25, 0.1 + 0.4 * (1 - u)][c];
    const spot = Math.exp(-((x - width * 0.7) ** 2 + (y - height * 0.3) ** 2) / (2 * (width * 0.04) ** 2)) * 1.4;
    raw[y * width + x] = Math.min(1023, Math.round(64 + (base * 0.5 + spot) * 959 + rnd() * 6));
  }
  // Pack 10-bit MSB-first.
  const strip = new Uint8Array((width * height * 10) / 8);
  let bit = 0;
  for (const v of raw) for (let b = 9; b >= 0; b--, bit++) if ((v >> b) & 1) strip[bit >> 3] |= 0x80 >> (bit & 7);

  const make = new TextEncoder().encode('Flashback\0');
  const model = new TextEncoder().encode('Flashback ONE35 V2\0');
  // [tag, type, values]; type 1 BYTE, 2 ASCII, 3 SHORT, 4 LONG
  const tags = [
    [254, 4, [0]], [256, 4, [width]], [257, 4, [height]], [258, 3, [10]], [259, 3, [1]], [262, 3, [32803]],
    [271, 2, make], [272, 2, model], [273, 4, [0]], [274, 3, [1]], [277, 3, [1]], [278, 4, [height]], [279, 4, [strip.length]],
    [33421, 3, [2, 2]], [33422, 1, [0, 1, 1, 2]], [33434, 5, [1, 60]], [50706, 1, [1, 7, 0, 0]],
  ];
  const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
  const ifdSize = 2 + tags.length * 12 + 4;
  let extra = 8 + ifdSize;
  const extras = [];
  for (const t of tags) {
    const n = t[1] === 5 ? t[2].length / 2 : t[2].length;
    const bytes = size[t[1]] * n;
    t.count = n;
    if (bytes > 4) { t.off = extra; extras.push(t); extra += bytes + (bytes & 1); }
  }
  const stripOff = Math.ceil(extra / 16) * 16;
  tags.find((t) => t[0] === 273)[2] = [stripOff];
  const buf = new ArrayBuffer(stripOff + strip.length), dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8.set([0x49, 0x49]); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
  dv.setUint16(8, tags.length, true);
  const writeVals = (t, at) => {
    t[2].forEach((v, i) => {
      if (t[1] === 1 || t[1] === 2) dv.setUint8(at + i, v);
      else if (t[1] === 3) dv.setUint16(at + i * 2, v, true);
      else dv.setUint32(at + i * 4, v, true);
    });
  };
  tags.forEach((t, i) => {
    const e = 10 + i * 12;
    dv.setUint16(e, t[0], true); dv.setUint16(e + 2, t[1], true); dv.setUint32(e + 4, t.count, true);
    if (t.off) { dv.setUint32(e + 8, t.off, true); writeVals(t, t.off); } else writeVals(t, e + 8);
  });
  u8.set(strip, stripOff);
  return { bytes: u8, raw, width, height };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(process.argv[2] || 'synthetic.dng', makeDng().bytes);
}
