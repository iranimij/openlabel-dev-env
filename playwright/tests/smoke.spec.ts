import { test, expect } from '@playwright/test';
import { isHyva15Gallery } from './fixture';
import { collectCspViolations, firstProductUrl } from './helpers';

/** Sample-data category present in every fixture build. */
const CATEGORY = '/women/tops-women.html';

test.describe('fixture store baseline', () => {
  test('home page renders the Hyvä theme behind Varnish with CSP enforced', async ({ page, request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['content-security-policy'], 'CSP must be in enforce mode on the storefront').toBeDefined();
    expect(headers['content-security-policy-report-only']).toBeUndefined();
    // Warden's Varnish keeps Via/X-Varnish; Magento's own VCL (CI) strips them, and the CI VCL adds X-Cache.
    expect(headers['via'] ?? headers['x-varnish'] ?? headers['x-cache'], 'Varnish must be in front of the store').toBeDefined();

    const violations = collectCspViolations(page);
    await page.goto('/');
    await expect(page.locator('body')).toHaveAttribute('class', /hyva-theme|cms-index-index/);
    expect(violations).toEqual([]);
  });

  test('category listing shows product cards from sample data', async ({ page }) => {
    const violations = collectCspViolations(page);
    await page.goto(CATEGORY);
    const cards = page.locator('.product-item');
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(cards.first().locator('a.product-item-photo img')).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('product page renders the Hyvä gallery container', async ({ page }) => {
    const violations = collectCspViolations(page);
    await page.goto(await firstProductUrl(page, CATEGORY));
    await expect(page.locator('#gallery-main')).toBeVisible();
    if (isHyva15Gallery()) {
      // Hyvä 1.5: the first slide of the track shows the image (a collapsed track would hide it).
      await expect(page.locator('#gallery-main img').first()).toBeVisible();
    } else {
      await expect(page.locator('#gallery-main img').first()).toHaveAttribute('width', /\d+/);
    }
    expect(violations).toEqual([]);
  });
});
