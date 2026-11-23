// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Written 2026-11-23 for Flashnack. Camera mode: take photos with this
// device's camera through a Flashback-style body. A moulded plastic camera
// fills the screen (the layout idea comes from (Not Boring) Camera; the art is
// Flashnack's own): live viewfinder, look dial, flash switch, LCD frame
// counter, winder, exposure wheel and a big shutter. Shots join the roll in
// the editor, which develops them with the chosen look.

import './shoot.css';
import { COLOURWAYS } from '../camera3d/colourways.js';
import { sounds } from '../camera3d/sounds.js';
import { createPreview, lut3dFromPng } from './preview.js';

const ROLL = 27;
const html = String.raw;

/**
 * opts: { root, looks: [{id, name, url}], lookId, colourway, onDone(files, { lookId, ev }) }
 * Returns a close() function.
 */
export function openShoot(opts) {
  const root = opts.root;
  const cw = COLOURWAYS.find((c) => c.id === opts.colourway) || COLOURWAYS[0];
  const looks = opts.looks;
  let lookIdx = Math.max(0, looks.findIndex((l) => l.id === opts.lookId));
  const state = { left: ROLL, wound: true, flash: false, ev: 0, facing: 'environment', blind: false, shots: [], busy: false };

  root.hidden = false;
  root.style.setProperty('--body', cw.body);
  root.style.setProperty('--band', cw.band);
  root.classList.toggle('shoot-light', !cw.body.startsWith('#1'));
  root.classList.toggle('shoot-crystal', !!cw.crystal);
  root.innerHTML = html`
    <div class="sh-body" role="application" aria-label="Camera">
      <div class="sh-band" aria-hidden="true"></div>
      <div class="sh-top">
        <button type="button" class="sh-flash" aria-pressed="false" title="Flash (F)">
          <span class="sh-slot"><span class="sh-knob"></span></span><span class="sh-label">Flash</span>
        </button>
        <div class="sh-lcd" aria-live="polite" title="Frames left"><span class="sh-lcd-ghost">88</span><span class="sh-lcd-num">27</span></div>
        <button type="button" class="sh-pill sh-flip" title="Switch camera">Flip</button>
        <button type="button" class="sh-pill sh-done" title="Develop the roll and edit it (Esc)">Develop</button>
      </div>
      <div class="sh-finder">
        <video playsinline muted></video>
        <canvas class="sh-canvas"></canvas>
        <div class="sh-frame" aria-hidden="true"></div>
        <p class="sh-msg" role="status"></p>
        <div class="sh-white" aria-hidden="true"></div>
      </div>
      <div class="sh-dial-row">
        <div class="sh-dial" tabindex="0" role="slider" aria-label="Look" title="Look: drag, scroll or use ← →">
          <div class="sh-dial-knurl"></div>
          <span class="sh-dial-name"></span>
        </div>
      </div>
      <div class="sh-bottom">
        <div class="sh-ev" tabindex="0" role="slider" aria-label="Exposure" aria-valuemin="-2" aria-valuemax="2" title="Exposure: drag up or down">
          <div class="sh-wheel"></div><span class="sh-ev-val">0.0</span>
        </div>
        <button type="button" class="sh-shutter" aria-label="Take a photo (Space)"><span></span></button>
        <div class="sh-winder" tabindex="0" role="button" aria-label="Wind on to the next frame (W)" title="Winder: drag up, or press W">
          <div class="sh-wheel"></div><span class="sh-wind-label">Wind</span>
        </div>
      </div>
      <label class="sh-blind"><input type="checkbox"> No screen, like the real thing</label>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const video = $('video'), canvas = $('.sh-canvas'), msg = $('.sh-msg');
  const say = (t) => { msg.textContent = t || ''; };
  let stream = null, preview = null, closed = false;

  // ---- camera stream -----------------------------------------------------------------
  async function startStream() {
    stream?.getTracks().forEach((t) => t.stop());
    if (!navigator.mediaDevices?.getUserMedia) { say('This browser cannot use a camera here. Camera mode needs https or localhost.'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: state.facing, width: { ideal: 4096 }, height: { ideal: 3072 } } });
      if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      preview?.setMirror(state.facing === 'user');
      say('');
    } catch (e) {
      say(e.name === 'NotAllowedError' ? 'Camera access was turned down. Allow it in the address bar to shoot.' : `No camera: ${e.message}`);
    }
  }
  try { preview = createPreview(canvas, video); } catch (e) { say(e.message); }

  // ---- look dial -----------------------------------------------------------------------
  const lutCache = new Map();
  async function setLook(i) {
    lookIdx = (i + looks.length) % looks.length;
    const l = looks[lookIdx];
    $('.sh-dial-name').textContent = l.name;
    $('.sh-dial').setAttribute('aria-valuetext', l.name);
    $('.sh-dial-knurl').style.backgroundPositionX = `${-lookIdx * 14}px`;
    sounds.tick();
    if (!l.url) { preview?.setLut(null); return; }
    try {
      if (!lutCache.has(l.id)) lutCache.set(l.id, lut3dFromPng(l.url));
      const lut = await lutCache.get(l.id);
      if (looks[lookIdx] === l) preview?.setLut(lut, 1);
    } catch (e) { lutCache.delete(l.id); say(`Could not load ${l.name}: ${e.message}`); }
  }
  const dial = $('.sh-dial');
  dragAxis(dial, 'x', 26, (steps) => setLook(lookIdx + steps));
  dial.addEventListener('wheel', (e) => { e.preventDefault(); setLook(lookIdx + Math.sign(e.deltaY || e.deltaX)); }, { passive: false });
  dial.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') setLook(lookIdx + 1); else if (e.key === 'ArrowLeft') setLook(lookIdx - 1); else return; e.preventDefault(); e.stopPropagation(); });

  // ---- exposure wheel ---------------------------------------------------------------------
  const evEl = $('.sh-ev');
  function setEv(v) {
    state.ev = Math.round(Math.min(2, Math.max(-2, v)) * 10) / 10;
    $('.sh-ev-val').textContent = `${state.ev > 0 ? '+' : ''}${state.ev.toFixed(1)}`;
    evEl.setAttribute('aria-valuenow', String(state.ev));
    evEl.querySelector('.sh-wheel').style.backgroundPositionY = `${state.ev * 30}px`;
    preview?.setGain(state.ev);
  }
  dragAxis(evEl, 'y', 10, (steps) => { setEv(state.ev - steps * 0.1); sounds.tick(); });
  evEl.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') setEv(state.ev + 0.1); else if (e.key === 'ArrowDown') setEv(state.ev - 0.1); else return; e.preventDefault(); e.stopPropagation(); });
  evEl.addEventListener('dblclick', () => setEv(0));

  // ---- winder, counter, flash -------------------------------------------------------------
  const winder = $('.sh-winder');
  let windTravel = 0;
  function showCount() { $('.sh-lcd-num').textContent = String(state.left).padStart(2, '0'); root.classList.toggle('sh-need-wind', !state.wound && state.left > 0); }
  function wind(steps) {
    windTravel += Math.abs(steps);
    winder.querySelector('.sh-wheel').style.backgroundPositionY = `${windTravel * 9}px`;
    sounds.tick();
    if (windTravel >= 6) {
      windTravel = 0;
      if (!state.left) { state.left = ROLL; state.wound = true; say(`New roll: ${ROLL} frames.`); }
      else state.wound = true;
      showCount();
    }
  }
  dragAxis(winder, 'y', 8, (steps) => wind(steps));
  winder.addEventListener('click', () => { if (!state.wound || !state.left) { wind(6); } });
  winder.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); wind(6); } });

  const flashBtn = $('.sh-flash');
  function toggleFlash() {
    state.flash = !state.flash;
    flashBtn.setAttribute('aria-pressed', String(state.flash));
    sounds.tick();
    if (state.flash) sounds.whine(900);
  }
  flashBtn.addEventListener('click', toggleFlash);

  $('.sh-flip').addEventListener('click', () => { state.facing = state.facing === 'user' ? 'environment' : 'user'; startStream(); });
  $('.sh-blind input').addEventListener('change', (e) => { state.blind = e.target.checked; root.classList.toggle('sh-is-blind', state.blind); });

  // ---- taking a photo -------------------------------------------------------------------------
  async function torch(on) {
    const track = stream?.getVideoTracks()[0];
    if (!track?.getCapabilities?.().torch) return false;
    await track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
    return true;
  }
  async function grab() {
    const track = stream.getVideoTracks()[0];
    // Full sensor resolution where the browser offers it (Chrome on Android).
    if ('ImageCapture' in window) {
      try {
        const ic = new window.ImageCapture(track);
        const blob = await ic.takePhoto(state.flash ? { fillLightMode: 'flash' } : {});
        if (blob?.size) return blob;
      } catch { /* fall back to a video frame */ }
    }
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    const g = c.getContext('2d');
    if (state.facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(video, 0, 0);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
  }
  async function shoot() {
    if (state.busy) return;
    if (!stream) { say('No camera yet.'); return; }
    if (!state.left) { sounds.tick(); say('The roll is full. Press Develop, or roll the winder for a new roll.'); return; }
    if (!state.wound) { sounds.tick(); say('Roll the winder first (bottom right).'); winder.classList.add('sh-nudge'); setTimeout(() => winder.classList.remove('sh-nudge'), 500); return; }
    state.busy = true;
    $('.sh-shutter').classList.add('down');
    try {
      const white = $('.sh-white');
      const front = state.facing === 'user';
      let lit = false;
      if (state.flash) {
        if (front) { white.classList.add('on'); await new Promise((r) => setTimeout(r, 180)); } else lit = await torch(true);
        if (lit) await new Promise((r) => setTimeout(r, 250));
      }
      sounds.shutter();
      const blob = await grab();
      if (lit) torch(false);
      white.classList.remove('on');
      // A short blink, like the shutter closing.
      root.classList.add('sh-blink');
      setTimeout(() => root.classList.remove('sh-blink'), 120);
      const n = state.shots.length + 1;
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
      state.shots.push(new File([blob], `FLASHNACK_${stamp}_${String(n).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
      state.left -= 1;
      state.wound = false;
      showCount();
      say(state.left ? '' : 'Last frame. Press Develop to see the roll.');
    } catch (e) {
      say(`Could not take the photo: ${e.message}`);
    } finally {
      state.busy = false;
      $('.sh-shutter').classList.remove('down');
    }
  }
  $('.sh-shutter').addEventListener('click', shoot);

  // ---- keys and closing -----------------------------------------------------------------------
  function onKey(e) {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') { if (e.target.closest?.('button, [role=button], [role=slider]') && k === 'enter') return; shoot(); }
    else if (k === 'w') wind(6);
    else if (k === 'f') toggleFlash();
    else if (k === 'escape') close();
    else if (k === 'arrowright' && e.target === document.body) setLook(lookIdx + 1);
    else if (k === 'arrowleft' && e.target === document.body) setLook(lookIdx - 1);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  window.addEventListener('keydown', onKey, true);
  $('.sh-done').addEventListener('click', () => close());

  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    stream?.getTracks().forEach((t) => t.stop());
    preview?.dispose();
    root.hidden = true;
    root.textContent = '';
    opts.onDone?.(state.shots, { lookId: looks[lookIdx].id, ev: state.ev });
  }

  showCount();
  setEv(0);
  setLook(lookIdx);
  startStream();
  $('.sh-shutter').focus();
  return close;
}

/** Drag on an element along one axis; calls onStep(+n / -n) every `px` pixels. */
function dragAxis(el, axis, px, onStep) {
  let start = null, acc = 0;
  el.addEventListener('pointerdown', (e) => { start = axis === 'x' ? e.clientX : e.clientY; acc = 0; el.setPointerCapture(e.pointerId); el.classList.add('dragging'); });
  el.addEventListener('pointermove', (e) => {
    if (start == null) return;
    const pos = axis === 'x' ? e.clientX : e.clientY;
    // Dial: drag left for the next look. Wheels: drag up.
    acc += (start - pos);
    start = pos;
    const steps = Math.trunc(acc / px);
    if (steps) { acc -= steps * px; onStep(steps); }
  });
  const end = () => { start = null; el.classList.remove('dragging'); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
