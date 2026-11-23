// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Written 2026-11-23 for Flashnack. Live viewfinder for the camera mode: draws
// the video through a film look LUT (a 64³ 3D texture) with WebGL2, every frame.
// Cheap on purpose; the full RAW pipeline runs later, in the editor.

import { tilesToTable } from '../looks/lut-format.js';

const VS = `#version 300 es
in vec2 p; out vec2 uv;
uniform vec2 scale; uniform float mirror;
void main() {
  uv = vec2((p.x * mirror) * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p * scale, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o;
uniform sampler2D video; uniform sampler3D lut;
uniform float strength; uniform float gain; uniform float lutSize;
void main() {
  vec3 c = texture(video, uv).rgb;
  c = pow(pow(c, vec3(2.2)) * gain, vec3(1.0 / 2.2));
  c = clamp(c, 0.0, 1.0);
  // Sample texel centres so 0 and 1 hit the first and last entries.
  vec3 l = texture(lut, c * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize).rgb;
  o = vec4(mix(c, l, strength), 1.0);
}`;

/** RGB8 data for texImage3D (x = red fastest, then green, then blue) from a 64³ tile PNG. */
export async function lut3dFromPng(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const { table, size: n } = tilesToTable(g.getImageData(0, 0, bmp.width, bmp.height).data, bmp.width, bmp.height);
  bmp.close();
  const out = new Uint8Array(n ** 3 * 3);
  for (let r = 0; r < n; r++) for (let gg = 0; gg < n; gg++) for (let b = 0; b < n; b++) {
    const s = ((r * n + gg) * n + b) * 3, d = (r + gg * n + b * n * n) * 3;
    out[d] = table[s] >> 8; out[d + 1] = table[s + 1] >> 8; out[d + 2] = table[s + 2] >> 8;
  }
  return { data: out, size: n };
}

export function createPreview(canvas, video) {
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error('This browser has no WebGL2 for the live viewfinder.');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(prog, n);

  const vtex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, vtex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const ltex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, ltex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  // Identity until a look is loaded.
  const id = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 0, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, 2, 2, 2, 0, gl.RGB, gl.UNSIGNED_BYTE, id);
  gl.uniform1i(u('video'), 0); gl.uniform1i(u('lut'), 1);
  let lutSize = 2, strength = 0, gain = 1, mirror = false;

  let raf = 0;
  function draw() {
    raf = requestAnimationFrame(draw);
    if (video.readyState < 2) return;
    const w = canvas.clientWidth * Math.min(2, devicePixelRatio || 1), h = canvas.clientHeight * Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(w) || canvas.height !== Math.round(h)) { canvas.width = Math.round(w); canvas.height = Math.round(h); }
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Cover the viewfinder, like a crop.
    const va = video.videoWidth / video.videoHeight, ca = canvas.width / canvas.height;
    gl.uniform2f(u('scale'), va > ca ? va / ca : 1, va > ca ? 1 : ca / va);
    gl.uniform1f(u('mirror'), mirror ? -1 : 1);
    gl.uniform1f(u('strength'), strength); gl.uniform1f(u('gain'), gain); gl.uniform1f(u('lutSize'), lutSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, vtex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  raf = requestAnimationFrame(draw);

  return {
    setLut(lut, s = 1) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, ltex);
      if (lut) { gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, lut.size, lut.size, lut.size, 0, gl.RGB, gl.UNSIGNED_BYTE, lut.data); lutSize = lut.size; strength = s; } else strength = 0;
    },
    setGain(ev) { gain = 2 ** ev; },
    setMirror(m) { mirror = m; },
    dispose() { cancelAnimationFrame(raf); gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
