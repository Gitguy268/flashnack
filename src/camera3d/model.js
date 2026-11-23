// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Written 2026-11-23 for Flashnack. A procedural model of the Flashback ONE35 V2
// (a small 35 mm-style digital camera), built from published sizes (about
// 106 × 53 × 30 mm) and review photos. Units are millimetres; x runs along the
// width (grip at -x), y is up, z points out of the front.
// The Flashback wordmark and sticker are left off on purpose.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COLOURWAYS } from './colourways.js';

export { COLOURWAYS };


const W = 106, H = 53, D = 26, GRIP_D = 30;
const TOP = H / 2, FRONT = D / 2;
// The diagonal band: x of its left edge at the top and at the bottom, and its width.
const BAND_TOP_X = -22, BAND_BOTTOM_X = -11, BAND_W = 18, BAND_T = 0.7;

// ---- textures drawn on canvases ----------------------------------------------------
function canvasTexture(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 4;
  return t;
}

/** Pebble-grain leatherette as a normal map. */
function pebbleNormal() {
  return canvasTexture(256, 256, (g, w, h) => {
    // Height field of random bumps, then turned into normals.
    const hf = new Float32Array(w * h);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 900; k++) {
      const cx = rnd() * w, cy = rnd() * h, r = 3 + rnd() * 6;
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y) / r;
        if (d >= 1) continue;
        const px = (Math.round(cx + x) + w) % w, py = (Math.round(cy + y) + h) % h;
        hf[py * w + px] = Math.max(hf[py * w + px], Math.sqrt(1 - d * d));
      }
    }
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const at = (xx, yy) => hf[((yy + h) % h) * w + ((xx + w) % w)];
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2, dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize(), i = (y * w + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false, repeat: [2.5, 3] });
}

/** Vertical ribs, for the flash diffuser and switch knob. */
const ribs = (count, light, dark) => canvasTexture(256, 64, (g, w, h) => {
  g.fillStyle = light; g.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const x = (i + 0.5) * (w / count);
    const grd = g.createLinearGradient(x - w / count / 2, 0, x + w / count / 2, 0);
    grd.addColorStop(0, light); grd.addColorStop(0.5, dark); grd.addColorStop(1, light);
    g.fillStyle = grd; g.fillRect(x - w / count / 2, 0, w / count, h);
  }
});

/** Knurled edge of the winder. */
const knurl = () => canvasTexture(512, 32, (g, w, h) => {
  g.fillStyle = '#c9c9c6'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 64; i++) { g.fillStyle = i % 2 ? '#8d8d8a' : '#e6e6e3'; g.fillRect(i * 8, 0, 4, h); }
});

/** The LCD frame counter; returns a texture and a function to show a number. */
function lcd() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 80;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const show = (text, dim = false) => {
    g.fillStyle = '#aab5a2'; g.fillRect(0, 0, 128, 80);
    g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 0, 128, 10);
    g.font = '700 58px ui-monospace, Menlo, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(40,48,38,0.12)'; g.fillText('88', 64, 44);
    g.fillStyle = dim ? 'rgba(30,36,28,0.35)' : '#1e241c'; g.fillText(text, 64, 44);
    tex.needsUpdate = true;
  };
  return { tex, show };
}

/** A soft round shadow for the ground. */
const shadowTex = () => canvasTexture(256, 256, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.42)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.16)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});

// ---- shapes ------------------------------------------------------------------------
/** A parallelogram strip in the xy plane (the band on the front or back), extruded by t. */
function bandFaceGeometry(t) {
  const s = new THREE.Shape();
  const y0 = -TOP + 2.6, y1 = TOP - 2.6;
  const xAt = (y) => BAND_TOP_X + (BAND_BOTTOM_X - BAND_TOP_X) * ((TOP - y) / H);
  s.moveTo(xAt(y0), y0); s.lineTo(xAt(y0) + BAND_W, y0); s.lineTo(xAt(y1) + BAND_W, y1); s.lineTo(xAt(y1), y1); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
}

