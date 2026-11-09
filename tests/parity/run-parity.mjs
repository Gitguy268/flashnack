// Compare Flashnack's WebGPU renders with upstream LoFi Logic reference renders.
//
//   REF_DIR=<dir with upstream *_f32.bin> DNG=<path to a V2 DNG> node tests/parity/run-parity.mjs
//
// The reference files come from a script that runs upstream core.processor
// with grain off (see CONTRIBUTING.md). Needs the dev server on port 5291.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const REF = process.env.REF_DIR, DNG = process.env.DNG, NAME = process.env.NAME || '1';
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.route('**/sample.dng', (r) => r.fulfill({ body: readFileSync(DNG), contentType: 'application/octet-stream' }));
await page.route('**/ref/*', (r) => r.fulfill({ body: readFileSync(`${REF}/${r.request().url().split('/').pop()}`) }));
await page.goto('http://localhost:5291/tests/parity/parity.html');
await page.waitForFunction(() => window.runParity);
if (process.env.ALIGN) await page.evaluate(() => { window.ALIGN = true; });
if (process.env.OVERRIDES) await page.evaluate((o) => { window.OVERRIDES = JSON.parse(o); }, process.env.OVERRIDES);
const VIBES = (process.env.VIBES || 'disposable,point_shoot,rangefinder,monochrome,flashback_classic_v1').split(',');
const fn = process.env.CPU ? 'runCpuParity' : 'runParity';
const res = await page.evaluate(([n, v, f]) => window[f](n, v), [NAME, VIBES, fn]);
console.log(JSON.stringify(res, null, 1));
await browser.close();
