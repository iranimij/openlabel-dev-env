import { test, expect, Page } from '@playwright/test';
import { collectCspViolations } from '../helpers';
import { cleanupStorefront, ensureCustomers, fixtureName, loginAs, magento, seedDesign, seedSkuLabel } from './storefront';

/**
 * 1.1 item lists on Hyvä: the cart page, the mini cart, the compare list and the wish list show the item's labels
 * as text next to it. Seeds data, so it runs once (desktop).
 */
// Its own product: cart, compare and wish list are private pages, never in the page cache.
const DUFFLE = { sku: '24-UB02', path: '/impulse-duffle.html' };

test.describe.configure({ mode: 'serial' });

const tag = 'items';
let text = '';

test.beforeAll(() => {
  text = 'E2E In your cart';
  cleanupStorefront(tag);
  ensureCustomers();
  const design = seedDesign(fixtureName(tag, 'Items'), text, '#166534');
  seedSkuLabel(fixtureName(tag, 'Duffle'), design, DUFFLE.sku, {
    placements: [['cart', 'under_name'], ['minicart', 'under_name'], ['wishlist', 'under_name'], ['compare', 'under_name']],
  });
  magento('openlabel:css:regenerate');
});

test.afterAll(() => {
  cleanupStorefront(tag);
});

async function addToCart(page: Page): Promise<void> {
  await page.goto(DUFFLE.path);
  await page.locator('#product-addtocart-button').click();
  await expect(page.locator('.message.success, [x-data] .message-success').first()).toBeVisible({ timeout: 15000 });
}

test('cart page and mini cart show the item label', async ({ page }) => {
  const csp = collectCspViolations(page);
  await addToCart(page);

  await page.locator('#menu-cart-icon').click();
  const drawer = page.locator('.ol-inline--minicart .ol-label', { hasText: text });
  await expect(drawer).toBeVisible();

  await page.goto('/checkout/cart/');
  const item = page.locator('article.cart.item', { has: page.locator(`a[href$="${DUFFLE.path}"]`) }).first();
  await expect(item.locator('.ol-inline--cart .ol-label', { hasText: text })).toBeVisible();
  expect(await page.locator('a a').count(), 'no link inside a link').toBe(0);
  expect(csp).toEqual([]);
});

test('compare list shows the item label', async ({ page }) => {
  await page.goto(DUFFLE.path);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('product_compare/add')),
    page.getByRole('button', { name: 'Add to Compare' }).click(),
  ]);
  await page.waitForLoadState('networkidle');
  await page.goto('/catalog/product_compare/');
  await expect(page.locator('.ol-inline--compare .ol-label', { hasText: text })).toBeVisible();
});

test('wish list shows the item label', async ({ page }) => {
  await loginAs(page, 'general');
  await page.goto(DUFFLE.path);
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('wishlist/index/add')),
    page.getByRole('button', { name: /Add to Wish ?List/i }).click(),
  ]);
  await page.waitForLoadState('networkidle');
  await page.goto('/wishlist/');
  await expect(page.locator('.ol-inline--wishlist .ol-label', { hasText: text })).toBeVisible();
});
