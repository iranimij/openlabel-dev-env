import { test, expect } from '@playwright/test';
import { deleteE2eLabels, openAdmin, seedLabel, sql, uniqueName } from './admin';

test.describe('labels and designs grids', () => {
  test('Catalog › OpenLabel menu leads to the labels grid with its columns', async ({ page }) => {
    await openAdmin(page, 'catalog/product/');
    await page.click('#menu-magento-catalog-catalog > a');
    await page.locator('#menu-magento-catalog-catalog').getByRole('link', { name: 'Labels', exact: true }).click();
    await expect(page).toHaveURL(/openlabel\/label/);
    await expect(page.locator('.page-title')).toHaveText('Labels');
    const headers = page.locator('th.data-grid-th:visible');
    for (const name of ['Status', 'Name', 'Design', 'Shown where', 'Matched products', 'Active now', 'Priority', 'Store views']) {
      await expect(headers.filter({ hasText: name }).first()).toBeVisible();
    }
  });

  test('designs grid lists the 15 built-in designs with SVG previews', async ({ page }) => {
    await openAdmin(page, 'openlabel/design/index');
    await expect(page.locator('.page-title')).toHaveText('Designs');
    await expect(page.locator('.data-row svg.ol-admin-thumb').first()).toBeVisible();
    await expect(page.locator('.admin__control-support-text, .admin__data-grid-header-row').filter({ hasText: /records found/ }).first())
      .toContainText(/1[5-9]|[2-9]\d/);
  });
});

test.describe('labels grid editing', () => {
  test.afterAll(() => deleteE2eLabels());

  test('inline edit of the status and mass disable', async ({ page }) => {
    const first = uniqueName('Grid A');
    const second = uniqueName('Grid B');
    seedLabel(first);
    seedLabel(second);

    await openAdmin(page, 'openlabel/label/index');
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.locator('.admin__data-grid-filters input[name="name"]').fill('e2e');
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.locator('.data-row').filter({ hasText: first })).toBeVisible();

    // Inline edit: click the row, change status to Disabled, save.
    await page.locator('.data-row').filter({ hasText: first }).locator('td').nth(3).click();
    const editor = page.locator('tr.data-grid-editable-row:visible').first();
    await editor.locator('select[name="status"]').selectOption({ label: 'Disabled' });
    await page.locator('.data-grid-editable-row-actions:visible button').filter({ hasText: 'Save' }).first().click();
    await expect(page.locator('.data-row').filter({ hasText: first })).toContainText('Disabled');
    expect(sql(`SELECT status FROM openlabel_label WHERE name = '${first}'`)[0][0]).toBe('0');

    // Mass action: reload (inline edit keeps its row selected), select the second label and disable it.
    await openAdmin(page, 'openlabel/label/index');
    await page.locator('.data-row').filter({ hasText: second }).locator('input.admin__control-checkbox').check();
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.locator('.action-menu-item:visible').filter({ hasText: /^Disable$/ }).first().click();
    await expect(page.locator('.message-success')).toContainText('1 label(s) disabled.');
    expect(sql(`SELECT status FROM openlabel_label WHERE name = '${second}'`)[0][0]).toBe('0');
  });
});