/** Quarter tube that carries the band round a rounded body edge. */
function bandCorner(r, len, start) {
  const g = new THREE.CylinderGeometry(r, r, len, 10, 1, true, start, Math.PI / 2);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Front outline of the grip: a slanted block whose right edge follows the band. */
function gripGeometry() {
  const s = new THREE.Shape();
  const l = -W / 2, gap = 2.2;
  const rTop = BAND_TOP_X - gap, rBottom = BAND_BOTTOM_X - gap;
  const R = 9, r = 2.5;
  s.moveTo(l + r, -TOP);
  s.lineTo(rBottom - r, -TOP);
  s.quadraticCurveTo(rBottom, -TOP, rBottom - 0.2, -TOP + r);
  s.lineTo(rTop, TOP - r);
  s.quadraticCurveTo(rTop - 0.2, TOP, rTop - r, TOP);
  s.lineTo(l + R, TOP);
  s.quadraticCurveTo(l, TOP, l, TOP - R);
  s.lineTo(l, -TOP + r);
  s.quadraticCurveTo(l, -TOP, l + r, -TOP);
  const bevel = 2.4;
  const g = new THREE.ExtrudeGeometry(s, { depth: GRIP_D - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 4, curveSegments: 10 });
  g.translate(0, 0, -(GRIP_D - bevel * 2) / 2);
  return g;
}

/** Leatherette panel on the grip's front or back. */
function leatherGeometry() {
  const s = new THREE.Shape();
  const l = -W / 2 + 2.2, gap = 4.2;
  const rTop = BAND_TOP_X - gap + 1.6, rBottom = BAND_BOTTOM_X - gap;
  const yTop = TOP - 10, yBottom = -TOP + 2.2;
  const xAt = (y) => rTop + (rBottom - rTop) * ((yTop - y) / (yTop - yBottom));
  s.moveTo(l + 2, yBottom);
  s.lineTo(xAt(yBottom), yBottom);
  s.lineTo(xAt(yTop), yTop);
  s.lineTo(l + 6, yTop);
  s.quadraticCurveTo(l, yTop, l, yTop - 6);
  s.lineTo(l, yBottom + 2);
  s.quadraticCurveTo(l, yBottom, l + 2, yBottom);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.4, bevelSegments: 2 });
  // Map UVs from position so the grain has the same scale everywhere.
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 22, pos.getY(i) / 22);
  return g;
}

