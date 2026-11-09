// Parity page: develops /sample.dng, renders each vibe and compares with the
// upstream LoFi Logic reference renders served under /ref/. Driven by
// tests/parity/run-parity.mjs.
import { Engine } from '../../src/engine.js';
import { vibeConfigFor, defaultAdjustments, defaultVibe } from '../../src/config.js';

const log = (s) => { document.getElementById('log').textContent += `\n${s}`; };

async function fetchF32(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return new Float32Array(await r.arrayBuffer()); }

function stats(a, b) {
  let max = 0, sum = 0, n = Math.min(a.length, b.length), over = 0, ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { const d = Math.abs(a[i] - b[i]); if (d > max) max = d; sum += d; if (d > 2 / 255) over++; ma += a[i]; mb += b[i]; }
  return { max, mean: sum / n, over2: over / n, meanMine: ma / n, meanRef: mb / n };
}

window.runParity = async (name, vibes) => {
  const eng = await Engine.create();
  if (!eng.gpu) return { error: 'no webgpu' };
  const buf = await (await fetch('/sample.dng')).arrayBuffer();
  const t0 = performance.now();
  const dev = await eng.develop({ kind: 'v2', buffer: buf });
  const tDev = performance.now() - t0;
  const img = {};
  eng.gpu.setImage(img, dev.data, dev.width, dev.height);
  const out = { develop_ms: tDev, results: {} };

  // Intermediate with halation (disposable vibe defaults).
  {
    const v = vibeConfigFor('disposable');
    eng.gpu.bake(img, v, 0);
    const f = await eng.gpu.readbackFloat(img.baked);
    const ref = await fetchF32(`/ref/${name}_disposable_inter_f32.bin`);
    out.results.intermediate = stats(f, ref);
  }
  for (const id of vibes) {
    const v = vibeConfigFor(id);
    v.enable_grain = false;
    Object.assign(v, (window.OVERRIDES || {})[id] || {});
    const lut = await eng.ensureLut(v.lut, false);
    eng.gpu.bake(img, v, 0);
    const t1 = performance.now();
    const tex = eng.gpu.render(img, v, defaultAdjustments(), { lutId: lut });
    const f = await eng.gpu.readbackFloat(tex);
    const ms = performance.now() - t1;
    eng.gpu.release(tex);
    const ref = await fetchF32(`/ref/${name}_${id}_render_f32.bin`);
    out.results[id] = { ...stats(f, ref), render_ms: ms };
    if (window.ALIGN) {
      const W = tex.w, H = tex.h, best = [];
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        let s = 0, n = 0;
        for (let y = 100; y < H - 100; y += 3) for (let x = 100; x < W - 100; x += 3) { s += Math.abs(f[(y * W + x) * 3 + 1] - ref[((y + dy) * W + x + dx) * 3 + 1]); n++; }
        best.push([s / n, dx, dy]);
      }
      best.sort((a, b) => a[0] - b[0]);
      out.results[id].align = best.slice(0, 3);
    }
    log(`${id}: ${JSON.stringify(out.results[id])}`);
  }
  return out;
};
log('ready');

// CPU backend against the same references (runs on the main thread here).
window.runCpuParity = async (name, vibes) => {
  const { CpuBackend } = await import('../../src/cpu/backend.js');
  const eng = await Engine.create({ cpu: true });
  const b = new CpuBackend();
  const buf = await (await fetch('/sample.dng')).arrayBuffer();
  const dev = await eng.develop({ kind: 'v2', buffer: buf });
  const img = { develop: { data: dev.data, w: dev.width, h: dev.height } };
  const out = { results: {} };
  for (const id of vibes) {
    const v = vibeConfigFor(id);
    v.enable_grain = false;
    const table = new Uint16Array(await (await fetch(`/luts/${v.lut}.bin`)).arrayBuffer());
    b.setLut(v.lut, table, 65);
    const t0 = performance.now();
    b.bake(img, v, 0);
    const f = b.render(img, v, defaultAdjustments(), { lutId: v.lut });
    const ms = performance.now() - t0;
    const rgb = new Float32Array(f.w * f.h * 3);
    for (let i = 0, j = 0; i < f.data.length; i += 4, j += 3) { rgb[j] = f.data[i]; rgb[j + 1] = f.data[i + 1]; rgb[j + 2] = f.data[i + 2]; }
    const ref = await fetchF32(`/ref/${name}_${id}_render_f32.bin`);
    out.results[id] = { ...stats(rgb, ref), render_ms: ms };
  }
  return out;
};
