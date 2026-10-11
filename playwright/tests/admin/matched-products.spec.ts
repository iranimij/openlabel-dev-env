import { test, expect } from '@playwright/test';
import { deleteE2eLabels, openAdmin, seedLabel, uniqueName } from './admin';

test.describe('label form · matched products', () => {
  test.afterAll(() => deleteE2eLabels());

  test('a label created outside the form shows 0 matches until "Reindex now"', async ({ page }) => {
    const id = seedLabel(uniqueName('Matched'));
    await openAdmin(page, `openlabel/label/edit/id/${id}`);
    await page.locator('.fieldset-wrapper-title').filter({ hasText: 'Matched products' }).click();
    const section = page.locator('[data-role="ol-matched-products"]');
    await expect(section.locator('[data-role="ol-matched-count"]')).toHaveText(/^\s*0 products match/);
    await expect(section).toContainText('No products match yet.');
    await section.locator('[data-role="ol-reindex-now"]').click();
    await expect(page.locator('.message-success')).toContainText(/Reindexed\. [\d,]+ products match/);
    await page.locator('.fieldset-wrapper-title').filter({ hasText: 'Matched products' }).click();
    await expect(section.locator('[data-role="ol-matched-count"]')).not.toHaveText(/^\s*0 products match/);
    await expect(section.locator('.ol-matched__item').first()).toBeVisible();
  });
});
