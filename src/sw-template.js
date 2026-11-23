// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Written 2026-11-23 for Flashnack. The service worker that keeps Flashnack
// working offline once the page has loaded: the app, the grain, the original
// looks, the popular film looks and the samples are cached on install. Other
// film looks are cached the first time they are used.
// vite.config.js fills in CACHE and PRECACHE at build time and writes dist/sw.js.

const CACHE = '__CACHE__';
const PRECACHE = __PRECACHE__;
const LOOKS_CACHE = 'flashnack-looks-v1';

async function precache() {
  const c = await caches.open(CACHE);
  // One by one, so a single failure doesn't throw the rest away.
  await Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch((err) => console.warn('[flashnack sw]', u, err))));
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('flashnack-') && k !== CACHE && k !== LOOKS_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // The page itself: network first, so a new version shows up; the cache when offline.
  if (req.mode === 'navigate') {
    // Apps on the same origin (several share github.io) may clear every cache
    // but their own; if that happened, fill ours again while online.
    const refill = caches.has(CACHE).then((ok) => (ok ? null : precache())).catch(() => {});
    e.waitUntil(refill);
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put('./', res.clone());
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true, ignoreVary: true })) || (await caches.match('./', { ignoreVary: true })) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
    if (hit) return hit;
    const res = await fetch(req);
    // Film looks that are not bundled: keep them once used.
    if (res.ok && /\/luts\/look\/[^/]+\.png$/.test(url.pathname)) (await caches.open(LOOKS_CACHE)).put(req, res.clone());
    return res;
  })());
});
