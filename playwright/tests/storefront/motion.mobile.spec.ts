import { test, expect, Page, Locator } from '@playwright/test';
import { collectCspViolations } from '../helpers';
import { sql } from '../fixture';
import { cleanupStorefront, fixtureName, magento, seedDesign, seedSkuLabel } from './storefront';

/**
 * Design 1.1 on the storefront: entry animation, hover effect and per-screen sizes are CSS only, and motion is off
 * for shoppers who ask for reduced motion. Runs on desktop and mobile.
 */
// Its own product and category, so parallel spec files never purge each other's cached pages.
const SHORT = { sku: 'MSH02', path: '/apollo-running-short.html', category: '/men/bottoms-men/shorts-men.html?product_list_limit=36' };

test.describe.configure({ mode: 'serial' });

let tag = '';
let text = '';

test.beforeAll(({}, testInfo) => {
  tag = `motion-${testInfo.project.name}`;
  text = testInfo.project.name.startsWith('mobile') ? 'E2E Motion M' : 'E2E Motion';
  cleanupStorefront(tag);
  const design = seedDesign(fixtureName(tag, 'Motion'), text, '#991b1b');
  sql(`UPDATE openlabel_design SET animation = 'pop', hover_effect = 'grow', sizes = '{"sm":{"width":40}}' WHERE design_id = ${design};`);
  seedSkuLabel(fixtureName(tag, 'Short'), design, SHORT.sku, { position: 'br' });
  magento('openlabel:css:regenerate');
});

test.afterAll(() => {
  cleanupStorefront(tag);
});

function label(page: Page): Locator {
  return page
    .locator('.product-item', { has: page.locator(`a.product-item-photo[href$="${SHORT.path}"]`) })
    .first()
    .locator('.ol-label', { hasText: new RegExp(`^${text}$`) });
}

async function style(target: Locator, property: string): Promise<string> {
  return target.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name).trim(), property);
}

test('the entry animation plays, and not for reduced motion', async ({ page }) => {
  const csp = collectCspViolations(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(SHORT.category);
  await expect(label(page)).toHaveClass(/ol-anim-pop/);
  expect(await style(label(page), 'animation-name')).toBe('ol-pop');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await style(label(page), 'animation-name')).toBe('none');
  expect(await page.locator('script[src*="Iranimij_OpenLabel"]').count(), 'motion needs no JavaScript').toBe(0);
  expect(csp).toEqual([]);
});

test('the hover effect follows the product card on pointers that hover', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(SHORT.category);
  const target = label(page);
  await expect(target).toBeVisible();
  await page.locator(`a.product-item-photo[href$="${SHORT.path}"]`).first().hover();
  const scale = await style(target, '--ol-scale');
  if (testInfo.project.name.startsWith('mobile')) {
    expect(scale, 'touch screens get no hover effect').toBe('');
  } else {
    expect(scale).toBe('1.08');
  }
});

test('the per-screen width applies on phones only', async ({ page }, testInfo) => {
  await page.goto(SHORT.category);
  const width = await style(label(page), '--ol-w');
  const phone = (page.viewportSize()?.width ?? 1280) < 640;
  expect(width, testInfo.project.name).toBe(phone ? '40cqw' : '24cqw');
});
