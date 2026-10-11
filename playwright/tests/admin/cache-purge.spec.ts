import { test, expect, Browser, BrowserContext } from '@playwright/test';
import { openAdmin } from './admin';
import { cardLabels, cleanupStorefront, fixtureName, magento, seedDesign, seedSkuLabel } from '../storefront/storefront';

/**
 * Cache correctness with Varnish (02 · Architecture §5): saving a design or a label in the admin purges exactly
 * the cached pages that show it, so shoppers see the change on the next request.
 */
const TAG = 'cache';
const name = (n: string): string => fixtureName(TAG, n);
const PACK = { sku: '24-UG06', path: '/affirm-water-bottle.html', category: '/gear/fitness-equipment.html' };

let designId = 0;
let labelId = 0;
let shopper: BrowserContext;

async function guestCard(): Promise<{ labels: string[]; cache: string }> {
  const page = await shopper.newPage();
  const response = await page.goto(PACK.category);
  const labels = await cardLabels(page, PACK.path).catch(() => [] as string[]);
  await page.close();
  return { labels, cache: response?.headers()['x-cache'] ?? '' };
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  cleanupStorefront(TAG);
  designId = seedDesign(name('Cache'), 'E2E v1', '#9a3412');
  labelId = seedSkuLabel(name('Cache label'), designId, PACK.sku);
  magento('openlabel:css:regenerate');
  shopper = await browser.newContext({ storageState: { cookies: [], origins: [] }, ignoreHTTPSErrors: true });
});

test.afterAll(async () => {
  await shopper.close();
  cleanupStorefront(TAG);
});

test('a design save purges the cached listing', async ({ page }) => {
  await guestCard();
  const cached = await guestCard();
  expect(cached.cache).toMatch(/HIT/);
  expect(cached.labels).toContain('E2E v1');

  await openAdmin(page, `openlabel/design/edit/id/${designId}`);
  await page.locator('.ol-text-vars input.admin__control-text').fill('E2E v2');
  await page.locator('.page-actions-buttons').getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.locator('.message-success')).toContainText('The design was saved.');

  const after = await guestCard();
  expect(after.cache, 'the page was purged, so it is rendered again').toMatch(/MISS/);
  expect(after.labels).toContain('E2E v2');
  expect(after.labels).not.toContain('E2E v1');
});

test('disabling the label purges the cached listing', async ({ page }) => {
  await guestCard();
  expect((await guestCard()).cache).toMatch(/HIT/);

  await openAdmin(page, `openlabel/label/edit/id/${labelId}`);
  await page.locator('.admin__field[data-index="status"] .admin__actions-switch-label').click();
  await page.locator('.page-actions-buttons').getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.locator('.message-success')).toBeVisible();

  const after = await guestCard();
  expect(after.cache).toMatch(/MISS/);
  expect(after.labels).toEqual([]);
});
