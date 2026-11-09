// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Glue between the decode worker, the WebGPU renderer, LUTs and grain tiles.
// Written 2026-11-09 for Flashnack; the per-photo flow follows LoFi Logic's
// FlashbackProcessor (develop once, render many times).

import { Renderer } from './gpu/pipeline.js';
import { areaResize, fitLongEdge } from './decode/resize.js';

const SMALL_LONG_EDGE = 360;
import { GRAIN_TILE_SCALE, effectiveLut } from './config.js';

const BASE = import.meta.env.BASE_URL;

/** Promise-based RPC over the decode worker. */
class WorkerRpc {
  constructor(worker) {
    this.worker = worker;
    this.next = 1;
    this.pending = new Map();
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      data.ok ? p.resolve(data) : p.reject(new Error(data.error));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Worker failed'));
      this.pending.clear();
    };
  }
  call(msg, transfer = []) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }
}

async function loadPngPixels(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close();
  return { d, w: c.width, h: c.height };
}

export class Engine {
  /** opts.cpu forces the CPU renderer (also used when WebGPU is missing). */
  static async create(opts = {}) {
    const e = new Engine();
    e.gpu = opts.cpu ? null : await Renderer.create().catch((err) => { console.warn('[flashnack] WebGPU unavailable:', err); return null; });
    // Written out in full so Vite bundles each worker.
    e.rpc = new WorkerRpc(new Worker(new URL('./decode/worker.js', import.meta.url), { type: 'module' }));
    if (!e.gpu) e.cpu = new WorkerRpc(new Worker(new URL('./cpu/worker.js', import.meta.url), { type: 'module' }));
    await e._loadGrain();
    return e;
  }

  get backendName() { return this.gpu ? 'gpu' : 'cpu'; }

  constructor() {
    this.lutTables = new Map();
    this.lutLoading = new Map();
  }

  async _loadGrain() {
    const names = ['grain_01', 'grain_02', 'grain_03', 'grain_04'];
    const tiles = [];
    for (const n of names) {
      const { d, w, h } = await loadPngPixels(`${BASE}grain/${n}.png`);
      const f = new Float32Array(w * h * 4);
      for (let i = 0; i < w * h; i++) { f[i * 4] = d[i * 4] / 255; f[i * 4 + 1] = d[i * 4 + 1] / 255; f[i * 4 + 2] = d[i * 4 + 2] / 255; f[i * 4 + 3] = 1; }
      const tw = Math.max(1, Math.round(w * GRAIN_TILE_SCALE)), th = Math.max(1, Math.round(h * GRAIN_TILE_SCALE));
      tiles.push({ data: areaResize(f, w, h, 4, tw, th), w: tw, h: th });
    }
    if (this.gpu) this.gpu.setGrainTiles(tiles);
    else await this.cpu.call({ op: 'grain', tiles });
  }

  /** Make sure a LUT is on the GPU. Returns the id, or null without one. */
  async ensureLut(lut, isV1) {
    if (!lut) return null;
    const id = effectiveLut(lut, isV1);
    if (!this.lutLoading.has(id)) {
      const job = (async () => {
        const res = await fetch(`${BASE}luts/${id}.bin`);
        if (!res.ok) throw new Error(`Could not load the ${id} look (${res.status})`);
        const table = new Uint16Array(await res.arrayBuffer());
        const size = Math.round(Math.cbrt(table.length / 3));
        if (this.gpu) this.gpu.setLut(id, table, size);
        else await this.cpu.call({ op: 'lut', lutId: id, table, size }, [table.buffer]);
      })();
      job.catch(() => this.lutLoading.delete(id));
      this.lutLoading.set(id, job);
    }
    await this.lutLoading.get(id);
    return id;
  }

