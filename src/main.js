// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// The app: roll, looks, sliders, preview, filmstrip, zen mode and export.
// Written 2026-11-09 for Flashnack. Controls and shortcuts follow LoFi Logic's
// editor (ui/editor.py, ui/zen_overlay.py); the code is new.

import './styles.css';
import { Zip, ZipPassThrough } from 'fflate';
import { Engine } from './engine.js';
import {
  VIBES, defaultAdjustments, BASE_KELVIN, lookConfigFor, isVibe,
} from './config.js';
import { FILM_LOOKS, FLASHBACK_LOOKS, POPULAR_LOOKS, SEARCH_CHIPS, filmLook, filmLutUrl, searchLooks } from './looks/catalog.js';
import { filesFromDrop, classify, exportName, uniqueNames, download, stem } from './library.js';

const $ = (id) => document.getElementById(id);
const app = $('app');

// ---- persisted preferences (per browser) ----------------------------------------
const store = {
  get(k, d) { try { const v = localStorage.getItem(`flashnack.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`flashnack.${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};

const S = {
  photos: [],
  cur: -1,
  vibeId: isVibe(store.get('vibe')) || filmLook(store.get('vibe')) ? store.get('vibe') : 'disposable',
  looks: {},
  compare: false,
  zen: false,
  clip: null,
  view: { fit: true, scale: 1, cx: 0, cy: 0 },
  exporting: null,
};
const savedLooks = store.get('looks', {});
const presetFor = (id) => lookConfigFor(id, filmLook(id));
/** Settings of a look, made on first use (film looks are many, so they are made lazily). */
function lookFor(id) {
  if (!S.looks[id] && (isVibe(id) || filmLook(id))) S.looks[id] = { ...presetFor(id), ...(savedLooks[id] || {}) };
  return S.looks[id];
}
for (const v of VIBES) lookFor(v.id);
const look = () => lookFor(S.vibeId);
const photo = () => S.photos[S.cur];

let engine;
let nextId = 1;
const curImg = { develop: null, baked: null, bakedKey: null, isJpeg: false, photoId: null };
const fullCache = new Map(); // photo id -> develop {data, width, height}; at most 3
let shown = null;            // texture on screen

// ---- slider definitions ---------------------------------------------------------
const sign = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
const PHOTO_SLIDERS = [
  { key: 'exposure_ev', label: 'Exposure', min: -3, max: 3, step: 0.05, fmt: (v) => `${sign(v)} EV` },
  { key: 'wb_temp', label: 'Warmth', min: -3000, max: 3000, step: 50, fmt: (v) => `${(BASE_KELVIN + v).toLocaleString('en')} K` },
  { key: 'tint', label: 'Tint', min: -10, max: 10, step: 0.2, fmt: (v) => (Math.round(v * 5) === 0 ? '0' : `${sign(Math.round(v * 5), 0)} ${v > 0 ? 'magenta' : 'green'}`) },
  { key: 'push_pull_ev', label: 'Push / pull', min: -2, max: 2, step: 0.1, fmt: (v) => `${sign(v)} stops`, hint: 'Like pushing film: shifts contrast and grain, not brightness' },
];
const LOOK_SLIDERS = [
  { key: 'grain_strength_pct', flag: 'enable_grain', label: 'Grain', min: 0, max: 200, step: 1, fmt: (v) => `${v}%` },
  { key: 'halation_strength_pct', flag: 'enable_halation', label: 'Halation (glow around lights)', min: 0, max: 300, step: 1, fmt: (v) => `${v}%` },
  { key: 'halation_warmth_pct', label: 'Halation colour', min: 0, max: 300, step: 1, fmt: (v) => `${v}%` },
  { key: 'bloom_strength_pct', flag: 'enable_bloom', label: 'Bloom', min: 0, max: 100, step: 1, fmt: (v) => `${v}%` },
  { key: 'vignette_strength_pct', flag: 'enable_vignette', label: 'Vignette', min: 0, max: 100, step: 1, fmt: (v) => `${v}%` },
  { key: 'vignette_curve', label: 'Vignette softness', min: -100, max: 100, step: 1, fmt: (v) => sign(v, 0) },
  { key: 'softness_sigma', flag: 'enable_softness', label: 'Softness', min: 0, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)} px` },
  { key: 'edge_softness_strength_pct', flag: 'enable_edge_softness', label: 'Soft corners', min: 0, max: 100, step: 1, fmt: (v) => `${v}%` },
  { key: 'sharpen_strength_pct', flag: 'enable_sharpen', label: 'Sharpen', min: 0, max: 500, step: 5, fmt: (v) => `${v}%` },
  { key: 'ca_pixels', flag: 'enable_chromatic_aberration', label: 'Colour fringing', min: 0, max: 20, step: 0.5, fmt: (v) => `${v.toFixed(1)} px` },
  { key: 'cnr_amount_pct', flag: 'enable_cnr', label: 'Colour noise reduction', min: 0, max: 100, step: 1, fmt: (v) => `${v}%` },
];

function buildSliders(container, defs, get, set, reset) {
  container.textContent = '';
  const rows = defs.map((d) => {
    const row = document.createElement('div');
    row.className = 'slider';
    const id = `s-${d.key}`;
    row.innerHTML = `<label for="${id}"></label><output for="${id}"></output><input type="range" id="${id}">`;
    row.querySelector('label').textContent = d.label;
    if (d.hint) row.title = d.hint;
    const input = row.querySelector('input'), out = row.querySelector('output');
    Object.assign(input, { min: d.min, max: d.max, step: d.step });
    input.addEventListener('input', () => { set(d, parseFloat(input.value)); out.textContent = d.fmt(parseFloat(input.value)); });
    input.addEventListener('dblclick', () => { reset(d); sync(); });
    container.append(row);
    const sync = () => { const v = get(d); input.value = v; out.textContent = d.fmt(v); };
    return sync;
  });
  return () => rows.forEach((f) => f());
}

const syncPhotoSliders = buildSliders($('sliders'), PHOTO_SLIDERS,
  (d) => photo()?.adj[d.key] ?? 0,
  (d, v) => { const p = photo(); if (!p) return; p.adj[d.key] = v; onPhotoChanged(p); },
  (d) => { const p = photo(); if (!p) return; p.adj[d.key] = 0; onPhotoChanged(p); });

const lookValue = (d) => { const l = look(); return d.flag && !l[d.flag] ? 0 : l[d.key]; };
const syncLookSliders = buildSliders($('look-sliders'), LOOK_SLIDERS, lookValue,
  (d, v) => { const l = look(); l[d.key] = v; if (d.flag) l[d.flag] = v > 0; onLookChanged(); },
  (d) => { const l = look(), p = presetFor(S.vibeId); l[d.key] = p[d.key]; if (d.flag) l[d.flag] = p[d.flag]; onLookChanged(); });

const FILM_SLIDERS = [{ key: 'film_strength_pct', label: 'Look strength', min: 0, max: 100, step: 1, fmt: (v) => `${v}%` }];
const syncFilmSliders = buildSliders($('film-strength'), FILM_SLIDERS, (d) => look()[d.key] ?? 100,
  (d, v) => { look()[d.key] = v; onLookChanged(); },
  (d) => { look()[d.key] = 100; onLookChanged(); });

// ---- looks -------------------------------------------------------------------------
const lookCanvases = {};           // look id -> canvas of each original look card
const visibleCards = new Set();    // film look cards on screen
const cardObserver = new IntersectionObserver((entries) => {
  let added = false;
  for (const e of entries) {
    if (e.isIntersecting) { if (!visibleCards.has(e.target)) { visibleCards.add(e.target); added = true; } } else visibleCards.delete(e.target);
  }
  if (added) renderLookCards();
}, { rootMargin: '120px' });
/** Canvases to draw for a render pass: the originals and the film cards on screen, grouped by look. */
function cardCanvases() {
  const m = new Map(VIBES.map((v) => [v.id, [lookCanvases[v.id]]]));
  for (const el of visibleCards) {
    if (!el.isConnected) { visibleCards.delete(el); continue; }
    const id = el.dataset.id;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(el.querySelector('canvas'));
  }
  return m;
}

function lookCard(id, name, blurb, key) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'look';
  b.setAttribute('role', 'radio');
  b.dataset.id = id;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 96;
  if (isVibe(id)) lookCanvases[id] = c;
  const text = document.createElement('span');
  text.innerHTML = '<span class="look-name"></span><span class="look-blurb"></span>';
  text.querySelector('.look-name').textContent = name;
  text.querySelector('.look-blurb').textContent = blurb;
  b.append(c, text);
  if (key) { const k = document.createElement('kbd'); k.textContent = key; b.append(k); }
  b.addEventListener('click', () => setVibe(id));
  return b;
}

// Group and maker, so the two Portra 400s (t3mujin, Pat David) can be told apart.
const SOURCE_SHORT = { t3mujin: 't3mujin', rt: 'Pat David' };
const filmBlurb = (l) => (l.source === 'flashback' ? 'Flashback app' : l.source === 'own' ? 'Flashnack era look' : l.source === 'cssgram' ? 'Instagram era'
  : `${l.group.replace(/^\w/, (c) => c.toUpperCase())} · ${SOURCE_SHORT[l.source] || l.source}`);

function filmCard(l) {
  const b = lookCard(l.id, l.name.replace(/^Flashback /, ''), filmBlurb(l));
  b.classList.add('look-film');
  b.title = `${l.name} · ${l.tags.slice(0, 6).join(', ')}`;
  if (!l.popular) {
    const badge = document.createElement('span');
    badge.className = 'look-badge';
    badge.textContent = 'needs internet';
    b.append(badge);
  }
  cardObserver.observe(b);
  return b;
}

const RESULTS_PAGE = 40;
let resultsShown = RESULTS_PAGE;
function showResults() {
  const q = $('look-search').value;
  const list = $('look-results');
  for (const c of list.children) { cardObserver.unobserve(c); visibleCards.delete(c); }
  list.textContent = '';
  const found = q.trim() ? searchLooks(q) : [];
  $('look-count').textContent = q.trim() ? (found.length ? `${found.length} look${found.length === 1 ? '' : 's'}` : 'Nothing found. Try y2k, 80s, polaroid or portra.') : '';
  for (const l of found.slice(0, resultsShown)) list.append(filmCard(l));
  $('look-more').hidden = found.length <= resultsShown;
  for (const c of document.querySelectorAll('.look-chip')) c.setAttribute('aria-pressed', String(c.dataset.q === q.trim()));
  markLook();
  markOffline();
}

/** On a connection loss, mark looks that are neither bundled nor already cached. */
async function markOffline() {
  const offline = !navigator.onLine;
  app.classList.toggle('is-offline', offline);
  if (!offline || !('caches' in window)) return;
  for (const b of document.querySelectorAll('.look-film')) {
    if (filmLook(b.dataset.id)?.popular) continue;
    const hit = await caches.match(filmLutUrl(b.dataset.id)).catch(() => null);
    b.classList.toggle('look-cached', !!hit);
  }
}

function buildLooks() {
  const box = $('looks');
  VIBES.forEach((v, i) => box.append(lookCard(v.id, v.name, v.blurb, String(i + 1))));
  for (const l of FLASHBACK_LOOKS) $('looks-flashback').append(filmCard(l));
  for (const l of POPULAR_LOOKS.filter((x) => x.group !== 'flashback')) $('looks-popular').append(filmCard(l));
  const search = $('look-search');
  search.placeholder = `Search ${FILM_LOOKS.length} looks: y2k, 80s, polaroid…`;
  let t = 0;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { resultsShown = RESULTS_PAGE; showResults(); }, 120); });
  for (const chip of SEARCH_CHIPS) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'look-chip';
    c.dataset.q = chip;
    c.textContent = chip;
    c.addEventListener('click', () => { search.value = search.value.trim() === chip ? '' : chip; resultsShown = RESULTS_PAGE; showResults(); });
    $('look-chips').append(c);
  }
  $('look-more').addEventListener('click', () => { resultsShown += RESULTS_PAGE; showResults(); });
  window.addEventListener('online', markOffline);
  window.addEventListener('offline', markOffline);
  // A film look picked last time that is not on screen yet: show it in the results.
  if (filmLook(S.vibeId) && !filmLook(S.vibeId).popular) { search.value = filmLook(S.vibeId).name; showResults(); }
  markLook();
}
function markLook() {
  for (const b of document.querySelectorAll('#controls .look')) b.setAttribute('aria-checked', String(b.dataset.id === S.vibeId));
  const film = !!filmLook(S.vibeId);
  $('film-strength').hidden = !film;
  $('look-current').textContent = film ? `${filmLook(S.vibeId).name}` : '';
}
function setVibe(id) {
  if (!lookFor(id) || id === S.vibeId) return;
  S.vibeId = id;
  store.set('vibe', id);
  markLook();
  syncLookSliders();
  syncFilmSliders();
  onLookChanged(false);
}

// ---- photos and the filmstrip ---------------------------------------------------

function frameEl(p, index) {
  const li = document.createElement('li');
  li.className = 'frame';
  li.innerHTML = `<div class="frame-print"><span></span><span></span></div>
    <button type="button" class="frame-btn"></button>
    <button type="button" class="frame-keep" aria-pressed="true"></button>
    <span class="frame-state"></span>
    <div class="frame-print"><span></span><span></span></div>`;
  const prints = li.querySelectorAll('.frame-print span');
  prints[0].textContent = `▸ ${index + 1}`;
  prints[1].textContent = `${index + 1}A`;
  prints[2].textContent = stem(p.name).slice(0, 18).toUpperCase();
  prints[3].textContent = p.kind === 'v1' ? 'V1' : p.kind === 'v2' ? 'V2' : '';
  const c = document.createElement('canvas');
  c.width = 96; c.height = 72;
  p.thumb = c;
  const btn = li.querySelector('.frame-btn');
  btn.append(c);
  btn.setAttribute('aria-label', `Photo ${index + 1}: ${p.name}`);
  btn.addEventListener('click', () => select(S.photos.indexOf(p)));
  const keep = li.querySelector('.frame-keep');
  keep.addEventListener('click', () => toggleInclude(p));
  p.el = li;
  updateFrame(p);
  return li;
}

function updateFrame(p) {
  if (!p.el) return;
  p.el.classList.toggle('skipped', !p.include);
  const keep = p.el.querySelector('.frame-keep');
  keep.setAttribute('aria-pressed', String(p.include));
  keep.setAttribute('aria-label', p.include ? `Skip photo ${S.photos.indexOf(p) + 1} when exporting` : `Export photo ${S.photos.indexOf(p) + 1}`);
  keep.title = p.include ? 'In the export. Click to leave it out.' : 'Left out of the export. Click to include.';
  p.el.querySelector('.frame-state').textContent = p.status === 'error' ? "Can't open" : p.status === 'loading' ? 'Developing…' : !p.include ? 'Skipped' : '';
  if (p.status === 'error') p.el.title = p.error;
  p.el.setAttribute('aria-current', String(S.photos.indexOf(p) === S.cur));
}

function toggleInclude(p) {
  p.include = !p.include;
  updateFrame(p);
  updateCounts();
}

function updateCounts() {
  const ready = S.photos.filter((p) => p.status !== 'error');
  const n = ready.filter((p) => p.include).length;
  $('export').textContent = n === 1 ? 'Export 1 photo' : `Export ${n} photos`;
  $('export').disabled = !n || !!S.exporting;
  $('count').textContent = S.photos.length ? `${S.photos.length} ${S.photos.length === 1 ? 'photo' : 'photos'} in this roll` : '';
}

/** opts.adj: starting adjustments for these photos (camera mode passes its exposure). */
async function addFiles(files, opts = {}) {
  if (!files.length) return;
  const { photos, zips, skipped } = await classify(files);
  for (const z of zips) {
    try {
      const negs = await engine.unzip(await z.arrayBuffer());
      if (!negs.length) skipped.push({ name: z.name, reason: 'No Flashback V1 negatives in this zip' });
      for (const n of negs) photos.push({ name: n.name, kind: 'v1', negative: n, roll: stem(z.name) });
    } catch (e) {
      skipped.push({ name: z.name, reason: `Could not read the zip: ${e.message}` });
    }
  }
  if (skipped.length) toast(skipped.length === 1 ? `${skipped[0].name}: ${skipped[0].reason}` : `${skipped.length} files skipped. ${skipped[0].reason}.`);
  if (!photos.length) return;

  const strip = $('strip');
  const start = S.photos.length;
  for (const src of photos) {
    const p = {
      ...src, id: nextId++, adj: { ...defaultAdjustments(), ...(opts.adj || {}) }, include: true, status: 'loading',
      isV1: src.kind === 'v1', isJpeg: !!src.isJpeg, seed: (Math.random() * 2 ** 31) | 0,
      small: null, smallImg: { develop: null, baked: null, bakedKey: null, isJpeg: !!src.isJpeg },
    };
    S.photos.push(p);
    strip.append(frameEl(p, S.photos.length - 1));
  }
  app.dataset.state = 'editing';
  updateCounts();
  if (S.cur < 0) select(start);
  for (const p of S.photos.slice(start)) await prepare(p);
}

/** Work out the kind, develop a small copy for the thumbnail. */
async function prepare(p) {
  try {
    if (p.kind === 'dng' || p.kind === 'raw') {
      // Most RAWs are TIFF-based: read Make and BaselineExposure for the exposure anchor.
      const head = await p.file.slice(0, 1024 * 1024).arrayBuffer();
      const meta = await engine.meta(head);
      if (p.kind === 'dng') p.kind = meta?.isFlashback ? 'v2' : 'raw';
      p.meta = meta || {};
      p.el.querySelectorAll('.frame-print span')[3].textContent = p.kind === 'v2' ? 'V2' : '';
    }
    const dev = await developPhoto(p, { wantSmall: true, wantFull: S.photos[S.cur] === p });
    p.small = dev.small;
    if (dev.data) cacheFull(p, dev);
    p.status = 'ready';
    await engine.setImage(p.smallImg, p.small);
    updateFrame(p);
    queueThumb(p);
    if (photo() === p) { await showCurrent(); renderLookCards(); }
  } catch (e) {
    console.error(e);
    p.status = 'error';
    p.error = e.message;
    updateFrame(p);
    updateCounts();
    if (photo() === p) note(`Couldn't open ${p.name}: ${e.message}`);
  }
}

async function source(p) {
  if (p.kind === 'v1') return { kind: 'v1', negative: p.negative, seed: p.seed };
  return { kind: p.kind, buffer: await p.file.arrayBuffer(), meta: p.meta };
}

function developPhoto(p, opts) {
  return source(p).then((src) => engine.develop(src, opts));
}

function cacheFull(p, dev) {
  fullCache.delete(p.id);
  fullCache.set(p.id, { data: dev.data, width: dev.width, height: dev.height });
  while (fullCache.size > 3) fullCache.delete(fullCache.keys().next().value);
}

async function getFull(p) {
  const hit = fullCache.get(p.id);
  if (hit) { fullCache.delete(p.id); fullCache.set(p.id, hit); return hit; }
  const dev = await developPhoto(p, { wantSmall: !p.small });
  if (!p.small && dev.small) p.small = dev.small;
  cacheFull(p, dev);
  return fullCache.get(p.id);
}

async function select(i) {
  if (i < 0 || i >= S.photos.length) return;
  const prev = photo();
  S.cur = i;
  if (prev) updateFrame(prev);
  const p = photo();
  updateFrame(p);
  p.el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  syncPhotoSliders();
  S.view.fit = true;
  if (p.status === 'ready') { await showCurrent(); renderLookCards(); }
  else if (p.status === 'error') note(`Couldn't open ${p.name}: ${p.error}`);
  else note('Developing…');
}

async function showCurrent() {
  const p = photo();
  if (!p || p.status !== 'ready') return;
  if (curImg.photoId !== p.id) {
    note('Developing…');
    const dev = await getFull(p);
    if (photo() !== p) return;
    curImg.isJpeg = p.isJpeg;
    await engine.setImage(curImg, dev);
    curImg.photoId = p.id;
    curImg.fullW = dev.width; curImg.fullH = dev.height;
    note('');
    prefetch();
  }
  await requestRender();
}

function prefetch() {
  const n = S.photos[S.cur + 1];
  if (n && n.status === 'ready' && !fullCache.has(n.id)) setTimeout(() => { if (!fullCache.has(n.id)) getFull(n).catch(() => {}); }, 300);
}

// ---- rendering --------------------------------------------------------------------
let renderQueued = null;
function requestRender() {
  if (!renderQueued) {
    renderQueued = new Promise((resolve) => requestAnimationFrame(() => { renderQueued = null; renderMain().then(resolve, resolve); }));
  }
  return renderQueued;
}

let renderSeq = 0, fullTimer = 0;
async function renderMain() {
  const p = photo();
  if (!p || curImg.photoId !== p.id) return;
  const seq = ++renderSeq;
  const l = look(), opts = { isV1: p.isV1, seed: p.seed, plain: S.compare };
  // The CPU renderer is slow: show a quick half-size draft, then the full render once edits pause.
  if (engine.cpu) {
    opts.previewScale = 0.5;
    clearTimeout(fullTimer);
    fullTimer = setTimeout(async () => {
      if (seq !== renderSeq) return;
      note('Rendering…');
      const full = await engine.draw(curImg, l, p.adj, { isV1: p.isV1, seed: p.seed, plain: S.compare });
      if (seq === renderSeq) { showFrame(full); note(''); }
    }, 450);
  }
  const out = await engine.draw(curImg, l, p.adj, opts);
  if (seq !== renderSeq || photo() !== p) { engine.release(out); return; }
  showFrame(out);
}
function showFrame(out) {
  if (shown) engine.release(shown);
  shown = out;
  present();
}

const canvas = $('view');
/** Size of the full-resolution render on screen (rotation applied). */
function fullSize() {
  if (!curImg.fullW) return [shown.w, shown.h];
  return (photo()?.adj.rotation ?? 0) % 180 ? [curImg.fullH, curImg.fullW] : [curImg.fullW, curImg.fullH];
}
function present() {
  if (!shown) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, Math.round(canvas.clientWidth * dpr)), ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const [iw, ih] = fullSize(), v = S.view;
  const fitScale = Math.max(iw / cw, ih / ch);
  if (v.fit) { v.scale = fitScale; v.cx = iw / 2; v.cy = ih / 2; }
  // The page background grey (#262626 dark, #d6d6d6 light), as 0..1.
  const bg = matchMedia('(prefers-color-scheme: light)').matches ? 0xd6 / 255 : 0x26 / 255;
  // A half-size draft is drawn at the full image's scale.
  const k = shown.w / iw;
  engine.present(shown, { scale: v.scale * k, offsetX: (v.cx - (cw / 2) * v.scale) * k, offsetY: (v.cy - (ch / 2) * v.scale) * k }, S.zen ? 0 : bg);
  $('zoom').textContent = v.fit ? 'Fit' : `${Math.round(100 / v.scale)}%`;
}

/** Small renders: thumbnails and look cards, read back into 2D canvases. */
let thumbChain = Promise.resolve();
async function drawSmall(p, vibe, adj, canvasEl) {
  if (!p.small) return;
  // Thumbnails skip halation and effects; the look and the sliders still apply.
  const v = { ...vibe, enable_halation: false };
  const out = await engine.draw(p.smallImg, v, adj, { isV1: p.isV1, previewScale: 1 });
  const px = await engine.pixels(out);
  engine.release(out);
  if (canvasEl.width !== out.w || canvasEl.height !== out.h) { canvasEl.width = out.w; canvasEl.height = out.h; }
  canvasEl.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), out.w, out.h), 0, 0);
}
function queueThumb(p) {
  if (p.status !== 'ready') return;
  p.thumbWanted = true;
  thumbChain = thumbChain.then(async () => {
    if (!p.thumbWanted) return;
    p.thumbWanted = false;
    await drawSmall(p, look(), p.adj, p.thumb).catch((e) => console.warn(e));
  });
}
let cardsTimer = 0;
function renderLookCards() {
  clearTimeout(cardsTimer);
  cardsTimer = setTimeout(() => {
    const p = photo();
    if (!p || p.status !== 'ready') return;
    // The five originals, then the film looks on screen (not all of them).
    for (const [id, canvases] of cardCanvases()) {
      thumbChain = thumbChain.then(async () => {
        const live = canvases.filter((c) => c.isConnected);
        if (!live.length) return;
        await drawSmall(p, lookFor(id), p.adj, live[0]);
        for (const c of live.slice(1)) { c.width = live[0].width; c.height = live[0].height; c.getContext('2d').drawImage(live[0], 0, 0); }
      }).catch(() => {});
    }
  }, 120);
}

