import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sql } from '../admin/admin';
import { cleanupStorefront, fixtureName, magento, seedDesign, seedSkuLabel } from '../storefront/storefront';

/**
 * Custom-theme fallback (07 · Build Brief §6, docs/storefront.md): a theme whose gallery container is renamed
 * cannot get the automatic injection; with the documented one-line child call it shows the labels, once.
 * Runs in its own project, after the admin specs and before the storefront specs, because it switches the
 * default store view to the fallback theme for its duration.
 */
test.describe.configure({ mode: 'serial' });

const TAG = 'fallback';
const SKU = '24-WG080';
let previousTheme: string | null = null;
let productPath = '';
/** Set when the installed Hyvä gallery is not the 1.3/1.4 markup this fallback is written for (Hyvä 1.5+). */
let unsupported = '';

test.beforeAll(() => {
  try {
    execFileSync(resolve(__dirname, '../../scripts/fallback-theme.sh'), { encoding: 'utf8' });
  } catch (error) {
    if ((error as { status?: number }).status === 3) {
      unsupported = 'Hyvä gallery markup newer than 1.4 (not in OpenLabel 1.0\'s support matrix)';
      return;
    }
    throw error;
  }
  const parent = sql("SELECT theme_id FROM theme WHERE theme_path = 'Hyva/default' AND area = 'frontend'")[0][0];
  sql(
    'INSERT INTO theme (parent_id, theme_path, theme_title, is_featured, area, type, code)'
    + ` SELECT ${parent}, 'OpenLabelE2e/fallback', 'OpenLabel e2e fallback', 0, 'frontend', 0, 'OpenLabelE2e/fallback'`
    + " FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM theme WHERE theme_path = 'OpenLabelE2e/fallback');",
  );
  const themeId = sql("SELECT theme_id FROM theme WHERE theme_path = 'OpenLabelE2e/fallback'")[0][0];
  const current = sql("SELECT value FROM core_config_data WHERE path = 'design/theme/theme_id' AND scope = 'stores' AND scope_id = 1");
  previousTheme = current.length > 0 ? current[0][0] : null;
  productPath = '/' + sql(
    "SELECT u.request_path FROM url_rewrite u JOIN catalog_product_entity e ON e.entity_id = u.entity_id"
    + ` WHERE u.entity_type = 'product' AND e.sku = '${SKU}' AND u.store_id = 1 AND u.metadata IS NULL LIMIT 1`,
  )[0][0];

  cleanupStorefront(TAG);
  seedSkuLabel(fixtureName(TAG, 'Fallback'), seedDesign(fixtureName(TAG, 'Fallback'), 'E2E Fallback'), SKU);
  magento('config:set', '--scope=stores', '--scope-code=default', 'design/theme/theme_id', themeId);
  magento('openlabel:css:regenerate');
  magento('cache:flush');
});

test.afterAll(() => {
  if (unsupported !== '') {
    return;
  }
  if (previousTheme === null) {
    sql("DELETE FROM core_config_data WHERE path = 'design/theme/theme_id' AND scope = 'stores' AND scope_id = 1");
  } else {
    magento('config:set', '--scope=stores', '--scope-code=default', 'design/theme/theme_id', previousTheme);
  }
  cleanupStorefront(TAG);
  magento('cache:flush');
});

test('renamed gallery container: the theme renders the label child itself, once', async ({ page }) => {
  test.skip(unsupported !== '', unsupported);
  await page.goto(productPath);
  await expect(page.locator('#gallery-main')).toHaveCount(0);
  const gallery = page.locator('#gallery-custom');
  await expect(gallery).toBeVisible();
  await expect(gallery.locator('> .ol-stack .ol-label')).toHaveText(['E2E Fallback']);
  await expect(gallery.locator('> .ol-stack')).toHaveCSS('position', 'absolute');
  expect(await page.locator('.ol-stack .ol-label', { hasText: 'E2E Fallback' }).count(), 'never rendered twice').toBe(1);
});
