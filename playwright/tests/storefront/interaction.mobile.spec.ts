import { test, expect, Page, Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { collectCspViolations } from '../helpers';
import { sql } from '../fixture';
import { cleanupStorefront, fixtureName, magento, seedDesign, seedSkuLabel } from './storefront';

/**
 * 1.1 interaction: tooltips (hover and keyboard focus, described by the tooltip) and click-through links, never a
 * link inside the product card link. CSS only. Desktop and mobile.
 */
// Its own product and category, so parallel spec files never purge each other's cached pages.
const PANT = { sku: 'MP01', path: '/caesar-warm-up-pant.html', category: '/men/bottoms-men/pants-men.html?product_list_limit=36' };

test.describe.configure({ mode: 'serial' });

let tag = '';
let text = '';

test.beforeAll(({}, testInfo) => {
  tag = `interaction-${testInfo.project.name}`;
  text = testInfo.project.name.startsWith('mobile') ? 'E2E Tip M' : 'E2E Tip';
  cleanupStorefront(tag);
  const design = seedDesign(fixtureName(tag, 'Tip'), text, '#1d4ed8');
  sql(`UPDATE openlabel_design_store SET tooltip = 'Offer ends Sunday' WHERE design_id = ${design} AND store_id = 0;`);
  const label = seedSkuLabel(fixtureName(tag, 'Pant'), design, PANT.sku, {
    reindex: false,
    placements: [['listing', 'br'], ['product', 'br'], ['listing', 'under_name']],
  });
  sql(`UPDATE openlabel_label SET click_url = '/gear.html', click_nofollow = 1 WHERE label_id = ${label};`);
  magento('openlabel:reindex', String(label));
  magento('openlabel:css:regenerate');
});

test.afterAll(() => {
  cleanupStorefront(tag);
});

function card(page: Page): Locator {
  return page.locator('.product-item', { has: page.locator(`a.product-item-photo[href$="${PANT.path}"]`) }).first();
}

function label(scope: Locator): Locator {
  return scope.locator('.ol-label:not(.ol-label--hidden)', { hasText: new RegExp(`^${text}$`) });
}

test('listing: the image label shows its tooltip on hover and is not a link inside the card link', async ({ page }, testInfo) => {
  const csp = collectCspViolations(page);
  await page.goto(PANT.category);
  const item = card(page);
  const onImage = label(item.locator('.ol-anchor'));
  await expect(onImage).toBeVisible();
  expect(await page.locator('a a').count(), 'no link inside a link').toBe(0);
  expect(await onImage.evaluate((el) => el.tagName)).toBe('SPAN');
  const tipId = await onImage.getAttribute('aria-describedby');
  expect(tipId).toMatch(/^ol-tip-\d+-\d+$/);
  const tip = page.locator(`#${tipId}`);
  await expect(tip).toBeHidden();
  if (!testInfo.project.name.startsWith('mobile')) {
    await onImage.hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('Offer ends Sunday');
  }

  // Under the name the label is outside the card link, so it is a real link.
  const underName = label(item.locator('.ol-inline--under-name'));
  await expect(underName).toHaveAttribute('href', /\/gear\.html$/);
  await expect(underName).toHaveAttribute('rel', 'nofollow');
  expect(csp).toEqual([]);
});

test('product page: the label is a keyboard-reachable link with its tooltip, and it navigates', async ({ page }) => {
  await page.goto(PANT.path);
  const link = label(page.locator('main'));
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /\/gear\.html$/);
  await expect(link).toHaveAttribute('rel', 'nofollow');
  await link.focus();
  const tip = page.locator(`#${await link.getAttribute('aria-describedby')}`);
  await expect(tip).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.ol-stack').analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await link.click();
  await expect(page).toHaveURL(/\/gear\.html$/);
});
