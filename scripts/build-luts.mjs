// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Written 2026-11-23 for Flashnack.
//
// Builds the film look LUTs in public/luts/look/ (64³ tile PNGs) and the
// catalog the app searches (src/looks/catalog.json).
//
// Sources, cloned or copied into the git-ignored .lut-src/ folder:
//   flashback/      the six Flashback app LUTs (*.lut.png, already 64³ tiles)
//   t3mujinpack/    https://github.com/t3mujin/t3mujinpack (MIT), HaldCLUT level 12
//   clut/           https://github.com/NatronGitHub/clut (CC BY-SA 4.0), Pat David's
//                   film emulation HaldCLUTs, level 8; only Pat David's folders are used
//   cssgram-out/    made by scripts/render-cssgram.mjs from https://github.com/una/CSSgram (MIT)
// plus Flashnack's own looks in scripts/era-looks.mjs.
//
// Usage: node scripts/build-luts.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { PNG } from 'pngjs';
import { haldToTable, tilesToTable, tableToTiles, resampleTable, buildTable, LOOK_LUT_SIZE } from '../src/looks/lut-format.js';
import { ERA_LOOKS } from './era-looks.mjs';

const SRC = '.lut-src';
const OUT = 'public/luts/look';
const N = LOOK_LUT_SIZE;

// Bundled with the page and kept for offline use.
const POPULAR = new Set([
  'fb-gold', 'fb-classic', 'fb-dispo', 'fb-beta', 'fb-cine', 'fb-retro-haze',
  't3-kodak-portra-400', 't3-kodak-gold-200', 't3-kodak-ultra-max-400', 't3-fuji-superia-400',
  't3-kodak-ektar-100', 't3-fuji-velvia-50', 't3-kodak-kodachrome-64', 't3-kodak-tri-x-400',
  't3-ilford-hp5-plus-400', 'rt-polaroid-px-680', 'rt-polaroid-669', 'ig-valencia',
  'own-y2k-digicam', 'own-80s-mall-flash', 'own-90s-drugstore', 'own-disposable-400',
]);

const SOURCES = {
  flashback: { name: 'Flashback app', licence: 'Flashback\'s own looks, not GPL', url: 'https://joinflashback.co' },
  t3mujin: { name: 't3mujinpack by João Almeida', licence: 'MIT', url: 'https://github.com/t3mujin/t3mujinpack' },
  rt: { name: 'RawTherapee film simulation by Pat David', licence: 'CC BY-SA 4.0', url: 'https://github.com/NatronGitHub/clut' },
  cssgram: { name: 'CSSgram by Una Kravets', licence: 'MIT', url: 'https://github.com/una/CSSgram' },
  own: { name: 'Flashnack', licence: 'GPL-3.0', url: 'https://github.com/Gitguy268/flashnack' },
};