  /**
   * Develop a photo source in the worker.
   * src: { kind: 'v2'|'image', buffer } | { kind: 'v1', negative }
   */
  async develop(src, { wantSmall = false, wantFull = true } = {}) {
    const msg = { op: 'develop', kind: src.kind, wantSmall, wantFull };
    if (src.kind === 'v1') {
      // Copy, so the photo keeps its own mosaic.
      msg.negative = { ...src.negative, mosaic: src.negative.mosaic.slice() };
      msg.seed = src.seed || 0;
      return this.rpc.call(msg, [msg.negative.mosaic.buffer]);
    }
    if (src.kind === 'raw') {
      // LibRaw runs in its own worker; the colour step is quick enough here.
      const { developRawWithLibraw } = await import('./decode/generic.js');
      const dev = await developRawWithLibraw(new Uint8Array(src.buffer), src.meta || {});
      let small = null;
      if (wantSmall) {
        const [w, h] = fitLongEdge(dev.width, dev.height, SMALL_LONG_EDGE);
        small = { data: areaResize(dev.data, dev.width, dev.height, 4, w, h), width: w, height: h };
      }
      return { width: dev.width, height: dev.height, data: wantFull ? dev.data : null, small };
    }
    msg.buffer = src.buffer.slice(0);
    return this.rpc.call(msg, [msg.buffer]);
  }

  async unzip(buffer) {
    const copy = buffer.slice(0);
    return (await this.rpc.call({ op: 'unzip', buffer: copy }, [copy])).negatives;
  }

  async meta(buffer) {
    const copy = buffer.slice(0, Math.min(buffer.byteLength, 4 * 1024 * 1024));
    return (await this.rpc.call({ op: 'meta', buffer: copy }, [copy])).meta;
  }

  async encodeJpeg(rgba, width, height, quality = 95) {
    return (await this.rpc.call({ op: 'jpeg', rgba, width, height, quality }, [rgba.buffer])).bytes;
  }

  // ---- backend-neutral rendering -------------------------------------------------

  /** Load a develop into an image handle. Set img.isJpeg before calling. */
  async setImage(img, dev) {
    if (this.gpu) { this.gpu.setImage(img, dev.data, dev.width, dev.height); return; }
    img.key ||= `img${++keyCounter}`;
    img.bakedKey = null;
    await this.cpu.call({ op: 'set', key: img.key, data: dev.data.slice(), w: dev.width, h: dev.height, isJpeg: !!img.isJpeg });
  }

  dropImage(img) {
    if (this.gpu) this.gpu.dropImage(img);
    else if (img.key) this.cpu.call({ op: 'drop', key: img.key });
  }

  /**
   * Bake and render. opts: { isV1, seed, plain, preview: {w,h}, previewScale }.
   * Returns a frame for present()/pixels(); release() it when done.
   */
  async draw(img, vibe, adj, opts = {}) {
    const lutId = await this.ensureLut(vibe.lut, opts.isV1);
    const o = { lutId, seed: opts.seed, plain: opts.plain, preview: opts.preview, previewScale: opts.previewScale };
    if (this.gpu) {
      this.gpu.bake(img, vibe, adj.rotation || 0);
      if (o.previewScale) o.preview = { w: Math.max(1, Math.round(img.baked.w * o.previewScale)), h: Math.max(1, Math.round(img.baked.h * o.previewScale)) };
      const tex = this.gpu.render(img, vibe, adj, o);
      return { tex, w: tex.w, h: tex.h };
    }
    const r = await this.cpu.call({ op: 'draw', key: img.key, vibe, adj, opts: o });
    return { rgba: r.rgba, w: r.w, h: r.h };
  }

  release(frame) { if (frame?.tex) this.gpu.release(frame.tex); }

  async pixels(frame) { return frame.tex ? this.gpu.readback(frame.tex) : frame.rgba; }

  attach(canvas) {
    this.canvas = canvas;
    if (this.gpu) this.ctx = this.gpu.attachCanvas(canvas);
    else this.ctx2d = canvas.getContext('2d');
  }

  /** view: { scale, offsetX, offsetY } maps canvas pixels to image pixels. */
  present(frame, view, bg) {
    if (this.gpu) { this.gpu.present(this.ctx, frame.tex, view, bg); return; }
    if (frame.bitmapFor !== frame.rgba) {
      const c = frame.canvas || (frame.canvas = new OffscreenCanvas(frame.w, frame.h));
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.rgba.buffer), frame.w, frame.h), 0, 0);
      frame.bitmapFor = frame.rgba;
    }
    const g = this.ctx2d, v = 255 * bg;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.imageSmoothingQuality = 'high';
    g.setTransform(1 / view.scale, 0, 0, 1 / view.scale, -view.offsetX / view.scale, -view.offsetY / view.scale);
    g.drawImage(frame.canvas, 0, 0);
  }
}

let keyCounter = 0;
