import { test, expect } from '@playwright/test';
import { dismissAdminPopups, sql } from './admin';

/**
 * 08 · UX Spec §8, first acceptance test: a first-time user creates a working "Sale -25%" label from the empty
 * state in at most 3 clicks and 60 seconds. Starts from the dashboard, counts every click.
 */
test.describe('acceptance · empty-state starter', () => {
  test.beforeAll(() => sql("DELETE FROM openlabel_label; DELETE FROM ui_bookmark WHERE namespace = 'openlabel_label_listing';"));

  test('Sale starter: ≤ 3 clicks and ≤ 60 s from the dashboard to a live label', async ({ page }) => {
    await page.goto('/admin/admin/dashboard/');
    await page.waitForLoadState('networkidle');
    await dismissAdminPopups(page); // a fresh install's first-login popups are not the merchant's clicks
    let clicks = 0;
    const started = Date.now();

    await page.click('#menu-magento-catalog-catalog > a');
    clicks++;
    await page.locator('#menu-magento-catalog-catalog').getByRole('link', { name: 'Labels', exact: true }).click();
    clicks++;
    const starter = page.locator('[data-role="ol-starter"][data-starter="sale"]');
    await expect(starter).toBeVisible();
    await expect(starter).toContainText('Sale -{SAVE_PERCENT}%');
    await starter.click();
    clicks++;
    await expect(page.locator('.message-success')).toContainText('is live');

    const seconds = (Date.now() - started) / 1000;
    expect(clicks).toBeLessThanOrEqual(3);
    expect(seconds).toBeLessThanOrEqual(60);
    await expect(page.locator('[data-role="ol-empty-state"]')).toHaveCount(0);
    const row = page.locator('.data-row').filter({ hasText: 'Sale -{SAVE_PERCENT}%' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Active now');
    const matched = Number(sql("SELECT COUNT(DISTINCT i.product_id) FROM openlabel_index i JOIN openlabel_label l ON l.label_id = i.label_id WHERE l.name = 'Sale -{SAVE_PERCENT}%'")[0][0]);
    expect(matched, 'the sample catalog has discounted products').toBeGreaterThan(0);
    test.info().annotations.push({ type: 'timing', description: `${clicks} clicks, ${seconds.toFixed(1)} s` });
    console.log(`starter acceptance: ${clicks} clicks, ${seconds.toFixed(1)} s, ${matched} products`);
  });
});