let thumbTimer = 0;
function onPhotoChanged(p) {
  if (p === photo()) requestRender();
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => { queueThumb(p); renderLookCards(); }, 150);
}

let allThumbsTimer = 0;
function onLookChanged(save = true) {
  if (save) {
    // Start from what was saved, so tweaks to looks not opened this time are kept.
    const diff = { ...savedLooks };
    for (const [id, cur] of Object.entries(S.looks)) {
      const preset = presetFor(id), d = {};
      for (const k of Object.keys(cur)) if (cur[k] !== preset[k]) d[k] = cur[k];
      if (Object.keys(d).length) diff[id] = d; else delete diff[id];
      savedLooks[id] = diff[id];
    }
    store.set('looks', diff);
  }
  requestRender();
  clearTimeout(allThumbsTimer);
  allThumbsTimer = setTimeout(() => { S.photos.forEach(queueThumb); renderLookCards(); }, 200);
}

// ---- notes and toasts --------------------------------------------------------------
function note(text) { $('note').textContent = text; }
let toastTimer = 0;
function toast(text, ms = 4000) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---- export ------------------------------------------------------------------------
async function exportRoll() {
  const list = S.photos.filter((p) => p.include && p.status === 'ready');
  if (!list.length || S.exporting) return;
  const job = { cancelled: false };
  S.exporting = job;
  updateCounts();
  const prog = $('progress'), fill = $('progress-fill'), text = $('progress-text');
  prog.hidden = false;
  const vibeId = S.vibeId, l = { ...look() };
  const names = uniqueNames(await Promise.all(list.map((p) => exportName(p, vibeId))));
  const img = { develop: null, baked: null, bakedKey: null, isJpeg: false };
  const chunks = [];
  let zipDone;
  const zipFinished = new Promise((r) => { zipDone = r; });
  const zip = list.length > 1 ? new Zip((err, data, final) => { if (err) throw err; chunks.push(data); if (final) zipDone(); }) : null;
  let single = null;
  try {
    for (let i = 0; i < list.length; i++) {
      if (job.cancelled) break;
      const p = list[i];
      text.textContent = `Exporting ${i + 1} of ${list.length}: ${names[i]}`;
      fill.style.width = `${(i / list.length) * 100}%`;
      const dev = await getFull(p);
      img.isJpeg = p.isJpeg;
      await engine.setImage(img, dev);
      const out = await engine.draw(img, l, p.adj, { isV1: p.isV1, seed: p.seed });
      const rgba = await engine.pixels(out);
      const { w, h } = out;
      engine.release(out);
      const jpg = await engine.encodeJpeg(rgba, w, h, 95);
      if (zip) {
        const f = new ZipPassThrough(names[i]);
        zip.add(f);
        f.push(jpg, true);
      } else single = jpg;
    }
    fill.style.width = '100%';
    if (job.cancelled) { toast('Export cancelled'); return; }
    if (zip) {
      zip.end();
      await zipFinished;
      download(new Blob(chunks, { type: 'application/zip' }), `flashnack-${vibeId.replace(/_/g, '-')}-${new Date().toISOString().slice(0, 10)}.zip`);
      toast(`Exported ${list.length} photos`);
    } else {
      download(new Blob([single], { type: 'image/jpeg' }), names[0]);
      toast('Exported 1 photo');
    }
  } catch (e) {
    console.error(e);
    toast(`Export stopped: ${e.message}`, 8000);
  } finally {
    engine.dropImage(img);
    prog.hidden = true;
    S.exporting = null;
    updateCounts();
  }
}

