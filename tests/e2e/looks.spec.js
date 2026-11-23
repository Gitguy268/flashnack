import { test, expect } from '@playwright/test';

async function open(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.flashnack);
  return errors;
}
/** Type in the look search and wait until the (debounced) results are in. */
async function search(page, q) {
  await page.fill('#look-search', q);
  await page.waitForTimeout(250);
  await expect(page.locator('#look-count')).toHaveText(/look|Nothing/);
}
async function samples(page) {
  await page.getByRole('button', { name: 'Try two sample photos' }).click();
  await page.waitForFunction(() => window.flashnack.S.photos.length === 2 && window.flashnack.S.photos.every((p) => p.status === 'ready'), null, { timeout: 120_000 });
}
/** Mean colour of the look card's thumbnail, once it has been drawn. */
async function cardColour(page, sel) {
  // Only cards on screen get a thumbnail.
  await page.locator(sel).scrollIntoViewIfNeeded();
  await page.waitForFunction((s) => {
    const c = document.querySelector(s);
    const d = c?.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return d && d.some((v, i) => i % 4 !== 3 && v > 0);
  }, sel, { timeout: 30_000 });
  return page.evaluate((s) => {
    const c = document.querySelector(s), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, m = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) m[k] += d[i + k];
    return m.map((v) => v / (d.length / 4));
  }, sel);
}

test('Flashback app looks and popular film looks change the photo', async ({ page }) => {
  const errors = await open(page);
  await samples(page);
  const gold = await cardColour(page, '#looks-flashback [data-id="fb-gold"] canvas');
  const triX = await cardColour(page, '#looks-popular [data-id="t3-kodak-tri-x-400"] canvas');
  // Tri-X is black and white; Gold is not.
  expect(Math.abs(triX[0] - triX[2])).toBeLessThan(3);
  expect(gold[0] - gold[2]).toBeGreaterThan(3);
  await page.click('#looks-flashback [data-id="fb-cine"]');
  await expect(page.locator('#look-current')).toHaveText('Flashback Cine');
  await expect(page.locator('#film-strength')).toBeVisible();
  expect(await page.evaluate(() => window.flashnack.S.vibeId)).toBe('fb-cine');
  expect(errors).toEqual([]);
});

test('searching finds era looks and applies one', async ({ page }) => {
  const errors = await open(page);
  await samples(page);
  await search(page, 'y2k');
  await expect(page.locator('#look-results .look[data-id="own-y2k-digicam"]')).toBeVisible();
  await page.click('.look-chip[data-q="polaroid"]');
  await expect(page.locator('#look-search')).toHaveValue('polaroid');
  const first = page.locator('#look-results .look').first();
  const id = await first.getAttribute('data-id');
  expect(id).toMatch(/polaroid|instant/);
  await first.click();
  expect(await page.evaluate(() => window.flashnack.S.vibeId)).toBe(id);
  await search(page, 'qqqq');
  await expect(page.locator('#look-count')).toContainText('Nothing found');
  // Export names carry the look.
  await search(page, 'eighties');
  await page.click('#look-results .look[data-id="own-80s-mall-flash"]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  expect(download.suggestedFilename()).toMatch(/^flashnack-own-80s-mall-flash-.*\.zip$/);
  expect(errors).toEqual([]);
});

test('works offline once loaded: popular looks and a look used before', async ({ page, context }) => {
  const errors = await open(page);
  // Wait for the service worker to finish caching.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => !!(await caches.match('./luts/look/fb-gold.png')) && !!(await caches.match('./samples/viaduct.jpg')), null, { timeout: 60_000 });
  await samples(page);
  // Use one catalog look while online, so it gets cached.
  await search(page, 'velvia 100');
  await page.click('#look-results .look[data-id="t3-fuji-velvia-100"]');
  await page.waitForFunction(async () => !!(await caches.match('./luts/look/t3-fuji-velvia-100.png')), null, { timeout: 30_000 });

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.flashnack);
  await samples(page);
  await page.click('#looks-flashback [data-id="fb-dispo"]');
  await cardColour(page, '#looks-flashback [data-id="fb-dispo"] canvas');
  await page.click('#looks-popular [data-id="t3-kodak-portra-400"]');
  await search(page, 'velvia 100');
  await page.click('#look-results .look[data-id="t3-fuji-velvia-100"]');
  await cardColour(page, '#look-results [data-id="t3-fuji-velvia-100"] canvas');
  // A look that was never used is marked as needing the internet.
  await search(page, 'agfa apx 25');
  await expect(page.locator('#look-results .look-badge').first()).toBeVisible();
  await context.setOffline(false);
  expect(errors.filter((e) => !/Failed to fetch|NetworkError|net::/.test(e))).toEqual([]);
});

test('camera mode takes photos that join the roll', async ({ page, context }) => {
  await context.grantPermissions(['camera']);
  const errors = await open(page);
  await page.click('#shoot');
  await expect(page.locator('.sh-body')).toBeVisible();
  await page.waitForFunction(() => document.querySelector('.shoot video')?.readyState >= 2, null, { timeout: 30_000 });
  await page.click('.sh-shutter');
  await expect(page.locator('.sh-lcd-num')).toHaveText('26');
  // The winder has to be rolled before the next frame.
  await page.click('.sh-shutter');
  await expect(page.locator('.sh-msg')).toContainText('winder');
  await page.keyboard.press('w');
  await page.click('.sh-shutter');
  await expect(page.locator('.sh-lcd-num')).toHaveText('25');
  await page.click('.sh-done');
  await page.waitForFunction(() => window.flashnack.S.photos.length === 2 && window.flashnack.S.photos.every((p) => p.status === 'ready'), null, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('the ONE35 V2 turns, shoots and changes colour in 3D', async ({ page }) => {
  const errors = await open(page);
  await page.waitForFunction(() => window.flashnack.S.cam3dMini, null, { timeout: 30_000 });
  await page.click('#cam3d-mini');
  await expect(page.locator('#cam3d')).toBeVisible();
  await page.waitForFunction(() => window.flashnack.S.cam3dFull);
  await page.evaluate(() => window.flashnack.S.cam3dFull.shoot());
  await expect(page.locator('.cam3d-help')).toContainText('26 left');
  await page.evaluate(() => window.flashnack.S.cam3dFull.shoot());
  await expect(page.locator('.cam3d-help')).toContainText('winder');
  await page.evaluate(() => window.flashnack.S.cam3dFull.wind(Math.PI * 2));
  await page.click('.swatch[data-id="crystal-teal"]');
  await expect(page.locator('.swatch[data-id="crystal-teal"]')).toHaveAttribute('aria-checked', 'true');
  await page.click('#cam3d-close');
  await expect(page.locator('#cam3d')).toBeHidden();
  expect(errors).toEqual([]);
});
