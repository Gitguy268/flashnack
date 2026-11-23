// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Written 2026-11-23 for Flashnack. Camera sounds made with Web Audio (no files).

let audio = null;
function ac() {
  audio ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume();
  return audio;
}
function noiseBurst(dur, gain, freq) {
  const a = ac(), n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2; g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}
export const sounds = {
  shutter() { noiseBurst(0.05, 0.9, 2600); setTimeout(() => noiseBurst(0.04, 0.6, 1800), 45); },
  tick() { noiseBurst(0.015, 0.35, 4200); },
  whine(ms = 1400) {
    const a = ac(), o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(1800, a.currentTime); o.frequency.exponentialRampToValueAtTime(9000, a.currentTime + ms / 1000);
    g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.025, a.currentTime + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + ms / 1000);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + ms / 1000 + 0.05);
  },
  pop() { noiseBurst(0.08, 0.5, 900); },
};

