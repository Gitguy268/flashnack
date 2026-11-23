// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Written 2026-11-23 for Flashnack. The film look catalog: the Flashback app
// looks, film stocks, Instagram-era filters and Flashnack's own era looks.
// catalog.json is made by scripts/build-luts.mjs.

import catalog from './catalog.json';

export const FILM_LOOKS = catalog.looks;
export const FILM_SOURCES = catalog.sources;
const byId = new Map(FILM_LOOKS.map((l) => [l.id, l]));
export const filmLook = (id) => byId.get(id);
export const filmLutUrl = (id) => `${import.meta.env.BASE_URL}luts/look/${id}.png`;

/** Bundled with the page and cached for offline use. */
export const POPULAR_LOOKS = FILM_LOOKS.filter((l) => l.popular);
export const FLASHBACK_LOOKS = FILM_LOOKS.filter((l) => l.group === 'flashback');

/** Chips under the search box. */
export const SEARCH_CHIPS = ['y2k', '2010s', '90s', '80s', '70s', '60s', 'polaroid', 'disposable', 'b&w', 'cinematic', 'warm', 'faded', 'vivid', 'portra'];

// Words people type -> the tags the catalog uses.
const SYNONYMS = {
  y2k: ['y2k', 'digicam'], '2000': ['2000s'], '2000s': ['2000s', 'y2k'], noughties: ['2000s', 'y2k'], aughts: ['2000s'],
  '1950s': ['50s'], fifties: ['50s'], '1960s': ['60s'], sixties: ['60s'], '1970s': ['70s'], seventies: ['70s'],
  '1980s': ['80s'], eighties: ['80s'], '1990s': ['90s'], nineties: ['90s'], '2010': ['2010s'], tens: ['2010s'],
  bw: ['b&w'], 'b/w': ['b&w'], monochrome: ['b&w'], grayscale: ['b&w'], greyscale: ['b&w'], noir: ['b&w'],
  dispo: ['disposable'], ccd: ['digicam', 'ccd'], digicam: ['digicam'], digital: ['digicam'],
  insta: ['instagram'], ig: ['instagram'], vsco: ['vsco', '2010s'], movie: ['cinematic'], cine: ['cinematic'], cinema: ['cinematic'],
  instax: ['instant'], polaroids: ['polaroid'], kodachrome: ['kodachrome'], ultramax: ['ultramax'],
  retro: ['retro', 'vintage', '70s', '80s'], vintage: ['vintage', '60s', '70s'], old: ['vintage', 'faded'],
};

const norm = (s) => s.toLowerCase().replace(/[’']/g, '').trim();
const haystack = (l) => norm(`${l.name} ${l.group} ${l.tags.join(' ')} ${l.id}`);

/** Search by words; every word has to match the name, group or a tag (or a synonym of one). */
export function searchLooks(query, limit = 400) {
  const words = norm(query).split(/[\s,]+/).filter(Boolean);
  if (!words.length) return FILM_LOOKS.slice(0, limit);
  const scored = [];
  for (const l of FILM_LOOKS) {
    const hay = haystack(l), tags = l.tags.map(norm);
    let score = 0, ok = true;
    for (const w of words) {
      const alts = [w, ...(SYNONYMS[w] || [])];
      const tagHit = alts.some((a) => tags.includes(a));
      const textHit = alts.some((a) => hay.includes(a));
      if (!tagHit && !textHit) { ok = false; break; }
      score += tagHit ? 3 : 1;
      if (norm(l.name).includes(w)) score += 2;
    }
    if (!ok) continue;
    if (l.popular) score += 2;
    if (l.group === 'flashback' || l.group === 'era') score += 1;
    // Variants ("+", "cold --") sort after the base film.
    if (/[+-]$|cold|warm|alt$/i.test(l.name)) score -= 1;
    scored.push([score, l]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map(([, l]) => l);
}
