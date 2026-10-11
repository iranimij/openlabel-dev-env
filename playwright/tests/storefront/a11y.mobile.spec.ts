import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { cleanupStorefront, fixtureName, magento, seedDesign, seedSkuLabel } from './storefront';

/**
 * Accessibility of labels (08 · UX Spec §2/§8, 10 · Front-end Review FE9): axe-core finds nothing in the label
 * markup on listing and product page, and the label text is part of the product link's accessible name.
 * The design is one of the low-contrast combinations merchants pick in real life only if it passes 4.5:1.
 */
test.describe.configure({ mode: 'serial' });

const BAND = { sku: '24-UG01', path: '/quest-lumaflex-trade-band.html', category: '/gear/fitness-equipment.html', name: 'Quest Lumaflex' };
let tag = '';
let text = '';

test.beforeAll(({}, testInfo) => {
  tag = `a11y-${testInfo.project.name}`;
  // Desktop and mobile run in parallel on the same product: each project has its own label text.
  text = testInfo.project.name.startsWith('mobile') ? 'Sale -20%' : 'Sale -25%';
  cleanupStorefront(tag);
  seedSkuLabel(fixtureName(tag, 'Band'), seedDesign(fixtureName(tag, 'A11y'), text, '#b91c1c'), BAND.sku, { position: 'tl' });
  magento('openlabel:css:regenerate');
});

test.afterAll(() => {
  cleanupStorefront(tag);
});

test('listing: no axe violations in the label markup; the label is announced with the product', async ({ page }) => {
  await page.goto(BAND.category);
  const link = page.locator(`a.product-item-photo[href$="${BAND.path}"]`);
  await expect(link.locator('.ol-label', { hasText: text })).toHaveCount(1);

  const results = await new AxeBuilder({ page }).include('.ol-anchor').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

  // The image link's accessible name: product image alt, then the label text (FE9).
  const name = await link.evaluate((a) => {
    const parts: string[] = [];
    a.querySelectorAll('img[alt], .ol-label').forEach((el) => {
      parts.push(el instanceof HTMLImageElement ? el.alt : (el.textContent ?? '').trim());
    });
    return parts.join(' ');
  });
  expect(name).toContain(BAND.name);
  expect(name).toContain(text);
  await expect(page.getByRole('link', { name: new RegExp(`Quest Lumaflex.*${text}`) })).toHaveCount(1);
});

test('product page: no axe violations in the gallery labels', async ({ page }) => {
  await page.goto(BAND.path);
  await expect(page.locator('#gallery-main .ol-label', { hasText: text })).toHaveCount(1);

  const results = await new AxeBuilder({ page }).include('#gallery-main > .ol-stack').analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
