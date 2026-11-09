// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// WebGPU render pipeline. Ported from LoFi Logic core/gpu.py (GPUPipeline
// stages, _RenderArena) and core/processor.py (_render, _bake_halation,
// _resident_pre_lut_stages, _resident_post_lut_stages)
// (https://github.com/lofilogic/flashback-raw-editor).
// Modified 2026-11-09 by Lucas Van De Weerd: rewritten for the browser's
// WebGPU API; one command encoder per render; grain layer built on the GPU;
// new gain, rotate, tone-curve, finish and display passes.

import { HALATION_SCALES, halationScaleTint, cnrSigmaColor, PROFILE_TONE_CURVE } from '../config.js';
import { buildToneCurveLut, ACESCG_TO_PROPHOTO_ROWVEC, PROPHOTO_TO_LINSRGB_ROWVEC } from '../color.js';
import { bakeFrame, renderFrame } from '../render.js';
import { gaussKernel, expKernel, pyRound } from './kernels.js';

import encodeSrc from './shaders/encode_tex.wgsl?raw';
import lutSrc from './shaders/lut_tex.wgsl?raw';
import gaussSrc from './shaders/gaussian_blur_tex.wgsl?raw';
import downSrc from './shaders/downsample_tex.wgsl?raw';
import discSrc from './shaders/disc_blur_tex.wgsl?raw';
import upSrc from './shaders/upsample_tex.wgsl?raw';
import halMaskSrc from './shaders/halation_mask.wgsl?raw';
import halHiSrc from './shaders/halation_highlights.wgsl?raw';
import halCombineSrc from './shaders/halation_combine.wgsl?raw';
import unsharpSrc from './shaders/unsharp_tex.wgsl?raw';
import caSrc from './shaders/ca_tex.wgsl?raw';
import grainSrc from './shaders/grain_tex.wgsl?raw';
import edgeSrc from './shaders/edge_softness_tex.wgsl?raw';
import vignetteSrc from './shaders/vignette_tex.wgsl?raw';
import bloomDmSrc from './shaders/bloom_downmask.wgsl?raw';
import bloomUaSrc from './shaders/bloom_upadd.wgsl?raw';
import cnrSrc from './shaders/cnr.wgsl?raw';
import gainSrc from './shaders/gain_tex.wgsl?raw';
import rotateSrc from './shaders/rotate_tex.wgsl?raw';
import grainLayerSrc from './shaders/grain_layer.wgsl?raw';
import toneSrc from './shaders/tonecurve_tex.wgsl?raw';
import finishSrc from './shaders/finish_tex.wgsl?raw';
import displaySrc from './shaders/display.wgsl?raw';

const FMT = 'rgba32float';

const PIPELINES = [
  // [name, source, layout spec, entry points]
  ['encode', encodeSrc, 'TS', ['main']],
  ['lut', lutSrc, 'TRSU', ['main']],
  ['gauss', gaussSrc, 'TRS', ['main_h', 'main_v']],
  ['down', downSrc, 'TS', ['main']],
  ['disc', discSrc, 'TSU', ['main']],
  ['up', upSrc, 'TS', ['main']],
  ['halMask', halMaskSrc, 'TSU', ['main']],
  ['halHi', halHiSrc, 'TTSU', ['main']],
  ['halCombine', halCombineSrc, 'TTTTSU', ['main']],
  ['unsharp', unsharpSrc, 'TTSU', ['main']],
  ['ca', caSrc, 'TSU', ['main']],
  ['grain', grainSrc, 'TTSU', ['main']],
  ['edge', edgeSrc, 'TTSU', ['main']],
  ['vignette', vignetteSrc, 'TSU', ['main']],
  ['bloomDm', bloomDmSrc, 'TSU', ['main']],
  ['bloomUa', bloomUaSrc, 'TTSU', ['main']],
  ['cnrIo', cnrSrc, 'TS', ['main_to_lab', 'main_to_acescg']],
  ['cnrLab', cnrSrc, 'TSU', ['main_bilateral', 'main_despike']],
  ['gain', gainSrc, 'TSU', ['main']],
  ['rotate', rotateSrc, 'TSU', ['main']],
  ['grainLayer', grainLayerSrc, 'ASU', ['main']],
  ['tone', toneSrc, 'TRSU', ['main']],
  ['finish', finishSrc, 'TSU', ['main']],
];

