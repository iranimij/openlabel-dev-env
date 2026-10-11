import { test, expect } from '@playwright/test';
import { adminCredentials, dismissAdminPopups, sql } from '../admin/admin';
import { cardLabels, galleryLabels } from '../storefront/storefront';
import { collectCspViolations } from '../helpers';

/**
 * M4 done-when: a stranger installs OpenLabel with the README's commands (ci/readme-install.sh runs them on a
 * fresh Hyvä store, no theme build) and follows the README quick start: Catalog › OpenLabel › Labels, click the
 * "Sale -{SAVE_PERCENT}%" starter, and sees the label on the storefront.
 */
test.describe.configure({ mode: 'serial' });

test('README quick start: the Sale starter makes a label that shows on the storefront', async ({ page }) => {
  const { user, password } = adminCredentials();
  await page.goto('/admin');
  await page.fill('#username', user);
  await page.fill('#login', password);
  await page.click('.action-login');
  await expect(page.locator('#menu-magento-backend-dashboard')).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await dismissAdminPopups(page);

  // README step 1: Catalog › OpenLabel › Labels.
  await page.click('#menu-magento-catalog-catalog > a');
  await page.locator('#menu-magento-catalog-catalog').getByRole('link', { name: 'Labels', exact: true }).click();
  // README step 2: click the "Sale -{SAVE_PERCENT}%" starter.
  const starter = page.locator('[data-role="ol-starter"][data-starter="sale"]');
  await expect(starter).toContainText('Sale -{SAVE_PERCENT}%');
  await page.waitForLoadState('networkidle');
  await starter.click();
  await expect(page.locator('.message-success')).toContainText('is live');

  // A discounted product of the sample catalog, as the storefront sees it.
  const rows = sql(
    "SELECT e.entity_id, v.value FROM openlabel_index i JOIN openlabel_label l ON l.label_id = i.label_id"
    + " JOIN catalog_product_entity e ON e.entity_id = i.product_id"
    + " JOIN catalog_product_entity_varchar v ON v.entity_id = e.entity_id AND v.store_id = 0"
    + " AND v.attribute_id = (SELECT attribute_id FROM eav_attribute WHERE attribute_code = 'url_key' AND entity_type_id = 4)"
    + " JOIN catalog_product_entity_int vis ON vis.entity_id = e.entity_id AND vis.store_id = 0"
    + " AND vis.attribute_id = (SELECT attribute_id FROM eav_attribute WHERE attribute_code = 'visibility' AND entity_type_id = 4)"
    + " WHERE l.name = 'Sale -{SAVE_PERCENT}%' AND vis.value = 4 AND i.parent_product_id IS NULL ORDER BY e.entity_id LIMIT 1",
  );
  expect(rows.length, 'the starter matched a visible product').toBe(1);
  const path = `/${rows[0][1]}.html`;
  const name = sql(
    "SELECT value FROM catalog_product_entity_varchar WHERE entity_id = " + Number(rows[0][0])
    + " AND store_id = 0 AND attribute_id = (SELECT attribute_id FROM eav_attribute WHERE attribute_code = 'name' AND entity_type_id = 4)",
  )[0][0];

  const csp = collectCspViolations(page);
  await page.goto(path);
  const gallery = await galleryLabels(page);
  expect(gallery).toHaveLength(1);
  expect(gallery[0]).toMatch(/^Sale -\d+%$/);

  await page.goto(`/catalogsearch/result/?q=${encodeURIComponent(name)}`);
  const card = await cardLabels(page, path);
  expect(card).toHaveLength(1);
  expect(card[0]).toMatch(/^Sale -\d+%$/);
  expect(csp).toEqual([]);
  console.log(`readme quick start: ${name} shows "${gallery[0]}"`);
});
