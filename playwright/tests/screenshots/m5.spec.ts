import { test, expect, Page } from '@playwright/test';
import { resolve } from 'node:path';
import { AUTH_FILE, openAdmin, sql } from '../admin/admin';
import { cleanupStorefront, fixtureName, magento, seedDesign, seedSkuLabel } from '../storefront/storefront';

/**
 * Screenshots for the M5 (OpenLabel 1.1) milestone report, written to docs/m5-screenshots. Not a test gate: runs
 * only with OL_SCREENSHOTS=1 (project "screenshots-chromium"). Seeds labels on one bag with built-in 1.1 designs
 * and removes them afterwards.
 */
const BAG = { id: 6, sku: '24-MB02', path: '/fusion-backpack.html', category: '/gear/bags.html' };
const OUT = resolve(__dirname, '../../../docs/m5-screenshots');
const tag = 'm5-shots';

test.describe.configure({ mode: 'serial' });

function builtIn(name: string): number {
  return Number(sql(`SELECT design_id FROM openlabel_design WHERE is_system = 1 AND name = '${name}';`)[0][0]);
}

test.beforeAll(() => {
  cleanupStorefront(tag);
  const offer = seedDesign(fixtureName(tag, 'Offer'), 'Weekend deal', '#9d174d');
  sql(`UPDATE openlabel_design_store SET tooltip = 'Ends Sunday at midnight' WHERE design_id = ${offer} AND store_id = 0;`);
  seedSkuLabel(fixtureName(tag, 'Offer'), offer, BAG.sku, { placements: [['listing', 'tl'], ['product', 'tl']], reindex: false });
  seedSkuLabel(fixtureName(tag, 'Bestseller'), builtIn('Bestseller (bronze)'), BAG.sku, { placements: [['listing', 'above_c'], ['product', 'above_c']], reindex: false });
  seedSkuLabel(fixtureName(tag, 'Ships free'), builtIn('Ships free (sky)'), BAG.sku, {
    placements: [['listing', 'near_price'], ['product', 'near_price'], ['cart', 'under_name'], ['minicart', 'under_name']],
    reindex: false,
  });
  seedSkuLabel(fixtureName(tag, 'Online only'), builtIn('Online only (teal)'), BAG.sku, { placements: [['listing', 'under_name'], ['product', 'near_cart']] });
  magento('openlabel:reindex');
  magento('openlabel:css:regenerate');
  magento('cache:clean', 'full_page');
});

test.afterAll(() => {
  cleanupStorefront(tag);
  magento('cache:clean', 'full_page');
});

async function shot(page: Page, selector: string, file: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path: `${OUT}/${file}` });
}

test('storefront: listing card, product page, tooltip, cart and mini cart', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BAG.category);
  const card = page.locator('.product-item', { has: page.locator(`a[href$="${BAG.path}"]`) }).first();
  await expect(card.locator('.ol-label', { hasText: 'Weekend deal' })).toBeVisible();
  await card.screenshot({ path: `${OUT}/listing-card-positions.png` });

  const offer = card.locator('.ol-label', { hasText: 'Weekend deal' }).first();
  await offer.hover();
  await expect(page.locator(`#${await offer.getAttribute('aria-describedby')}`)).toBeVisible();
  await card.screenshot({ path: `${OUT}/listing-card-tooltip.png` });

  await page.goto(BAG.path);
  await expect(page.locator('main .ol-label', { hasText: 'Weekend deal' }).first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/product-page.png` });

  await page.locator('#product-addtocart-button').click();
  await expect(page.locator('.message.success, [x-data] .message-success').first()).toBeVisible({ timeout: 15000 });
  await page.locator('#menu-cart-icon').click();
  await expect(page.locator('.ol-inline--minicart .ol-label').first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/mini-cart.png` });

  await page.goto('/checkout/cart/');
  await expect(page.locator('.ol-inline--cart .ol-label').first()).toBeVisible();
  await shot(page, 'article.cart.item', 'cart-item.png');
});

test.describe('admin', () => {
  test.use({ storageState: AUTH_FILE, viewport: { width: 1440, height: 900 } });

  test('admin: 21-position picker and the product page section', async ({ page }) => {
    await openAdmin(page, 'openlabel/label/new/');
    const picker = page.locator('[data-index="placements"] [data-role="ol-position-picker"]').first();
    await expect(picker.locator('button[data-position]')).toHaveCount(21);
    await page.locator('[data-index="placements"] tr.data-row').first().screenshot({ path: `${OUT}/admin-position-picker.png` });

    await openAdmin(page, `catalog/product/edit/id/${BAG.id}/`);
    const section = page.locator('[data-index="openlabel"]');
    await section.locator('.fieldset-wrapper-title').click();
    await expect(section.locator('.ol-product-labels li').first()).toBeVisible();
    await section.screenshot({ path: `${OUT}/admin-product-section.png` });
  });
});