// '+' and '-' variants ("px-680_++", "_--") stay distinct: + -> p, a lone run of - -> m.
const slug = (s) => s.toLowerCase().replace(/kodakchrome/g, 'kodachrome').replace(/(^|_)(-+)(?=_|$)/g, (m, a, d) => a + 'm'.repeat(d.length)).replace(/\+/g, 'p').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---- names and tags ---------------------------------------------------------------
const WORD_CASE = { px: 'PX', fp: 'FP', hp5: 'HP5', xp2: 'XP2', hc: 'HC', nc: 'NC', vc: 'VC', uc: 'UC', hg: 'HG', bw: 'BW', cn: 'CN', ir: 'IR', hie: 'HIE', hs: 'HS', 'x-pro': 'X-Pro', 'e-100': 'E-100', gx: 'GX', vs: 'VS', 'x-tra': 'X-Tra', 'tri-x': 'Tri-X', 't-max': 'T-Max', tmax: 'T-Max', apx: 'APX', fp4: 'FP4', hps: 'HPS', sp: 'SP', '100f': '100F', '400f': '400F', '400x': '400X', '160c': '160C', '400h': '400H', '800z': '800Z', 'px-680': 'PX-680', 'px-70': 'PX-70', 'px-100uv': 'PX-100UV', 'fp-100c': 'FP-100C', 'fp-3000b': 'FP-3000B', 'fp-100c_': 'FP-100C' };
function prettyName(raw) {
  return raw.replace(/kodakchrome/gi, 'Kodachrome').split(/[_\s]+/).filter(Boolean).map((w) => {
    const lw = w.toLowerCase();
    if (WORD_CASE[lw]) return WORD_CASE[lw];
    if (/^px-100uv\+$/.test(lw)) return 'PX-100UV+';
    if (/^[+-]+$/.test(w)) return w;
    if (w === '(expired)') return '(expired)';
    if (w === '(hs' || w === 'infra)') return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ').replace('(HS INFRA)', '(infrared)');
}

const RULES = [
  [/polaroid|instant|fp-100c|fp-3000b|time zero|px-/i, ['polaroid', 'instant', '70s', '80s']],
  [/expired/i, ['expired', 'faded']],
  [/kodachrome/i, ['kodachrome', 'slide', '50s', '60s', '70s', 'vintage', 'warm']],
  [/ektachrome|elite chrome|elite extracolor/i, ['slide', '70s', '80s', 'vivid']],
  [/velvia|fortia/i, ['slide', 'vivid', 'saturated', '90s', 'landscape']],
  [/provia|astia|sensia|precisa/i, ['slide', '90s', '2000s']],
  [/portra/i, ['portra', 'portrait', 'soft', 'warm', '2000s', '2010s']],
  [/\bgold\b|colorplus/i, ['gold', 'consumer', 'warm', '80s', '90s', 'disposable']],
  [/ultra ?max/i, ['ultramax', 'consumer', 'disposable', '90s', '2000s', 'y2k']],
  [/x-tra/i, ['y2k']],
  [/superia|reala|x-tra/i, ['superia', 'consumer', '90s', '2000s', 'disposable', 'green shadows']],
  [/vista|ultra color|elite color|elite 100/i, ['consumer', '80s', '90s']],
  [/160c|400h|800z|pro 1|pro 4|pro 8/i, ['portrait', 'wedding', 'pastel', 'cool', '2000s', '2010s']],
  [/ektar/i, ['ektar', 'vivid', 'saturated', 'landscape', '2010s']],
  [/redscale/i, ['lomo', 'redscale', 'experimental', 'red']],
  [/x-pro|xpro/i, ['lomo', 'cross process', 'experimental', '90s']],
  [/tri-x|hp5|delta|t-max|tmax|neopan|acros|apx|fp4|pan f|xp2|bw 400|ortho|retro|hie|ir 400|hps|664|667|672|fp-3000b/i, ['b&w', 'black and white', 'mono']],
  [/tri-x|hp5/i, ['60s', '70s', 'street', 'classic', 'grainy']],
  [/infra|ir 400|hie/i, ['infrared']],
  [/1600|3200|800/i, ['grainy', 'night', 'high iso']],
  [/cold|cool/i, ['cool']],
  [/warm/i, ['warm']],
];
function tagsFor(name, extra = []) {
  const t = new Set(extra);
  for (const [re, tags] of RULES) if (re.test(name)) tags.forEach((x) => t.add(x));
  if (/kodak/i.test(name)) t.add('kodak');
  if (/fuji/i.test(name)) t.add('fuji');
  if (/ilford/i.test(name)) t.add('ilford');
  if (/agfa/i.test(name)) t.add('agfa');
  if (/rollei/i.test(name)) t.add('rollei');
  if (/lomography/i.test(name)) t.add('lomography');
  t.add('film');
  // Strength and tint variants ("PX-680 cold ++") keep their film tags but not
  // the decade ones, so a search for "80s" lists each film once.
  if (/(\s[+-]+|\scold|\swarm|\salt|\snegative|\shc|\searly)(\s|$)/i.test(name)) for (const e of ['50s', '60s', '70s', '80s', '90s', '2000s', '2010s', 'y2k']) t.delete(e);
  return [...t];
}
const fxFor = (tags) => (tags.includes('b&w') ? 'monochrome' : tags.includes('disposable') || tags.includes('flash') ? 'disposable' : tags.includes('consumer') || tags.includes('polaroid') || tags.includes('y2k') ? 'point_shoot' : 'rangefinder');

// ---- io -----------------------------------------------------------------------------
const list = (d) => readdirSync(d).filter((f) => !f.startsWith('.'));
const readPng = (f) => PNG.sync.read(readFileSync(f));
function writeTiles(id, table) {
  const t = tableToTiles(table, N);
  const p = new PNG({ width: t.w, height: t.h, colorType: 2 });
  p.data = Buffer.from(t.rgba.buffer);
  writeFileSync(join(OUT, `${id}.png`), PNG.sync.write(p, { colorType: 2, deflateLevel: 9 }));
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const entries = [];
const add = (e) => {
  if (entries.some((x) => x.id === e.id)) throw new Error(`duplicate id ${e.id}`);
  e.popular = POPULAR.has(e.id);
  e.fx ||= fxFor(e.tags);
  entries.push(e);
};

// Flashback app: copied as-is after checking the size.
const FB = {
  flashbackgold: ['fb-gold', 'Flashback Gold', ['warm', 'gold', '90s', 'consumer']],
  flashbackclassic: ['fb-classic', 'Flashback Classic', ['classic', 'vintage', 'warm']],
  flashbackdispo: ['fb-dispo', 'Flashback Dispo', ['disposable', 'flash', '90s', '2000s', 'y2k', 'green shadows']],
  flashbackbeta: ['fb-beta', 'Flashback Beta', ['experimental', 'vivid', 'green']],
  flashbackcine: ['fb-cine', 'Flashback Cine', ['cinematic', 'teal', 'faded', 'movie']],
  retrohaze: ['fb-retro-haze', 'Flashback Retro Haze', ['retro', 'haze', 'faded', 'warm', '80s', '70s']],
};
for (const f of list(join(SRC, 'flashback')).filter((x) => x.endsWith('.lut.png')).sort()) {
  const key = f.replace('.lut.png', '');
  const [id, name, tags] = FB[key] || [`fb-${slug(key)}`, prettyName(key), []];
  const p = readPng(join(SRC, 'flashback', f));
  tilesToTable(p.data, p.width, p.height); // throws if it is not a tile image
  copyFileSync(join(SRC, 'flashback', f), join(OUT, `${id}.png`));
  add({ id, name, group: 'flashback', source: 'flashback', tags: ['flashback', 'one35', ...tags], fx: id === 'fb-dispo' ? 'disposable' : 'point_shoot' });
}

// t3mujinpack: "t3mujinpack - Color Negative - Kodak Gold 200.png", level 12 -> 64³.
for (const f of list(join(SRC, 't3mujinpack/haldcluts')).filter((x) => x.endsWith('.png')).sort()) {
  const [, kind, film] = basename(f, '.png').split(' - ');
  const name = film.replace(/Kodakchrome/g, 'Kodachrome');
  const p = readPng(join(SRC, 't3mujinpack/haldcluts', f));
  const { table, size } = haldToTable(p.data, p.width, p.height);
  writeTiles(`t3-${slug(name)}`, resampleTable(table, size, N));
  add({ id: `t3-${slug(name)}`, name, group: kind.toLowerCase(), source: 't3mujin', tags: tagsFor(name, [kind.toLowerCase()]) });
}

// Pat David's HaldCLUTs (level 8 = 64³). The other folders have other authors and no licence.
const RT_DIRS = { bw: 'black and white', colorslide: 'color slide', instant_consumer: 'instant', instant_pro: 'instant', negative_color: 'color negative', negative_new: 'color negative', negative_old: 'color negative' };
for (const [dir, kind] of Object.entries(RT_DIRS)) {
  for (const f of list(join(SRC, 'clut', dir)).filter((x) => x.endsWith('.png')).sort()) {
    const raw = basename(f, '.png').replace(/^generic_/, 'generic ');
    const name = prettyName(raw);
    let id = `rt-${slug(raw)}`;
    if (entries.some((e) => e.id === id)) id = `${id}-${dir.split('_')[0]}`;
    const p = readPng(join(SRC, 'clut', dir, f));
    const { table, size } = haldToTable(p.data, p.width, p.height);
    writeTiles(id, resampleTable(table, size, N));
    add({ id, name, group: kind, source: 'rt', tags: tagsFor(name, [kind, ...(dir === 'bw' ? ['b&w'] : [])]) });
  }
}

// CSSgram renders.
const IG_NAMES = { '1977': '1977', lofi: 'Lo-Fi', xpro2: 'X-Pro II' };
const IG_TAGS = { '1977': ['70s', 'retro', 'pink'], inkwell: ['b&w', 'mono'], moon: ['b&w', 'mono'], willow: ['muted', 'faded'], valencia: ['warm', 'faded'], nashville: ['warm', 'pink', 'faded'], xpro2: ['vivid', 'cross process'], lofi: ['vivid', 'contrast'], toaster: ['warm', 'retro'], earlybird: ['warm', 'faded', 'vintage'], hudson: ['cool'], lark: ['cool', 'bright'], kelvin: ['warm', 'orange'], brannan: ['vintage', 'contrast'], aden: ['faded', 'pastel'], reyes: ['faded', 'vintage'], clarendon: ['vivid', 'cool'], gingham: ['faded', 'soft'], rise: ['warm', 'soft'], mayfair: ['warm', 'pink'], perpetua: ['pastel', 'teal'], slumber: ['faded', 'muted'], stinson: ['bright', 'faded'], walden: ['bright', 'yellow'], maven: ['muted', 'yellow'], brooklyn: ['faded', 'cool'] };
for (const f of list(join(SRC, 'cssgram-out')).filter((x) => x.endsWith('.png')).sort()) {
  const key = basename(f, '.png');
  const id = `ig-${slug(key)}`;
  copyFileSync(join(SRC, 'cssgram-out', f), join(OUT, `${id}.png`));
  add({ id, name: IG_NAMES[key] || prettyName(key), group: 'instagram era', source: 'cssgram', tags: ['2010s', 'instagram', 'filter', ...(IG_TAGS[key] || [])], fx: (IG_TAGS[key] || []).includes('b&w') ? 'monochrome' : 'rangefinder' });
}

// Flashnack's own era looks.
for (const look of ERA_LOOKS) {
  writeTiles(look.id, buildTable(N, look.fn));
  add({ id: look.id, name: look.name, group: 'era', source: 'own', tags: look.tags });
}

for (const id of POPULAR) if (!entries.some((e) => e.id === id)) throw new Error(`popular look ${id} was not built`);
const catalog = { size: N, sources: SOURCES, looks: entries.map(({ id, name, group, source, tags, fx, popular }) => ({ id, name, group, source, tags, fx, ...(popular ? { popular: true } : {}) })) };
writeFileSync('src/looks/catalog.json', `${JSON.stringify(catalog, null, 0).replace(/\},\{/g, '},\n{')}\n`);
console.log(`${entries.length} looks, ${entries.filter((e) => e.popular).length} popular`);
if (!existsSync(join(OUT, 'fb-gold.png'))) throw new Error('missing Flashback looks');