/** A texture plus its size; `pooled` textures go back to the pool after a render. */
class Tex {
  constructor(texture, w, h) { this.texture = texture; this.w = w; this.h = h; this.view = texture.createView(); }
}

export class Renderer {
  /** @returns {Promise<Renderer|null>} null when WebGPU is not usable. */
  static async create() {
    if (!globalThis.navigator?.gpu) return null;
    let adapter;
    try { adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch { return null; }
    if (!adapter) return null;
    const info = adapter.info || {};
    if (info.isFallbackAdapter) return null;
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 256 * 1024 * 1024),
        maxBufferSize: Math.min(adapter.limits.maxBufferSize, 256 * 1024 * 1024),
      },
    });
    const r = new Renderer(device, info);
    await r._build();
    return r;
  }

  constructor(device, info) {
    this.device = device;
    this.adapterInfo = info;
    this.lost = false;
    device.lost.then((e) => { this.lost = true; console.warn('[flashnack] GPU device lost:', e.message); });
    this.pool = new Map();       // "w x h" -> [GPUTexture]
    this.inUse = [];
    this.uniPool = [];
    this.uniInUse = [];
    this.kernels = new Map();
    this.luts = new Map();       // lut id -> GPUBuffer
    this.encoder = null;
  }

  async _build() {
    const d = this.device;
    this.layouts = {};
    this.pipes = {};
    const modules = new Map();
    const kinds = {
      T: { texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      A: { texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
      R: { buffer: { type: 'read-only-storage' } },
      U: { buffer: { type: 'uniform' } },
      S: { storageTexture: { access: 'write-only', format: FMT, viewDimension: '2d' } },
    };
    d.pushErrorScope('validation');
    const pending = [];
    for (const [name, src, spec, entries] of PIPELINES) {
      const layout = d.createBindGroupLayout({
        entries: [...spec].map((ch, i) => ({ binding: i, visibility: GPUShaderStage.COMPUTE, ...kinds[ch] })),
      });
      this.layouts[name] = layout;
      if (!modules.has(src)) modules.set(src, d.createShaderModule({ code: src, label: name }));
      const pl = d.createPipelineLayout({ bindGroupLayouts: [layout] });
      for (const e of entries) {
        pending.push(d.createComputePipelineAsync({ layout: pl, compute: { module: modules.get(src), entryPoint: e }, label: `${name}.${e}` })
          .then((p) => { this.pipes[`${name}.${e}`] = p; }));
      }
    }
    // Display pass.
    this.displayLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    const dm = d.createShaderModule({ code: displaySrc, label: 'display' });
    pending.push(d.createRenderPipelineAsync({
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.displayLayout] }),
      vertex: { module: dm, entryPoint: 'vs' },
      fragment: { module: dm, entryPoint: 'fs', targets: [{ format: this.canvasFormat }] },
      primitive: { topology: 'triangle-list' },
    }).then((p) => { this.displayPipe = p; }));
    const results = await Promise.allSettled(pending);
    const err = await d.popErrorScope();
    const failed = results.find((r) => r.status === 'rejected');
    if (err || failed) {
      const msgs = [];
      for (const m of [...modules.values(), dm]) {
        for (const x of (await m.getCompilationInfo()).messages) if (x.type === 'error') msgs.push(`${m.label}:${x.lineNum}: ${x.message}`);
      }
      throw new Error(`WebGPU pipeline error: ${msgs.join('; ') || err?.message || failed.reason}`);
    }

    const curve = buildToneCurveLut(PROFILE_TONE_CURVE, 4096);
    this.toneCurveBuf = this._bufferWithData(curve, GPUBufferUsage.STORAGE);
    this.toneCurveBuf.bindSize = curve.byteLength;
    const toneU = new Float32Array(24);
    [...ACESCG_TO_PROPHOTO_ROWVEC, ...PROPHOTO_TO_LINSRGB_ROWVEC].forEach((row, i) => toneU.set(row, i * 4));
    this.toneUniform = this._bufferWithData(toneU, GPUBufferUsage.UNIFORM);
  }

  _bufferWithData(typed, usage) {
    const buf = this.device.createBuffer({ size: Math.max(16, Math.ceil(typed.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buf, 0, typed.buffer, typed.byteOffset, typed.byteLength);
    return buf;
  }

  // ---- textures ------------------------------------------------------------

  _allocTex(w, h) {
    return this.device.createTexture({
      size: [w, h], format: FMT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });
  }

  /** Scratch texture for the current render, returned to the pool by end(). */
  tex(w, h) {
    const key = `${w}x${h}`;
    const list = this.pool.get(key);
    const t = list?.length ? list.pop() : new Tex(this._allocTex(w, h), w, h);
    this.inUse.push(t);
    return t;
  }

  /** A texture that outlives renders (develop, baked intermediate). */
  persistentTex(w, h) { return new Tex(this._allocTex(w, h), w, h); }

  upload(data, w, h, target) {
    const t = target || this.persistentTex(w, h);
    this.device.queue.writeTexture({ texture: t.texture }, data.buffer, { offset: data.byteOffset, bytesPerRow: w * 16, rowsPerImage: h }, [w, h]);
    return t;
  }

  _uniform(bytes) {
    const size = Math.ceil(bytes.byteLength / 16) * 16;
    let i = this.uniPool.findIndex((b) => b.size === size);
    const buf = i >= 0 ? this.uniPool.splice(i, 1)[0] : this.device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buf, 0, bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.uniInUse.push(buf);
    return buf;
  }
  _f4(a = 0, b = 0, c = 0, d = 0) { return this._uniform(new Float32Array([a, b, c, d])); }

  _kernel(kind, param) {
    const key = `${kind}:${param}`;
    let buf = this.kernels.get(key);
    if (!buf) {
      const k = kind === 'g' ? gaussKernel(param) : expKernel(param);
      buf = this._bufferWithData(k, GPUBufferUsage.STORAGE);
      buf.bindSize = k.byteLength;
      this.kernels.set(key, buf);
    }
    return buf;
  }

  begin() {
    this.encoder = this.device.createCommandEncoder();
  }

  /** Submit the queued passes; scratch textures go back to the pool. Keep the ones in `keep`. */
  end(keep = []) {
    this.device.queue.submit([this.encoder.finish()]);
    this.encoder = null;
    for (const t of this.inUse) {
      if (keep.includes(t)) continue;
      const key = `${t.w}x${t.h}`;
      if (!this.pool.has(key)) this.pool.set(key, []);
      this.pool.get(key).push(t);
    }
    this.inUse = [];
    this.uniPool.push(...this.uniInUse);
    this.uniInUse = [];
  }

  /** Return a texture kept by end(keep) to the pool. */
  release(t) {
    if (!t) return;
    const key = `${t.w}x${t.h}`;
    if (!this.pool.has(key)) this.pool.set(key, []);
    this.pool.get(key).push(t);
  }

  /** Free pooled textures, e.g. after the image size changes. */
  trim() {
    for (const list of this.pool.values()) for (const t of list) t.texture.destroy();
    this.pool.clear();
  }

  _run(pipe, entries, w, h) {
    const bg = this.device.createBindGroup({
      layout: this.layouts[pipe.split('.')[0]],
      // bindSize: shaders that use arrayLength() must see the exact length, not the padded buffer.
      entries: entries.map((r, i) => ({ binding: i, resource: r instanceof GPUBuffer ? { buffer: r, size: r.bindSize ?? r.size } : r.view })),
    });
    const pass = this.encoder.beginComputePass();
    pass.setPipeline(this.pipes[pipe]);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    pass.end();
  }

  _simple(pipe, src, uni, w = src.w, h = src.h) {
    const dst = this.tex(w, h);
    this._run(pipe, uni ? [src, dst, uni] : [src, dst], w, h);
    return dst;
  }

  // ---- stages (gpu.py) ---------------------------------------------------------

  encode(f) { return this._simple('encode.main', f); }

  lut(f, lutBuf, size) {
    const dst = this.tex(f.w, f.h);
    const u = this._uniform(new Uint32Array([size, 0, 0, 0]));
    this._run('lut.main', [f, lutBuf, dst, u], f.w, f.h);
    return dst;
  }

  _separable(f, kbuf) {
    const mid = this.tex(f.w, f.h), dst = this.tex(f.w, f.h);
    this._run('gauss.main_h', [f, kbuf, mid], f.w, f.h);
    this._run('gauss.main_v', [mid, kbuf, dst], f.w, f.h);
    return dst;
  }
  blur(f, sigma) { return sigma <= 0 ? f : this._separable(f, this._kernel('g', sigma)); }
  blurExp(f, lam) { return lam <= 0 ? f : this._separable(f, this._kernel('e', lam)); }

  disc(f, radius) {
    if (radius <= 0) return f;
    const r = pyRound(radius);
    const b = new ArrayBuffer(16), dv = new DataView(b);
    dv.setFloat32(0, r * r, true); dv.setInt32(4, r, true);
    return this._simple('disc.main', f, this._uniform(new Uint8Array(b)));
  }

  downsample(f, factor) {
    const w = Math.max(4, Math.floor(f.w / factor)), h = Math.max(4, Math.floor(f.h / factor));
    return this._simple('down.main', f, null, w, h);
  }
  downsampleTo(f, w, h) { return this._simple('down.main', f, null, w, h); }
  upsample(f, w, h) { return this._simple('up.main', f, null, w, h); }

  halation(f, threshold, blurRadius, strength, warmthPct, k = 20) {
    const glows = HALATION_SCALES.map(([rm, off, weight, gf, bf, kind]) => {
      const tint = halationScaleTint(gf, bf, weight, warmthPct);
      let mask = this._simple('halMask.main', f, this._f4(Math.min(threshold + off, 0.98), k));
      mask = this.blur(mask, 2.0);
      const hi = this.tex(f.w, f.h);
      this._run('halHi.main', [f, mask, hi, this._f4(...tint, 0)], f.w, f.h);
      let small = this.downsample(hi, 2);
      const size = blurRadius * rm;
      small = kind === 'disc' ? this.disc(small, size * 0.5) : this.blurExp(small, size * 0.5);
      return this.upsample(small, f.w, f.h);
    });
    const dst = this.tex(f.w, f.h);
    this._run('halCombine.main', [f, ...glows, dst, this._f4(strength)], f.w, f.h);
    return dst;
  }

  sharpen(f, strength, radius) {
    const blurred = this.blur(f, radius);
    const dst = this.tex(f.w, f.h);
    this._run('unsharp.main', [f, blurred, dst, this._f4(strength)], f.w, f.h);
    return dst;
  }

  ca(f, scale, samples = 16) { return scale <= 0 ? f : this._simple('ca.main', f, this._f4(scale, samples)); }

  edgeSoftness(f, sigma, strength, start) {
    if (strength <= 0 || sigma <= 0) return f;
    const blurred = this.blur(f, sigma);
    const dst = this.tex(f.w, f.h);
    this._run('edge.main', [f, blurred, dst, this._f4(strength, start)], f.w, f.h);
    return dst;
  }

  vignette(f, strength, colorShift, feather) {
    return strength <= 0 ? f : this._simple('vignette.main', f, this._f4(strength, colorShift, feather));
  }

  bloom(f, strength, threshold) {
    if (strength <= 0) return f;
    const bw = Math.max(4, Math.floor(f.w / 4)), bh = Math.max(4, Math.floor(f.h / 4));
    const small = this._simple('bloomDm.main', f, this._f4(threshold), bw, bh);
    const sigma = Math.max(2, Math.floor(Math.max(bw, bh) / 5));
    const blurred = this.blur(small, sigma);
    const dst = this.tex(f.w, f.h);
    this._run('bloomUa.main', [f, blurred, dst, this._f4(strength)], f.w, f.h);
    return dst;
  }

  cnr(f, sigma, [thrGreen, thrOther]) {
    if (sigma <= 0 && thrGreen <= 0) return f;
    let lab = this._simple('cnrIo.main_to_lab', f);
    if (thrGreen > 0) lab = this._simple('cnrLab.main_despike', lab, this._uniform(new Float32Array([0, 0, 0, thrGreen, thrOther, 0, 0, 0])));
    if (sigma > 0) {
      let d = Math.max(5, Math.trunc(sigma) * 2 + 3);
      if (d % 2 === 0) d += 1;
      lab = this._simple('cnrLab.main_bilateral', lab, this._uniform(new Float32Array([sigma, cnrSigmaColor(sigma), Math.floor(d / 2), 0, 0, 0, 0, 0])));
    }
    return this._simple('cnrIo.main_to_acescg', lab);
  }

  grainLayer(w, h, seed, spatialScale) {
    const dst = this.tex(w, h);
    const cw = Math.max(1, Math.round(this.grainTileW * spatialScale)), ch = Math.max(1, Math.round(this.grainTileH * spatialScale));
    // Nearest resample of the tiles when the cell size differs from the tile size.
    this._run('grainLayer.main', [this.grainTiles, dst, this._uniform(new Uint32Array([seed >>> 0, this.grainCount, cw, ch, this.grainTileW, this.grainTileH, 0, 0]))], w, h);
    return dst;
  }

  grain(f, layer, intensity, minGrain, bias) {
    const dst = this.tex(f.w, f.h);
    this._run('grain.main', [f, layer, dst, this._f4(intensity, minGrain, bias)], f.w, f.h);
    return dst;
  }

  // ---- assets --------------------------------------------------------------

  /** Grain tiles as float RGB, all the same size: [{data: Float32Array rgba, w, h}]. */
  setGrainTiles(tiles) {
    const { w, h } = tiles[0];
    const tex = this.device.createTexture({ size: [w, h, tiles.length], format: FMT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    tiles.forEach((t, i) => this.device.queue.writeTexture({ texture: tex, origin: [0, 0, i] }, t.data, { bytesPerRow: w * 16, rowsPerImage: h }, [w, h, 1]));
    this.grainTiles = { texture: tex, view: tex.createView({ dimension: '2d-array' }) };
    this.grainTileW = w; this.grainTileH = h; this.grainCount = tiles.length;
  }

  setLut(id, table, size) {
    if (this.luts.has(id)) return;
    const f = new Float32Array(table.length);
    for (let i = 0; i < table.length; i++) f[i] = table[i] / 65535;
    const buf = this._bufferWithData(f, GPUBufferUsage.STORAGE);
    buf.lutSize = size;
    this.luts.set(id, buf);
  }

  // ---- image setup (processor.load_image / _bake_halation) ------------------------

  /**
   * Upload a develop (linear ACEScg RGBA) and return an image handle with the
   * rotated, halation-baked intermediate. Call bake() again when halation
   * settings or rotation change.
   */
  setImage(img, data, w, h) {
    if (img.develop && (img.develop.w !== w || img.develop.h !== h)) { img.develop.texture.destroy(); img.develop = null; }
    img.develop = this.upload(data, w, h, img.develop);
    img.bakedKey = null;
  }

  dropImage(img) {
    img.develop?.texture.destroy(); img.baked?.texture.destroy();
    img.develop = img.baked = null; img.bakedKey = null;
  }

  // ---- backend API used by render.js ------------------------------------------

  gainStage(f, g) { return this._simple('gain.main', f, this._f4(g[0], g[1], g[2], 0)); }
  rotate(f, q) {
    const [w, h] = q % 2 ? [f.h, f.w] : [f.w, f.h];
    return this._simple('rotate.main', f, this._uniform(new Uint32Array([q, 0, 0, 0])), w, h);
  }
  hasLut(id) { return !!id && this.luts.has(id); }
  lutStage(f, id) { const buf = this.luts.get(id); return this.lut(f, buf, buf.lutSize); }
  tone(f) {
    const dst = this.tex(f.w, f.h);
    this._run('tone.main', [f, this.toneCurveBuf, dst, this.toneUniform], f.w, f.h);
    return dst;
  }
  get hasGrain() { return !!this.grainTiles; }
  finish(f, postGain, apply) { return this._simple('finish.main', f, this._f4(postGain, apply ? 1 : 0)); }
  /** Copy a scratch frame into a texture that survives the render. */
  keepAs(f, prev) {
    const out = prev && prev.w === f.w && prev.h === f.h ? prev : (prev?.texture.destroy(), this.persistentTex(f.w, f.h));
    this.encoder.copyTextureToTexture({ texture: f.texture }, { texture: out.texture }, [f.w, f.h]);
    return out;
  }
  bake(img, vibe, rotation) { return bakeFrame(this, img, vibe, rotation); }
  render(img, vibe, adj, opts) { return renderFrame(this, img, vibe, adj, opts); }

  // ---- output ----------------------------------------------------------------

  /** Read a display texture back as 8-bit RGBA (Uint8Array). */
  async readback(t) {
    const bpr = Math.ceil((t.w * 16) / 256) * 256;
    const buf = this.device.createBuffer({ size: bpr * t.h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: t.texture }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: t.h }, [t.w, t.h]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Float32Array(buf.getMappedRange());
    // Uint8Array truncates like numpy's astype(uint8); the values are already 0..1.
    const out = new Uint8Array(t.w * t.h * 4);
    const stride = bpr / 4;
    for (let y = 0; y < t.h; y++) {
      let s = y * stride, o = y * t.w * 4;
      for (let x = 0; x < t.w; x++, s += 4, o += 4) {
        out[o] = src[s] * 255; out[o + 1] = src[s + 1] * 255; out[o + 2] = src[s + 2] * 255; out[o + 3] = 255;
      }
    }
    buf.unmap();
    buf.destroy();
    return out;
  }

  /** Float readback for tests. */
  async readbackFloat(t) {
    const bpr = Math.ceil((t.w * 16) / 256) * 256;
    const buf = this.device.createBuffer({ size: bpr * t.h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: t.texture }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: t.h }, [t.w, t.h]);
    this.device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Float32Array(buf.getMappedRange());
    const out = new Float32Array(t.w * t.h * 3);
    const stride = bpr / 4;
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) for (let c = 0; c < 3; c++) out[(y * t.w + x) * 3 + c] = src[y * stride + x * 4 + c];
    buf.unmap(); buf.destroy();
    return out;
  }

  /** Configure a canvas for display. */
  attachCanvas(canvas) {
    const ctx = canvas.getContext('webgpu');
    ctx.configure({ device: this.device, format: this.canvasFormat, alphaMode: 'opaque' });
    return ctx;
  }

  /** Draw `t` to the canvas context. view: { scale, offsetX, offsetY } maps canvas px -> image px. */
  present(ctx, t, view, bg = 0.1) {
    const canvas = ctx.canvas;
    const u = this._uniformOnce(new Float32Array([view.scale, view.scale, view.offsetX, view.offsetY, canvas.width, canvas.height, bg, 0]));
    const bgp = this.device.createBindGroup({ layout: this.displayLayout, entries: [{ binding: 0, resource: t.view }, { binding: 1, resource: { buffer: u } }] });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [bg, bg, bg, 1] }] });
    pass.setPipeline(this.displayPipe);
    pass.setBindGroup(0, bgp);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  _uniformOnce(arr) {
    if (!this._displayU) this._displayU = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this._displayU, 0, arr);
    return this._displayU;
  }
}

