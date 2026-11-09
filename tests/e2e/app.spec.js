import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { makeDng } from '../fixtures/make-dng.mjs';

// Real samples if FLASHNACK_SAMPLES points at a folder of DNGs, otherwise synthetic ones.
function samples(n) {
  const dir = process.env.FLASHNACK_SAMPLES;
  if (dir) return readdirSync(dir).filter((f) => /\.dng$/i.test(f)).sort().slice(0, n).map((f) => join(dir, f));
  const tmp = mkdtempSync(join(tmpdir(), 'flashnack-'));
  return Array.from({ length: n }, (_, i) => { const p = join(tmp, `SN100_${i + 1}.dng`); writeFileSync(p, makeDng({ seed: i + 1 }).bytes); return p; });
}

function jpegSize(bytes) {
  for (let i = 2; i < bytes.length;) {
    if (bytes[i] !== 0xff) return null;
    const m = bytes[i + 1], len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (m >= 0xc0 && m <= 0xc3) return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + len;
  }
  return null;
}

async function open(page, query = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.flashnack, null, { timeout: 30_000 });
  return errors;
}

async function addAndWait(page, files, count = files.length) {
  await page.setInputFiles('#pick', files);
  await page.waitForFunction((n) => window.flashnack.S.photos.length === n && window.flashnack.S.photos.every((p) => p.status === 'ready'), count, { timeout: 120_000 });
}

test('empty state explains what to drop', async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByText('Drop your Flashback photos here')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose photos' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('roll: pick a look, edit, skip one, export a zip', async ({ page }) => {
  const errors = await open(page);
  const files = samples(4);
  await addAndWait(page, files);
  await expect(page.locator('#export')).toHaveText('Export 4 photos');

  await page.keyboard.press('3');
  await expect(page.locator('.look[aria-checked="true"] .look-name')).toHaveText('Rangefinder');

  const exposure = page.locator('#s-exposure_ev');
  await exposure.fill('1');
  await expect(page.locator('output[for="s-exposure_ev"]')).toHaveText('+1.0 EV');

  await page.locator('.frame-keep').nth(1).click();
  await expect(page.locator('#export')).toHaveText('Export 3 photos');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
  expect(dl.suggestedFilename()).toMatch(/^flashnack-rangefinder-\d{4}-\d\d-\d\d\.zip$/);
  const zip = unzipSync(new Uint8Array(readFileSync(await dl.path())));
  const names = Object.keys(zip).sort();
  expect(names).toHaveLength(3);
  for (const n of names) {
    expect(n).toMatch(/_rf\.jpg$/);
    const size = jpegSize(zip[n]);
    expect(size.w).toBeGreaterThan(100);
  }
  if (!process.env.FLASHNACK_SAMPLES) expect(names[0]).toBe('FBV2_00001_rf.jpg');
  expect(errors).toEqual([]);
});

test('CPU renderer exports one photo', async ({ page }) => {
  const errors = await open(page, '?cpu');
  expect(await page.evaluate(() => window.flashnack.engine.backendName)).toBe('cpu');
  await addAndWait(page, samples(1));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
  expect(dl.suggestedFilename()).toMatch(/_disp\.jpg$/);
  const size = jpegSize(new Uint8Array(readFileSync(await dl.path())));
  expect(size.w).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('phone width has no sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await addAndWait(page, samples(2));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('V1 negatives zip develops and exports', async ({ page }) => {
  const { makeNegative } = await import('../fixtures/make-v1.mjs');
  const { zipSync } = await import('fflate');
  const tmp = mkdtempSync(join(tmpdir(), 'flashnack-v1-'));
  const files = {};
  for (const i of [1, 2]) {
    const n = makeNegative({ seed: i });
    files[`Roll/neg${i}`] = n.mosaic;
    files[`Roll/neg${i}.json`] = new TextEncoder().encode(n.json);
  }
  const zipPath = join(tmp, 'my-roll.zip');
  writeFileSync(zipPath, zipSync(files));
  const errors = await open(page);
  await addAndWait(page, [zipPath], 2);
  await expect(page.locator('#export')).toHaveText('Export 2 photos');
  expect(await page.evaluate(() => window.flashnack.S.photos.map((p) => p.kind))).toEqual(['v1', 'v1']);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
  const zip = unzipSync(new Uint8Array(readFileSync(await dl.path())));
  const names = Object.keys(zip).sort();
  expect(names).toHaveLength(2);
  for (const n of names) expect(n).toMatch(/^FBV1_[0-9a-f]{4}_neg\d_disp\.jpg$/);
  expect(jpegSize(zip[names[0]])).toEqual({ w: 640, h: 480 });
  expect(errors).toEqual([]);
});
