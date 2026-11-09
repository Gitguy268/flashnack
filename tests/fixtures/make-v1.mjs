// Writes a synthetic Flashback ONE35 V1 negative: a headerless 8-bit RGGB
// mosaic plus <name>.json with its size, as the Flashback app exports them.
// Not a real camera file.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function makeNegative({ width = 640, height = 480, seed = 3 } = {}) {
  const m = new Uint8Array(width * height);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = (y & 1) * 2 + (x & 1);
    const u = x / width, v = y / height;
    // Soft shapes and an edge, so the demosaic has something to do.
    const edge = x > width * 0.55 ? 0.25 : 0;
    const base = [0.2 + 0.5 * u, 0.3 + 0.4 * v, 0.3 + 0.4 * v, 0.15 + 0.5 * (1 - u)][c] * 0.6 + edge;
    const spot = Math.exp(-((x - width * 0.3) ** 2 + (y - height * 0.35) ** 2) / (2 * (width * 0.05) ** 2));
    m[y * width + x] = Math.min(255, Math.round(3 + (base + spot) * 230 + rnd() * 3));
  }
  return { mosaic: m, json: JSON.stringify({ width, height }), width, height };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || '.';
  mkdirSync(dir, { recursive: true });
  const n = makeNegative();
  writeFileSync(join(dir, 'neg1'), n.mosaic);
  writeFileSync(join(dir, 'neg1.json'), n.json);
}