function lathe(points, segments = 48) {
  const g = new THREE.LatheGeometry(points.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  g.rotateX(Math.PI / 2); // lathe axis y -> z
  return g;
}

// ---- the camera --------------------------------------------------------------------
/**
 * Build the camera. Returns { group, parts, setColourway(id), showCount(n), setFlash(on), fire(), dispose() }.
 * parts.* carry userData.action ('shutter' | 'flash' | 'winder') for picking.
 */
export function buildCamera(colourwayId = COLOURWAYS[0].id) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (x) => { disposables.push(x); return x; };

  const mat = {
    body: track(new THREE.MeshPhysicalMaterial({ roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.6 })),
    grip: track(new THREE.MeshPhysicalMaterial({ roughness: 0.6 })),
    leather: track(new THREE.MeshStandardMaterial({ roughness: 0.85, normalMap: track(pebbleNormal()), normalScale: new THREE.Vector2(1.1, 1.1) })),
    band: track(new THREE.MeshPhysicalMaterial({ roughness: 0.55, clearcoat: 0.08 })),
    ring: track(new THREE.MeshPhysicalMaterial({ roughness: 0.5, clearcoat: 0.2 })),
    black: track(new THREE.MeshStandardMaterial({ color: '#121213', roughness: 0.6 })),
    recess: track(new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.9 })),
    glass: track(new THREE.MeshPhysicalMaterial({ color: '#0d1a24', roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, reflectivity: 0.9 })),
    vfGlass: track(new THREE.MeshPhysicalMaterial({ color: '#29475c', roughness: 0.06, clearcoat: 1, transparent: true, opacity: 0.92 })),
    grey: track(new THREE.MeshStandardMaterial({ color: '#d2d2cd', roughness: 0.55 })),
    knob: track(new THREE.MeshStandardMaterial({ map: track(ribs(9, '#dcdcd7', '#9e9e99')), roughness: 0.6 })),
    flash: track(new THREE.MeshStandardMaterial({ map: track(ribs(14, '#f4f4f1', '#c9c9c4')), roughness: 0.35, emissive: '#fff6e0', emissiveIntensity: 0 })),
    flashFrame: track(new THREE.MeshStandardMaterial({ color: '#d9d9d4', roughness: 0.4, metalness: 0.2 })),
    knurl: track(new THREE.MeshStandardMaterial({ map: track(knurl()), roughness: 0.5, metalness: 0.15 })),
    led: track(new THREE.MeshStandardMaterial({ color: '#3a0a0a', emissive: '#ff2a1a', emissiveIntensity: 0 })),
  };
  const counter = lcd();
  track(counter.tex);
  mat.lcd = track(new THREE.MeshBasicMaterial({ map: counter.tex }));
  const mesh = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(track(geo), m); o.position.set(x, y, z); group.add(o); return o; };

  // Body and grip.
  mesh(new RoundedBoxGeometry(W, H, D, 4, 3), mat.body);
  mesh(gripGeometry(), mat.grip);
  const leatherF = mesh(leatherGeometry(), mat.leather, 0, 0, GRIP_D / 2 - 0.35);
  const leatherB = mesh(leatherGeometry(), mat.leather, 0, 0, -GRIP_D / 2 + 0.35);
  leatherB.scale.z = -1;
  // Leatherette round the grip end.
  const endPanel = mesh(new RoundedBoxGeometry(1, H - 14, GRIP_D - 8, 2, 0.4), mat.leather, -W / 2 - 0.15, -5, 0);
  endPanel.material = mat.leather;

  // Band: front, back, top, bottom, and the corners between them.
  mesh(bandFaceGeometry(BAND_T), mat.band, 0, 0, FRONT - 0.05);
  const back = mesh(bandFaceGeometry(BAND_T), mat.band, 0, 0, -FRONT + 0.05);
  back.scale.z = -1;
  const topBand = mesh(new THREE.BoxGeometry(BAND_W, BAND_T, D - 5.2), mat.band, BAND_TOP_X + BAND_W / 2, TOP + BAND_T / 2 - 0.05, 0);
  topBand.userData.band = true;
  mesh(new THREE.BoxGeometry(BAND_W, BAND_T, D - 5.2), mat.band, BAND_BOTTOM_X + BAND_W / 2, -TOP - BAND_T / 2 + 0.05, 0);
  const cr = 3 + BAND_T - 0.05;
  for (const [x, y, z, start] of [
    [BAND_TOP_X + BAND_W / 2, TOP - 3, FRONT - 3, 0], [BAND_TOP_X + BAND_W / 2, TOP - 3, -FRONT + 3, Math.PI * 1.5],
    [BAND_BOTTOM_X + BAND_W / 2, -TOP + 3, FRONT - 3, Math.PI / 2], [BAND_BOTTOM_X + BAND_W / 2, -TOP + 3, -FRONT + 3, Math.PI],
  ]) mesh(bandCorner(cr, BAND_W, start), mat.band, x, y, z);

  // Lens: ring (body colour) on the band, black cone, glass.
  const lensX = -5, lensZ = FRONT + BAND_T - 0.1;
  mesh(lathe([[0, 0], [11, 0], [11.2, 1.8], [10.6, 3.0], [8, 3.2], [7.4, 3.0]]), mat.ring, lensX, 0, lensZ);
  mesh(lathe([[7.4, 3.0], [6.6, 2.4], [5.2, 1.8], [4.6, 1.6]]), mat.black, lensX, 0, lensZ);
  const glass = mesh(new THREE.SphereGeometry(6, 32, 16, 0, Math.PI * 2, 0, 0.75), mat.glass, lensX, 0, lensZ + 1.6 - 6 * Math.cos(0.75) + 0.1);
  glass.rotation.x = Math.PI / 2;

  // Viewfinder window and flash, front top right.
  mesh(new RoundedBoxGeometry(19, 10, 1.6, 2, 0.8), mat.recess, 10, 16.5, FRONT);
  mesh(new THREE.PlaneGeometry(15, 6.6), mat.vfGlass, 10, 16.5, FRONT + 0.81);
  mesh(new RoundedBoxGeometry(18.4, 8.4, 1.4, 2, 0.6), mat.flashFrame, 36, 18.5, FRONT);
  const flashLens = mesh(new THREE.PlaneGeometry(16.4, 6.4), mat.flash, 36, 18.5, FRONT + 0.72);

  // Flash switch: a slot with a ribbed knob that slides right to switch on.
  mesh(new RoundedBoxGeometry(21, 8, 1.2, 2, 1.5), mat.recess, 34.5, 3.5, FRONT - 0.2);
  const knob = mesh(new RoundedBoxGeometry(10, 6.2, 2.2, 2, 1.2), mat.knob, 34.5 - 4.5, 3.5, FRONT + 0.6);
  knob.userData.action = 'flash';

  // Top: shutter on the band, LCD counter beside it.
  const shutter = mesh(new RoundedBoxGeometry(8.4, 3.2, 8.4, 2, 1), mat.grey, BAND_TOP_X + BAND_W / 2 + 1, TOP + BAND_T + 1.1, 1);
  shutter.userData.action = 'shutter';
  mesh(new RoundedBoxGeometry(11, 1, 7.6, 2, 0.4), mat.recess, 6, TOP + 0.3, 1);
  const lcdPlane = mesh(new THREE.PlaneGeometry(9, 5.6), mat.lcd, 6, TOP + 0.82, 1);
  lcdPlane.rotation.x = -Math.PI / 2;
  lcdPlane.rotation.z = Math.PI; // reads the right way up from behind, where the photographer is

  // Winder: knurled wheel at the back top corner of the grip end.
  const winder = mesh(new THREE.CylinderGeometry(7, 7, 5, 64, 1), [mat.knurl, mat.grey, mat.grey], -44, TOP - 3.3, -GRIP_D / 2 + 4.2);
  winder.userData.action = 'winder';
  mesh(new THREE.CylinderGeometry(3, 3, 5.4, 24), mat.grey, -44, TOP - 3.3, -GRIP_D / 2 + 4.2);

  // Back: eyepiece in a raised frame, flash-ready LED.
  mesh(new RoundedBoxGeometry(14, 12, 2.4, 2, 1.2), mat.body, 10, 14.5, -FRONT - 0.6);
  mesh(new RoundedBoxGeometry(9.5, 7.5, 1, 2, 0.6), mat.recess, 10, 14.5, -FRONT - 1.6);
  mesh(new THREE.PlaneGeometry(7.2, 5.2), mat.vfGlass, 10, 14.5, -FRONT - 2.11).rotation.y = Math.PI;
  const led = mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.6, 16), mat.led, 23, 15.5, -FRONT - 0.1);
  led.rotation.x = Math.PI / 2;

  // Strap slot on the grip end, USB-C on the other end.
  mesh(new RoundedBoxGeometry(1.2, 7, 2.4, 2, 0.5), mat.recess, -W / 2 - 0.55, 12, -6);
  mesh(new RoundedBoxGeometry(1.2, 3.4, 9, 2, 1.4), mat.recess, W / 2 + 0.05, -14, 0);

  // Crystal bodies show the inside: battery, board, flash capacitor, wires.
  const inside = new THREE.Group();
  const im = (c, r = 0.5, m = 0) => track(new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }));
  const part = (geo, m, x, y, z, rx = 0, rz = 0) => { const o = new THREE.Mesh(track(geo), m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); inside.add(o); return o; };
  part(new THREE.CylinderGeometry(8, 8, 34, 32), im('#2d5fd0', 0.35), -34, -8, 0, 0, Math.PI / 2);
  part(new THREE.CylinderGeometry(4.5, 4.5, 20, 24), im('#1a1a1a', 0.4), 28, -12, -2, 0, Math.PI / 2);
  part(new THREE.BoxGeometry(70, 30, 1.2), im('#1f6b3a', 0.6), 12, 2, -9);
  part(new THREE.BoxGeometry(12, 12, 3), im('#262626', 0.5, 0.3), -5, 0, 5);
  const wire = (pts, c) => part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 40, 0.7, 8), im(c, 0.4), 0, 0, 0);
  wire([[-20, -14, 4], [-5, -18, 6], [10, -10, 7], [24, -4, 4]], '#d63a2a');
  wire([[-20, -12, 5], [-2, -15, 8], [14, -7, 8], [30, 6, 5]], '#f0b72a');
  wire([[-18, -16, 3], [0, -20, 5], [18, -14, 6], [32, 2, 3]], '#2e9b4f');
  group.add(inside);

  // Ground shadow.
  const shadow = new THREE.Mesh(track(new THREE.PlaneGeometry(170, 110)), track(new THREE.MeshBasicMaterial({ map: track(shadowTex()), transparent: true, depthWrite: false })));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -TOP - 1.2;
  group.add(shadow);

  function setColourway(id) {
    const cw = COLOURWAYS.find((c) => c.id === id) || COLOURWAYS[0];
    for (const m of [mat.body, mat.grip, mat.ring]) {
      m.color.set(cw.body);
      m.transmission = cw.crystal ? 0.92 : 0;
      m.thickness = cw.crystal ? 3 : 0;
      m.roughness = cw.crystal ? 0.12 : 0.55;
      m.ior = 1.5;
      m.transparent = false;
      m.needsUpdate = true;
    }
    mat.leather.color.set(cw.crystal ? '#e9eef2' : cw.body);
    mat.leather.transparent = !!cw.crystal;
    mat.leather.opacity = cw.crystal ? 0.55 : 1;
    mat.leather.needsUpdate = true;
    mat.band.color.set(cw.band);
    inside.visible = !!cw.crystal;
    return cw;
  }
  setColourway(colourwayId);

  return {
    group,
    parts: { shutter, knob, winder, flashLens, led, lcdPlane },
    setColourway,
    showCount: (n, dim) => counter.show(String(n).padStart(2, '0'), dim),
    setFlashSwitch(on) { knob.position.x = 34.5 + (on ? 4.5 : -4.5); },
    setLed(v) { mat.led.emissiveIntensity = v; },
    setFlashGlow(v) { mat.flash.emissiveIntensity = v; },
    dispose() { for (const d of disposables) d.dispose?.(); },
    size: { W, H, D: GRIP_D },
  };
}