// ---- viewer: zoom, pan, compare, rotate, zen -----------------------------------------
function zoomAt(factor, px, py) {
  if (!shown) return;
  const dpr = window.devicePixelRatio || 1, v = S.view;
  const cw = canvas.width, ch = canvas.height;
  const [iw, ih] = fullSize();
  const fitScale = Math.max(iw / cw, ih / ch);
  const x = px * dpr, y = py * dpr;
  const ix = v.cx + (x - cw / 2) * v.scale, iy = v.cy + (y - ch / 2) * v.scale;
  let s = v.scale / factor;
  s = Math.min(fitScale, Math.max(1 / 8, s));
  v.fit = s >= fitScale - 1e-6;
  v.scale = s;
  v.cx = ix - (x - cw / 2) * s;
  v.cy = iy - (y - ch / 2) * s;
  present();
}

function setupViewer() {
  canvas.addEventListener('wheel', (e) => {
    if (S.zen || !shown) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    if (S.zen || !shown) return;
    const r = canvas.getBoundingClientRect();
    // Fit <-> 100% (one photo pixel per screen pixel).
    if (S.view.fit) zoomAt(S.view.scale, e.clientX - r.left, e.clientY - r.top);
    else { S.view.fit = true; present(); }
  });

  let drag = null;
  canvas.addEventListener('contextmenu', (e) => { if (S.zen) e.preventDefault(); });
  canvas.addEventListener('pointerdown', (e) => {
    if (!shown) return;
    canvas.setPointerCapture(e.pointerId);
    const p = photo();
    drag = { x: e.clientX, y: e.clientY, cx: S.view.cx, cy: S.view.cy, button: e.button, adj: p ? { ...p.adj } : null };
    if (!S.zen) canvas.classList.add('panning');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const p = photo();
    if (S.zen && p && drag.adj) {
      // Zen gestures, as in LoFi Logic's zen mode.
      if (drag.button === 2) p.adj.tint = clamp(drag.adj.tint + dx * 0.02, -10, 10);
      else {
        p.adj.exposure_ev = clamp(drag.adj.exposure_ev - dy * 0.008, -3, 3);
        p.adj.wb_temp = clamp(Math.round((drag.adj.wb_temp + dx * 6) / 10) * 10, -3000, 3000);
      }
      onPhotoChanged(p);
      return;
    }
    if (S.view.fit) return;
    const dpr = window.devicePixelRatio || 1;
    S.view.cx = drag.cx - dx * dpr * S.view.scale;
    S.view.cy = drag.cy - dy * dpr * S.view.scale;
    present();
  });
  const end = () => { if (drag && S.zen) syncPhotoSliders(); drag = null; canvas.classList.remove('panning'); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const cmp = $('compare');
  const on = () => { if (!S.compare) { S.compare = true; cmp.setAttribute('aria-pressed', 'true'); note('Without the look'); requestRender(); } };
  const off = () => { if (S.compare) { S.compare = false; cmp.setAttribute('aria-pressed', 'false'); note(''); requestRender(); } };
  cmp.addEventListener('pointerdown', on);
  cmp.addEventListener('pointerup', off);
  cmp.addEventListener('pointerleave', off);
  cmp.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); on(); } });
  cmp.addEventListener('keyup', off);
  S.compareOn = on; S.compareOff = off;

  $('rotate').addEventListener('click', () => rotate(90));
  $('zen').addEventListener('click', () => setZen(true));
  new ResizeObserver(() => present()).observe(canvas);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function rotate(deg) {
  const p = photo();
  if (!p || p.status !== 'ready') return;
  p.adj.rotation = (((p.adj.rotation + deg) % 360) + 360) % 360;
  S.view.fit = true;
  onPhotoChanged(p);
}

