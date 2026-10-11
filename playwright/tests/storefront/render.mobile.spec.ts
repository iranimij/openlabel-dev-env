import { test, expect, Page, Locator } from '@playwright/test';
import { collectCspViolations } from '../helpers';
import { cleanupStorefront, fixtureName, magento, seedDesign, seedSkuLabel } from './storefront';

/**
 * Storefront rendering on Hyvä 1.4 (CSP enforced, Varnish on, theme never rebuilt with OpenLabel):
 * 10 · Front-end Review acceptance tests FE1/FE4/FE5/FE3 and 02 · Architecture §4. Runs on desktop and mobile.
 */
// Its own category, so parallel spec files never purge each other's cached pages.
const WATCH = { sku: '24-MG04', path: '/aim-analog-watch.html', category: '/gear/watches.html', search: '/catalogsearch/result/?q=Aim+Analog+Watch' };

test.describe.configure({ mode: 'serial' });

let tag = '';
let text = '';

test.beforeAll(({}, testInfo) => {
  tag = `render-${testInfo.project.name}`;
  text = testInfo.project.name.startsWith('mobile') ? 'E2E Render M' : 'E2E Render';
  cleanupStorefront(tag);
  const design = seedDesign(fixtureName(tag, 'Render'), text, '#b91c1c');
  seedSkuLabel(fixtureName(tag, 'Watch'), design, WATCH.sku, { position: 'tl' });
  magento('openlabel:css:regenerate');
});

test.afterAll(() => {
  cleanupStorefront(tag);
});

function exact(): RegExp {
  return new RegExp(`^${text}$`);
}

function card(page: Page, productPath: string): Locator {
  return page.locator('.product-item', { has: page.locator(`a.product-item-photo[href$="${productPath}"]`) }).first();
}

async function expectOverlay(stack: Locator, container: Locator): Promise<void> {
  await expect(stack).toHaveCSS('position', 'absolute');
  await expect(stack).toHaveCSS('pointer-events', 'none');
  const s = await stack.boundingBox();
  const c = await container.boundingBox();
  expect(s && c, 'stack and container are rendered').toBeTruthy();
  if (s && c) {
    expect(s.x).toBeGreaterThanOrEqual(c.x - 1);
    expect(s.y).toBeGreaterThanOrEqual(c.y - 1);
    expect(s.x + s.width).toBeLessThanOrEqual(c.x + c.width + 1);
    expect(s.y + s.height).toBeLessThanOrEqual(c.y + c.height + 1);
  }
}

async function fontSize(label: Locator): Promise<number> {
  return label.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

test('listing: label overlays the image, styled only by the generated stylesheet', async ({ page }) => {
  const csp = collectCspViolations(page);
  await page.goto(WATCH.category);
  const item = card(page, WATCH.path);
  const label = item.locator('.ol-label', { hasText: exact() });
  await expect(label).toBeVisible();

  await expectOverlay(item.locator('.ol-stack').first(), item.locator('.ol-anchor'));
  expect(await fontSize(label), '08 §2: at least 11 px on a card').toBeGreaterThanOrEqual(11);
  expect(await page.locator('.ol-anchor [style], .ol-stack[style], .ol-label[style]').count(), 'no inline styles').toBe(0);
  await expect(page.locator('link[rel="stylesheet"][href*="/media/openlabel/"]')).toHaveCount(1);
  expect(await page.locator('script[src*="Iranimij_OpenLabel"]').count(), 'no JavaScript in 1.0').toBe(0);
  expect(csp).toEqual([]);
});

test('listing: the label never intercepts the click on the product image', async ({ page }) => {
  await page.goto(WATCH.category);
  const label = card(page, WATCH.path).locator('.ol-label', { hasText: exact() });
  await label.scrollIntoViewIfNeeded();
  const box = await label.boundingBox();
  expect(box).toBeTruthy();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  const hit = await page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    return { inStack: !!el?.closest('.ol-stack'), inLink: !!el?.closest('a.product-item-photo') };
  }, [x, y]);
  expect(hit).toEqual({ inStack: false, inLink: true });

  await page.mouse.click(x, y);
  await expect(page).toHaveURL(new RegExp(`${WATCH.path.replace('.', '\\.')}$`));
});

test('search results and the home page widget show labels too', async ({ page }) => {
  await page.goto(WATCH.search);
  await expect(card(page, WATCH.path).locator('.ol-label', { hasText: exact() })).toBeVisible();

  await page.goto('/');
  await card(page, WATCH.path).scrollIntoViewIfNeeded();
  await expect(card(page, WATCH.path).locator('.ol-label', { hasText: exact() })).toBeVisible();
});

test('product page: label inside the gallery, legible, no CSP errors', async ({ page }) => {
  const csp = collectCspViolations(page);
  await page.goto(WATCH.path);
  const gallery = page.locator('#gallery-main');
  const label = gallery.locator('.ol-stack .ol-label', { hasText: exact() });
  await expect(label).toBeVisible();
  await expectOverlay(gallery.locator('> .ol-stack').first(), gallery);
  expect(await fontSize(label)).toBeGreaterThanOrEqual(11);
  expect(csp).toEqual([]);
});

test('RTL: a top-start label moves to the right edge (logical properties, FE4)', async ({ page }) => {
  // Magento and Hyvä do not set dir on <html>; RTL themes add it in their layout (docs/storefront.md).
  await page.goto(WATCH.category);
  const item = card(page, WATCH.path);
  const stack = item.locator('.ol-stack', { has: page.locator('.ol-label', { hasText: exact() }) });
  const anchor = item.locator('.ol-anchor');
  const ltr = (await stack.boundingBox())!;
  const box = (await anchor.boundingBox())!;
  expect(Math.abs(ltr.x - box.x)).toBeLessThanOrEqual(1);

  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  const rtl = (await stack.boundingBox())!;
  const rtlBox = (await anchor.boundingBox())!;
  expect(Math.abs(rtl.x + rtl.width - (rtlBox.x + rtlBox.width))).toBeLessThanOrEqual(1);
});
