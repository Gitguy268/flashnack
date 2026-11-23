import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { buildTable, tableToTiles, tilesToTable, haldToTable, identityHald, resampleTable, tileCubeSize } from '../../src/looks/lut-format.js';
import { searchLooks, FILM_LOOKS, POPULAR_LOOKS, FLASHBACK_LOOKS } from '../../src/looks/catalog.js';

const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m / 257; };

describe('LUT formats', () => {
  it('round-trips an identity table through a tile image', () => {
    const id = buildTable(64);
    const t = tableToTiles(id, 64);
    expect([t.w, t.h]).toEqual([512, 512]);
    expect(maxDiff(tilesToTable(t.rgba, t.w, t.h).table, id)).toBeLessThanOrEqual(0.5);
  });
  it('lays tiles out with x = red, y = green, tile number = blue', () => {
    const t = tableToTiles(buildTable(64), 64);
    const px = (x, y) => [...t.rgba.slice((y * 512 + x) * 4, (y * 512 + x) * 4 + 3)];
    expect(px(63, 0)).toEqual([255, 0, 0]);            // tile 0, right edge: red
    expect(px(0, 63)).toEqual([0, 255, 0]);            // tile 0, bottom edge: green
    expect(px(7 * 64, 7 * 64)).toEqual([0, 0, 255]);   // tile 63, top left: blue
  });
  it('reads an identity HaldCLUT as an identity table', () => {
    const h = identityHald(8);
    const { table, size } = haldToTable(h.rgba, h.w, h.h);
    expect(size).toBe(64);
    expect(maxDiff(table, buildTable(64))).toBeLessThanOrEqual(0.5);
  });
  it('keeps identity when resampling 144³ to 64³', () => {
    expect(maxDiff(resampleTable(buildTable(144), 144, 64), buildTable(64))).toBeLessThanOrEqual(0.5);
  });
  it('knows tile image sizes', () => {
    expect(tileCubeSize(512, 512)).toBe(64);
    expect(tileCubeSize(1728, 1728)).toBe(144);
    expect(tileCubeSize(500, 500)).toBe(0);
  });
});

describe('film look catalog', () => {
  it('has a LUT file for every look, all 64³', () => {
    for (const l of FILM_LOOKS) {
      const f = `public/luts/look/${l.id}.png`;
      expect(existsSync(f), f).toBe(true);
    }
    const p = PNG.sync.read(readFileSync('public/luts/look/fb-gold.png'));
    expect([p.width, p.height]).toEqual([512, 512]);
  });
  it('bundles the six Flashback app looks as popular', () => {
    expect(FLASHBACK_LOOKS.map((l) => l.id).sort()).toEqual(['fb-beta', 'fb-cine', 'fb-classic', 'fb-dispo', 'fb-gold', 'fb-retro-haze']);
    expect(FLASHBACK_LOOKS.every((l) => l.popular)).toBe(true);
    expect(POPULAR_LOOKS.length).toBeLessThan(30);
  });
  it('finds looks by era words and synonyms', () => {
    const names = (q) => searchLooks(q).map((l) => l.id);
    expect(names('y2k')).toContain('own-y2k-digicam');
    expect(names('y2k').length).toBeLessThan(40);
    expect(names('eighties')).toContain('own-80s-mall-flash');
    expect(names('1990s')).toContain('own-90s-drugstore');
    expect(names('2010s')).toContain('ig-valencia');
    expect(names('polaroid')).toContain('rt-polaroid-px-680');
    expect(names('portra 400')[0]).toMatch(/portra-400/);
    expect(names('b&w').every((id) => FILM_LOOKS.find((l) => l.id === id).tags.includes('b&w'))).toBe(true);
    expect(names('zzzz')).toEqual([]);
  });
});