function setZen(on) {
  S.zen = on;
  app.classList.toggle('zen', on);
  if (on) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  S.view.fit = true;
  requestAnimationFrame(present);
  if (!on) syncPhotoSliders();
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.zen) setZen(false); });

// ---- keyboard ------------------------------------------------------------------------
function setupKeys() {
  document.addEventListener('keydown', (e) => {
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape' && S.zen) { setZen(false); return; }
    if (inField && !mod) return;
    if (mod && e.key.toLowerCase() === 'c' && photo() && !window.getSelection()?.toString()) {
      const { rotation, ...rest } = photo().adj;
      S.clip = rest;
      toast('Copied this photo’s settings');
      e.preventDefault();
    } else if (mod && e.key.toLowerCase() === 'v' && S.clip && photo()) {
      Object.assign(photo().adj, S.clip);
      syncPhotoSliders();
      onPhotoChanged(photo());
      toast('Pasted settings');
      e.preventDefault();
    } else if (mod) {
      return;
    } else if (/^[1-5]$/.test(e.key)) {
      setVibe(VIBES[parseInt(e.key, 10) - 1].id);
    } else if (e.key === 'ArrowRight') { select(S.cur + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { select(S.cur - 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && S.zen) { rotate(-90); e.preventDefault(); }
    else if (e.key === 'ArrowDown' && S.zen) { rotate(90); e.preventDefault(); }
    else if (e.key.toLowerCase() === 'r') rotate(90);
    else if (e.key.toLowerCase() === 'z' && S.photos.length) setZen(!S.zen);
    else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) { S.compareOn?.(); e.preventDefault(); }
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') S.compareOff?.(); });
}

// ---- files in -------------------------------------------------------------------------
function setupInput() {
  const pick = $('pick'), pickDir = $('pick-dir');
  $('add').addEventListener('click', () => pick.click());
  $('choose').addEventListener('click', () => pick.click());
  $('choose-dir').addEventListener('click', () => pickDir.click());
  for (const inp of [pick, pickDir]) inp.addEventListener('change', () => { addFiles([...inp.files]); inp.value = ''; });

  let depth = 0;
  window.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { depth++; app.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) app.classList.remove('dragging'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    app.classList.remove('dragging');
    addFiles(await filesFromDrop(e.dataTransfer));
  });

  $('try-samples').addEventListener('click', async () => {
    const base = import.meta.env.BASE_URL;
    const files = await Promise.all(['snow-field.jpg', 'viaduct.jpg'].map(async (n) => {
      const r = await fetch(`${base}samples/${n}`);
      if (!r.ok) throw new Error(`Could not load the sample ${n}`);
      return new File([await r.blob()], n, { type: 'image/jpeg' });
    })).catch((e) => { toast(e.message); return []; });
    addFiles(files);
  });
  $('export').addEventListener('click', exportRoll);
  $('progress-cancel').addEventListener('click', () => { if (S.exporting) S.exporting.cancelled = true; });
  $('apply-all').addEventListener('click', () => {
    const p = photo();
    if (!p) return;
    const { rotation, ...rest } = p.adj;
    for (const q of S.photos) if (q !== p) { Object.assign(q.adj, rest); queueThumb(q); }
    toast(`Used these settings on all ${S.photos.length} photos`);
  });
  $('reset-photo').addEventListener('click', () => {
    const p = photo();
    if (!p) return;
    p.adj = { ...defaultAdjustments(), rotation: p.adj.rotation };
    syncPhotoSliders();
    onPhotoChanged(p);
  });
  $('reset-look').addEventListener('click', () => {
    S.looks[S.vibeId] = presetFor(S.vibeId);
    syncLookSliders();
    syncFilmSliders();
    onLookChanged();
  });
}

// ---- the ONE35 V2 in 3D -----------------------------------------------------------------
const hasWebGL = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
let cam3dModule = null;
const loadCam3d = () => (cam3dModule ||= import('./camera3d/viewer.js'));

function setupCamera3D() {
  const mini = $('cam3d-mini'), dialog = $('cam3d');
  if (!hasWebGL) { mini.hidden = true; return; }
  let colourway = store.get('colourway', 'black-yellow');
  // Load three.js once the page is idle, then show the camera spinning on the empty screen.
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  idle(async () => {
    try {
      const { mountCamera3D } = await loadCam3d();
      S.cam3dMini = mountCamera3D(mini, { colourway, autoRotate: true, zoom: false });
    } catch (e) { console.warn('[flashnack] 3D camera unavailable:', e); mini.hidden = true; }
  });
  let downAt = null;
  mini.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  mini.addEventListener('click', (e) => {
    const moved = downAt && e.detail && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5;
    downAt = null;
    if (!moved) open();
  });

  let full = null;
  const help = dialog.querySelector('.cam3d-help'), helpText = help.textContent;
  async function open() {
    const { mountCamera3D, COLOURWAYS } = await loadCam3d();
    const box = $('cam3d-colours');
    if (!box.children.length) {
      for (const c of COLOURWAYS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.setAttribute('role', 'radio');
        b.title = c.name;
        b.setAttribute('aria-label', c.name);
        b.dataset.id = c.id;
        b.style.setProperty('--a', c.body);
        b.style.setProperty('--b', c.band);
        if (c.crystal) b.classList.add('swatch-crystal');
        b.addEventListener('click', () => {
          colourway = c.id;
          store.set('colourway', colourway);
          full?.setColourway(colourway);
          S.cam3dMini?.setColourway(colourway);
          for (const x of box.children) x.setAttribute('aria-checked', String(x.dataset.id === colourway));
        });
        box.append(b);
      }
    }
    for (const x of box.children) x.setAttribute('aria-checked', String(x.dataset.id === colourway));
    help.textContent = helpText;
    dialog.showModal();
    full = mountCamera3D($('cam3d-stage'), { colourway, interactive: true, onStatus: (t) => { help.textContent = t; } });
    S.cam3dFull = full;
  }
  dialog.addEventListener('close', () => { full?.dispose(); full = null; S.cam3dFull = null; });
  $('cam3d-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  S.openCamera3D = open;
}

// ---- camera mode ------------------------------------------------------------------------
function setupShoot() {
  let open = false;
  async function start() {
    if (open) return;
    open = true;
    try {
      const { openShoot } = await import('./camera2d/shoot.js');
      const looks = [
        { id: '', name: 'Natural (no film look)', url: null },
        ...FLASHBACK_LOOKS, ...POPULAR_LOOKS.filter((l) => l.group !== 'flashback'),
      ].map((l) => ({ id: l.id, name: l.name, url: l.url === null ? null : filmLutUrl(l.id) }));
      const current = filmLook(S.vibeId) ? S.vibeId : 'fb-dispo';
      openShoot({
        root: $('shoot-view'), looks,
        lookId: looks.some((l) => l.id === current) ? current : 'fb-dispo',
        colourway: store.get('colourway', 'black-yellow'),
        onDone: (files, { lookId, ev }) => {
          open = false;
          if (lookId) setVibe(lookId);
          if (files.length) { addFiles(files, { adj: ev ? { exposure_ev: ev } : {} }); toast(`Developing ${files.length} photo${files.length === 1 ? '' : 's'}`); }
        },
      });
    } catch (e) { open = false; console.error(e); toast(`Camera mode failed: ${e.message}`); }
  }
  $('shoot').addEventListener('click', start);
  $('shoot-empty').addEventListener('click', start);
  S.openShoot = start;
}

// ---- start ----------------------------------------------------------------------------
async function start() {
  buildLooks();
  syncLookSliders();
  syncFilmSliders();
  syncPhotoSliders();
  setupInput();
  setupKeys();
  setupViewer();
  setupCamera3D();
  setupShoot();
  updateCounts();
  try {
    engine = await Engine.create({ cpu: new URLSearchParams(location.search).has('cpu') });
  } catch (e) {
    console.error(e);
    $('empty').querySelector('.empty-frame').innerHTML = `<p class="empty-title">Flashnack couldn't start</p><p class="empty-sub"></p>`;
    $('empty').querySelector('.empty-sub').textContent = e.message;
    return;
  }
  engine.attach(canvas);
  if (engine.gpu) engine.gpu.device.lost.then(() => toast('The graphics card stopped responding. Reload the page to continue.', 15000));
  else note('No WebGPU in this browser: rendering on the CPU, which is slower.');
  window.flashnack = { S, engine, addFiles, select, setVibe, exportRoll, searchLooks };
  // Offline: keep the app and the popular looks once the page has loaded.
  if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[flashnack] no offline support:', e));
  }
}
start();
