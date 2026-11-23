// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Written 2026-11-23 for Flashnack. Shows the ONE35 V2 model: turn it, press
// the shutter, switch the flash on, roll the winder to advance the frame.
// Loaded on demand (import()), so three.js stays out of the main bundle.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCamera } from './model.js';
import { COLOURWAYS } from './colourways.js';
import { sounds } from './sounds.js';

export { COLOURWAYS };

const ROLL = 27;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Put the camera in a container element.
 * opts: { colourway, interactive (shutter/flash/winder work), autoRotate, zoom, onClick (non-interactive click), onStatus(text) }
 * Returns { setColourway, dispose, state }.
 */
export function mountCamera3D(container, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserve });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.75;
  scene.add(new THREE.HemisphereLight('#ffffff', '#666666', 0.6));
  const key = new THREE.DirectionalLight('#ffffff', 1.1);
  key.position.set(120, 160, 140);
  scene.add(key);
  const flashLight = new THREE.PointLight('#fff4dd', 0, 600, 1.2);
  flashLight.position.set(36, 18, 60);
  scene.add(flashLight);

  const cam = buildCamera(opts.colourway);
  scene.add(cam.group);

  const view = new THREE.PerspectiveCamera(30, 1, 1, 2000);
  view.position.set(130, 70, 230);
  const controls = new OrbitControls(view, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = opts.zoom !== false;
  controls.minDistance = 120;
  controls.maxDistance = 520;
  controls.autoRotate = !!opts.autoRotate && !reducedMotion();
  controls.autoRotateSpeed = 1.6;

  // ---- state: frames left, wound or not, flash on, flash charged ------------------------
  const state = { left: ROLL, wound: true, flash: false, charged: false, windAngle: 0 };
  const status = (t) => opts.onStatus?.(t);
  cam.showCount(state.left);
  cam.setFlashSwitch(false);

  let raf = 0, running = false, flashUntil = 0, shutterAnim = 0, chargeTimer = 0, blinkUntil = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    controls.update();
    // Shutter press, flash burst, LED.
    if (shutterAnim) {
      const k = Math.min(1, (t - shutterAnim) / 160);
      cam.parts.shutter.position.y = cam.size.H / 2 + 0.7 + 1.1 - Math.sin(k * Math.PI) * 1.3;
      if (k >= 1) shutterAnim = 0;
    }
    const glow = Math.max(0, (flashUntil - t) / 220);
    cam.setFlashGlow(glow * 6);
    flashLight.intensity = glow * 9e4;
    if (state.flash) cam.setLed(state.charged ? 2.2 : (blinkUntil > t && Math.floor(t / 160) % 2 ? 2.2 : 0.15));
    else cam.setLed(0);
    renderer.render(scene, view);
  }
  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) raf = requestAnimationFrame(frame); else cancelAnimationFrame(raf);
  }

  function resize() {
    const w = container.clientWidth || 300, h = container.clientHeight || 200;
    renderer.setSize(w, h, false);
    view.aspect = w / h;
    // Fit the camera body to narrow views.
    view.position.setLength(Math.max(200, 230 * Math.max(1, 1.5 / view.aspect)));
    view.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Only draw while it is on screen and the tab is visible.
  let onScreen = true;
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; setRunning(onScreen && !document.hidden); });
  io.observe(container);
  const onVis = () => setRunning(onScreen && !document.hidden);
  document.addEventListener('visibilitychange', onVis);
  setRunning(true);

  // ---- actions --------------------------------------------------------------------------
  function shoot() {
    shutterAnim = performance.now();
    if (!state.left) { sounds.tick(); status('The roll is full. Roll the winder to load a new one.'); return; }
    if (!state.wound) { sounds.tick(); status('Roll the winder (top right at the back) to advance the film first.'); return; }
    sounds.shutter();
    if (state.flash && state.charged) {
      flashUntil = performance.now() + 220;
      state.charged = false;
      opts.onFlash?.();
      charge();
    }
    state.left -= 1;
    state.wound = false;
    cam.showCount(state.left, false);
    status(state.left ? `${state.left} left. Roll the winder for the next frame.` : 'That was the last frame of the roll.');
    opts.onShot?.(state);
  }
  function charge() {
    clearTimeout(chargeTimer);
    blinkUntil = performance.now() + 1400;
    sounds.whine(1400);
    chargeTimer = setTimeout(() => { if (state.flash) { state.charged = true; status('Flash ready.'); } }, 1400);
  }
  function toggleFlash() {
    state.flash = !state.flash;
    cam.setFlashSwitch(state.flash);
    sounds.tick();
    if (state.flash) { state.charged = false; charge(); status('Flash on: charging…'); } else { clearTimeout(chargeTimer); state.charged = false; status('Flash off.'); }
  }
  function wind(deltaRad) {
    cam.parts.winder.rotation.y += deltaRad;
    const before = Math.floor(state.windAngle / 0.5);
    state.windAngle += Math.abs(deltaRad);
    if (Math.floor(state.windAngle / 0.5) !== before) sounds.tick();
    const needed = state.left ? Math.PI * 1.2 : Math.PI * 4;
    if (state.windAngle >= needed) {
      state.windAngle = 0;
      if (!state.left) { state.left = ROLL; state.wound = true; cam.showCount(state.left); status(`New roll loaded: ${ROLL} frames.`); }
      else if (!state.wound) { state.wound = true; status('Ready.'); }
    }
  }

  // ---- picking --------------------------------------------------------------------------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pickables = [cam.parts.shutter, cam.parts.knob, cam.parts.winder];
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, view);
    const hit = ray.intersectObjects(cam.group.children, false)[0];
    return hit && pickables.includes(hit.object) ? hit.object.userData.action : null;
  }
  const el = renderer.domElement;
  let down = null, winding = null;
  el.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    if (opts.interactive && pick(e) === 'winder') {
      winding = { x: e.clientX };
      controls.enabled = false;
      el.setPointerCapture(e.pointerId);
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (winding) { wind((e.clientX - winding.x) * 0.03); winding.x = e.clientX; return; }
    if (opts.interactive) el.style.cursor = pick(e) ? 'pointer' : 'grab';
  });
  el.addEventListener('pointerup', (e) => {
    const moved = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
    if (winding) { winding = null; controls.enabled = true; if (!moved) wind(Math.PI * 0.6); down = null; return; }
    down = null;
    if (moved) return;
    if (!opts.interactive) { opts.onClick?.(); return; }
    const a = pick(e);
    if (a === 'shutter') shoot();
    else if (a === 'flash') toggleFlash();
  });

  return {
    state,
    shoot, toggleFlash, wind,
    setColourway: (id) => cam.setColourway(id),
    renderer,
    dispose() {
      setRunning(false);
      clearTimeout(chargeTimer);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      controls.dispose();
      cam.dispose();
      envTex.dispose(); pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
