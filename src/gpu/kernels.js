// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Blur kernels, ported from LoFi Logic core/gpu.py (_gauss_kernel,
// _exp_kernel) (https://github.com/lofilogic/flashback-raw-editor).
// Modified 2026-11-09 by Lucas Van De Weerd: JavaScript port.

// Python's round(): half to even. Upstream kernel sizes depend on it.
export function pyRound(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function gaussKernel(sigma) {
  const radius = Math.max(1, pyRound(sigma * 3));
  const k = new Float32Array(2 * radius + 1);
  let s = 0;
  for (let i = -radius; i <= radius; i++) { const v = Math.fround(Math.exp(-0.5 * (i / sigma) ** 2)); k[i + radius] = v; s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}

export function expKernel(lam) {
  const radius = Math.max(1, pyRound(lam * 4));
  const k = new Float32Array(2 * radius + 1);
  let s = 0;
  for (let i = -radius; i <= radius; i++) { const v = Math.fround(Math.exp(-Math.abs(i) / lam)); k[i + radius] = v; s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}

