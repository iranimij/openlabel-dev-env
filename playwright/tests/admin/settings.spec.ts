import { test, expect } from '@playwright/test';
import { openAdmin } from './admin';

test('OpenLabel settings show max labels, the indexer hint and debug mode', async ({ page }) => {
  await openAdmin(page, 'admin/system_config/edit/section/openlabel/');
  const group = page.locator('#openlabel_general');
  if (!(await group.isVisible())) {
    await page.locator('#openlabel_general-head').click();
  }
  await expect(page.locator('#openlabel_general_default_max_labels')).toHaveValue('3');
  await expect(page.locator('#row_openlabel_general_index_mode')).toContainText('Currently:');
  await expect(page.locator('#openlabel_general_debug')).toHaveValue('0');
});
