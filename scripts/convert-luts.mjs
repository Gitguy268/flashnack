// Converts LoFi Logic's 65³ Resolve .cube LUTs into compact binary tables.
//
// Output (public/luts/<id>.bin): little-endian Uint16, values scaled so that
// 0..65535 maps to 0..1, laid out as table[r][g][b][rgb] (the order
// lut_tex.wgsl indexes). A .cube file lists red fastest, then green, then
// blue, so entry (r, g, b) is line b*N*N + g*N + r.
//
// Usage: node scripts/convert-luts.mjs <folder with the .cube files>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Upstream file name -> Flashnack LUT id (same ids as core/config.py FACTORY_LUTS).
const FILES = {
  'disposable.cube': 'disposable',
  'disposable_V1.cube': 'disposable_v1',
  'V1.cube': 'flashback_classic_v1',
  'pointandshoot.cube': 'point_shoot',
  'rangefinder.cube': 'rangefinder',
  'monochrome.cube': 'monochrome',
};

export function parseCube(text) {
  let size = 0;
  const values = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (/^[A-Z_]/.test(line)) continue; // TITLE, DOMAIN_MIN, ...
    const parts = line.split(/\s+/);
    if (parts.length === 3) values.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size || values.length !== size ** 3 * 3) throw new Error(`bad cube: size ${size}, ${values.length / 3} entries`);
  return { size, values };
}

export function cubeToTable({ size: n, values }) {
  const out = new Uint16Array(n ** 3 * 3);
  let clipped = 0;
  for (let r = 0; r < n; r++) for (let g = 0; g < n; g++) for (let b = 0; b < n; b++) {
    const src = (b * n * n + g * n + r) * 3;
    const dst = ((r * n + g) * n + b) * 3;
    for (let c = 0; c < 3; c++) {
      const v = values[src + c];
      if (v < 0 || v > 1) clipped++;
      out[dst + c] = Math.round(Math.min(1, Math.max(0, v)) * 65535);
    }
  }
  return { table: out, clipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node scripts/convert-luts.mjs <cube folder>'); process.exit(1); }
  mkdirSync('public/luts', { recursive: true });
  for (const [file, id] of Object.entries(FILES)) {
    const cube = parseCube(readFileSync(join(dir, file), 'utf8'));
    const { table, clipped } = cubeToTable(cube);
    writeFileSync(`public/luts/${id}.bin`, Buffer.from(table.buffer));
    console.log(`${id}: ${cube.size}³, ${clipped} values outside 0..1 clamped`);
  }
}
