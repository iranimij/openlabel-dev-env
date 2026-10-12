import { test, expect, Page, Locator } from '@playwright/test';
import { collectCspViolations } from '../helpers';
import { sql } from '../fixture';
import { cleanupStorefront, fixtureName, magento, seedDesign, seedSkuLabel } from './storefront';

/**
 * 1.1 on the product page: labels follow the chosen variant, and {COUNTDOWN} ticks once a second (one timer,
 * the ticking text hidden from screen readers). The script is inline, registered for CSP. Desktop and mobile.
 */
// Its own configurable product, so parallel spec files never purge each other's cached pages.
const HOODIE = { sku: 'MH03', variant: 'MH03-XS-Blue', path: '/bruno-compete-hoodie.html' };

test.describe.configure({ mode: 'serial' });

let tag = '';
let variantText = '';

function attributeId(code: string): string {
  return sql(`SELECT attribute_id FROM eav_attribute WHERE attribute_code = '${code}' AND entity_type_id = 4`)[0][0];
}

test.beforeAll(({}, testInfo) => {
  tag = `variants-${testInfo.project.name}`;
  variantText = testInfo.project.name.startsWith('mobile') ? 'E2E Blue XS M' : 'E2E Blue XS';
  cleanupStorefront(tag);
  const variant = seedDesign(fixtureName(tag, 'Variant'), variantText, '#1d4ed8');
  seedSkuLabel(fixtureName(tag, 'Variant'), variant, HOODIE.variant, { placements: [['product', 'tr']] });
  const countdown = seedDesign(fixtureName(tag, 'Countdown'), 'Ends in {COUNTDOWN}', '#991b1b');
  // The special price of the hoodie ends in three days (cleaned up after the spec).
  const end = new Date(Date.now() + 3 * 86400 * 1000).toISOString().slice(0, 10);
  sql(`INSERT INTO catalog_product_entity_datetime (attribute_id, store_id, entity_id, value)
    SELECT ${attributeId('special_to_date')}, 0, entity_id, '${end} 00:00:00' FROM catalog_product_entity WHERE sku = '${HOODIE.sku}'
    ON DUPLICATE KEY UPDATE value = VALUES(value);`);
  seedSkuLabel(fixtureName(tag, 'Countdown'), countdown, HOODIE.sku, { placements: [['product', 'bl']] });
  magento('openlabel:css:regenerate');
});

test.afterAll(() => {
  sql(`DELETE d FROM catalog_product_entity_datetime d JOIN catalog_product_entity p ON p.entity_id = d.entity_id
    WHERE p.sku = '${HOODIE.sku}' AND d.attribute_id = ${attributeId('special_to_date')} AND d.store_id = 0;`);
  cleanupStorefront(tag);
});

async function choose(page: Page, group: string, option: string): Promise<void> {
  // Hyvä 1.4: role="radiogroup" named after the attribute; 1.5: a fieldset whose legend reads "Size:".
  const options = page.getByRole('radiogroup', { name: group }).or(page.getByRole('group', { name: new RegExp(`^${group}`) })).first();
  await options.scrollIntoViewIfNeeded();
  // Colour swatches show no text: the radio inside the label carries the name.
  await options.locator('label', { has: page.getByRole('radio', { name: option, exact: true }) }).first().click();
}

/** Inline scripts of OpenLabel (Playwright's text matching skips script contents). */
async function openLabelScripts(page: Page): Promise<number> {
  return page.evaluate(() => Array.from(document.querySelectorAll('script:not([src])'))
    .filter((s) => (s.textContent ?? '').includes('.ol-countdown[data-ol-end]')).length);
}

function variantLabel(page: Page): Locator {
  return page.locator('.ol-label', { hasText: new RegExp(`^${variantText}$`) });
}

test('the variant label shows only while that variant is chosen', async ({ page }) => {
  const csp = collectCspViolations(page);
  await page.goto(HOODIE.path);
  await expect(variantLabel(page)).toHaveCount(1);
  await expect(variantLabel(page)).toBeHidden();

  await choose(page, 'Size', 'XS');
  await choose(page, 'Color', 'Blue');
  await expect(variantLabel(page)).toBeVisible();

  await choose(page, 'Color', 'Black');
  await expect(variantLabel(page)).toBeHidden();
  expect(csp, 'the inline script is allowed by the CSP').toEqual([]);
});

test('the countdown ticks every second and screen readers get the end date', async ({ page }) => {
  await page.goto(HOODIE.path);
  const countdown = page.locator('.ol-countdown').first();
  await expect(countdown).toBeVisible();
  const ticking = countdown.locator('[aria-hidden="true"]');
  await expect(ticking).toHaveText(/^\dd \d\d:\d\d:\d\d$/);
  const first = await ticking.textContent();
  await expect(ticking).not.toHaveText(first ?? '', { timeout: 3000 });
  await expect(countdown.locator('.ol-sr')).toHaveText(/^Ends /);
  expect(await openLabelScripts(page), 'one OpenLabel script').toBe(1);
});

test('pages without countdowns or variant labels get no OpenLabel script', async ({ page }) => {
  await page.goto('/gear/bags.html');
  expect(await openLabelScripts(page)).toBe(0);
});
