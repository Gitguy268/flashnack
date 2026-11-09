import { test, expect } from '@playwright/test';

test('sample photos load from the empty state', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.flashnack);
  await page.getByRole('button', { name: 'Try two sample photos' }).click();
  await page.waitForFunction(() => window.flashnack.S.photos.length === 2 && window.flashnack.S.photos.every((p) => p.status === 'ready'), null, { timeout: 120_000 });
  await expect(page.locator('#export')).toHaveText('Export 2 photos');
  expect(errors).toEqual([]);
});
