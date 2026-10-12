import { test, expect } from '@playwright/test';
import { openAdmin, sql } from './admin';
import { cleanupStorefront, fixtureName, magento, seedDesign, seedSkuLabel } from '../storefront/storefront';

/**
 * The "OpenLabel" section of the product edit page (1.1): pick a label by hand, save the product, the label shows
 * on the storefront although its conditions do not match; the section then lists it as assigned by hand.
 */
const TOTE = { id: 10, sku: '24-WB05', path: '/savvy-shoulder-tote.html' };
const tag = 'product-tab';
const text = 'E2E By hand';
let labelName = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  cleanupStorefront(tag);
  const design = seedDesign(fixtureName(tag, 'Design'), text, '#7c2d12');
  labelName = fixtureName(tag, 'Picked');
  seedSkuLabel(labelName, design, 'no-such-sku', { placements: [['product', 'tr']] });
  magento('openlabel:css:regenerate');
});

test.afterAll(() => {
  sql(`DELETE FROM openlabel_label_product WHERE product_id = ${TOTE.id};`);
  cleanupStorefront(tag);
  magento('cache:clean', 'full_page');
});

test('a label assigned on the product page shows on the storefront', async ({ page }) => {
  await openAdmin(page, `catalog/product/edit/id/${TOTE.id}/`);
  const section = page.locator('[data-index="openlabel"]');
  await section.locator('.fieldset-wrapper-title').click();
  const select = section.locator('select[name="product[openlabel_label_ids]"]');
  await select.selectOption({ label: labelName });
  await page.locator('#save-button').click();
  await expect(page.locator('.message-success')).toContainText('You saved the product.');

  expect(sql(`SELECT COUNT(*) FROM openlabel_label_product WHERE product_id = ${TOTE.id}`)[0][0]).toBe('1');
  const reopened = page.locator('[data-index="openlabel"]');
  await reopened.locator('.fieldset-wrapper-title').click();
  await expect(reopened.locator('.ol-product-labels li', { hasText: labelName })).toContainText('(by hand)');

  await page.goto(TOTE.path);
  await expect(page.locator('main .ol-label', { hasText: new RegExp(`^${text}$`) }).first()).toBeVisible();
});
