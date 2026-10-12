import { test, expect, Page, Locator } from '@playwright/test';
import { collectCspViolations } from '../helpers';
import { cleanupStorefront, fixtureName, magento, seedDesign, seedSkuLabel } from './storefront';

/**
 * 1.1 positions on Hyvä: the bands around the image and the labels in the product text (next to the price, next
 * to Add to Cart, under the name), on the listing and the product page, without layout shift. Desktop and mobile.
 */
// Its own product and category, so parallel spec files never purge each other's cached pages.
const SHORT = { sku: 'WSH02', path: '/maxima-drawstring-short.html', category: '/women/bottoms-women/shorts-women.html?product_list_limit=36' };

test.describe.configure({ mode: 'serial' });

let tag = '';
let text = '';

test.beforeAll(({}, testInfo) => {
  tag = `positions-${testInfo.project.name}`;
  text = testInfo.project.name.startsWith('mobile') ? 'E2E Pos M' : 'E2E Pos';
  cleanupStorefront(tag);
  const design = seedDesign(fixtureName(tag, 'Positions'), text, '#1d4ed8');
  seedSkuLabel(fixtureName(tag, 'Short'), design, SHORT.sku, {
    placements: [
      ['listing', 'above_c'], ['listing', 'near_price'], ['listing', 'under_name'], ['listing', 'near_cart'],
      ['product', 'below_c'], ['product', 'near_price'], ['product', 'under_name'], ['product', 'near_cart'],
    ],
  });
  magento('openlabel:css:regenerate');
});

test.afterAll(() => {
  cleanupStorefront(tag);
});

/** Sum of the layout-shift scores recorded since the page started loading. */
async function layoutShift(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { olShift: number }).olShift ?? 0);
}

async function recordLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { olShift: number };
    w.olShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
        if (!entry.hadRecentInput) {
          w.olShift += entry.value;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

function card(page: Page): Locator {
  return page.locator('.product-item', { has: page.locator(`a.product-item-photo[href$="${SHORT.path}"]`) }).first();
}

function inline(scope: Locator, position: string): Locator {
  return scope.locator(`.ol-inline--${position} .ol-label`, { hasText: new RegExp(`^${text}$`) });
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox();
  expect(b, 'element is rendered').toBeTruthy();
  return b!;
}

test('listing: labels next to the price, under the name, next to Add to Cart and above the image', async ({ page }, testInfo) => {
  const csp = collectCspViolations(page);
  await recordLayoutShift(page);
  await page.goto(SHORT.category);
  const item = card(page);
  await expect(inline(item, 'near-price')).toBeVisible();
  await expect(inline(item, 'under-name')).toBeVisible();

  const name = await box(item.locator('a.product-item-link'));
  const underName = await box(inline(item, 'under-name'));
  expect(underName.y, 'under the name').toBeGreaterThanOrEqual(name.y + name.height - 1);

  const price = await box(item.locator('.price-box').first());
  const nearPrice = await box(inline(item, 'near-price'));
  expect(nearPrice.y, 'on the price line or right after it').toBeLessThanOrEqual(price.y + price.height + 24);

  const cart = item.locator('[data-addto="cart"]');
  if (await cart.count()) {
    await expect(inline(item, 'near-cart')).toBeVisible();
  } else {
    testInfo.annotations.push({ type: 'note', description: 'no Add to Cart button on this card (configurable)' });
  }

  const above = item.locator('.ol-pos-otc', { hasText: text });
  await expect(above).toHaveCount(1);
  const anchor = await box(item.locator('.ol-anchor'));
  expect((await box(above)).y + (await box(above)).height, 'above the image').toBeLessThanOrEqual(anchor.y + 1);

  expect(await page.locator('.ol-inline[style], .ol-inline .ol-label[style]').count(), 'no inline styles').toBe(0);
  expect(await layoutShift(page), 'labels never move the page (CLS)').toBeLessThan(0.01);
  expect(csp).toEqual([]);
});

test('product page: labels next to the price, under the name, next to Add to Cart and below the image', async ({ page }) => {
  const csp = collectCspViolations(page);
  await recordLayoutShift(page);
  await page.goto(SHORT.path);
  const main = page.locator('main');
  await expect(inline(main, 'near-price')).toBeVisible();
  await expect(inline(main, 'under-name')).toBeVisible();
  await expect(inline(main, 'near-cart')).toBeVisible();

  const title = await box(page.locator('h1').first());
  expect((await box(inline(main, 'under-name'))).y, 'under the name').toBeGreaterThanOrEqual(title.y + title.height - 1);
  const button = await box(page.locator('#product-addtocart-button'));
  const nearCart = await box(inline(main, 'near-cart'));
  expect(Math.abs(nearCart.y + nearCart.height / 2 - (button.y + button.height / 2)), 'beside the button').toBeLessThanOrEqual(48);

  await expect(page.locator('.ol-pos-obc', { hasText: text })).toHaveCount(1);
  expect(await layoutShift(page), 'labels never move the page (CLS)').toBeLessThan(0.01);
  expect(csp).toEqual([]);
});

test('listing: the price label stays when a swatch changes the price', async ({ page }) => {
  await page.goto(SHORT.category);
  const item = card(page);
  await expect(inline(item, 'near-price')).toBeVisible();
  const swatch = item.locator('[role="radio"], input[type="radio"] + label, .swatch-option').first();
  if (await swatch.count()) {
    await swatch.click();
  }
  await expect(inline(item, 'near-price')).toBeVisible();
  await expect(item.locator('.price-box + .ol-inline--near-price')).toHaveCount(1);
});

test('RTL: text labels follow the text direction', async ({ page }) => {
  await page.goto(SHORT.category);
  const item = card(page);
  const label = inline(item, 'near-price');
  await expect(label).toBeVisible();
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  const stack = item.locator('.ol-inline--near-price');
  await expect(stack).toHaveCSS('margin-inline-start', /px/);
  expect(await stack.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
});
