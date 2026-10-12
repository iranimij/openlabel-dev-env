import { test, expect } from '@playwright/test';
import { deleteE2eLabels, openAdmin, sql, uniqueName } from './admin';

test.describe('label form · show where', () => {
  test.afterAll(() => deleteE2eLabels());

  test('the 3×3 picker sets the position and the row keeps its design override and stacking', async ({ page }) => {
    const name = uniqueName('Where');
    await openAdmin(page, 'openlabel/label/new');
    await page.fill('input[name="name"]', name);
    await page.locator('.ol-design-tile').first().click();
    const picker = page.locator('[data-index="placements"] [data-role="ol-position-picker"]').first();
    await expect(picker.locator('[aria-checked="true"]')).toHaveAttribute('data-position', 'tl');
    await picker.locator('[data-position="tr"]').click();
    await expect(picker.locator('[data-position="tr"]')).toHaveAttribute('aria-checked', 'true');
    await picker.locator('[data-position="tr"]').press('ArrowDown');
    await expect(picker.locator('[data-position="mr"]')).toHaveAttribute('aria-checked', 'true');
    await picker.locator('[data-position="mr"]').press('ArrowUp');
    await page.locator('select[name="placements[0][design_id]"]').selectOption({ index: 2 });
    await page.locator('select[name="placements[0][stacking]"]').selectOption('horizontal');
    await page.fill('input[name="placements[0][gap]"]', '8');
    await page.locator('.page-actions-buttons').getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.locator('.message-success')).toContainText('The label was saved.');
    const row = sql(`SELECT p.position, p.stacking, p.gap, p.design_id IS NOT NULL FROM openlabel_placement p JOIN openlabel_label l ON l.label_id = p.label_id WHERE l.name = '${name}'`)[0];
    expect(row).toEqual(['tr', 'horizontal', '8', '1']);
  });

  test('the bands around the image and the text positions can be picked and are previewed (1.1)', async ({ page }) => {
    const name = uniqueName('Where');
    await openAdmin(page, 'openlabel/label/new');
    await page.fill('input[name="name"]', name);
    await page.locator('.ol-design-tile').first().click();
    const picker = page.locator('[data-index="placements"] [data-role="ol-position-picker"]').first();
    await expect(picker.locator('button[data-position]')).toHaveCount(21);
    await picker.locator('[data-position="tc"]').click();
    await picker.locator('[data-position="tc"]').press('ArrowUp');
    await expect(picker.locator('[data-position="above_c"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.ol-preview__image-wrap .ol-pos-otc')).toHaveCount(1);

    const inline = page.locator('[data-index="placements"] [data-role="ol-position-inline"]').first();
    await inline.locator('[data-position="near_price"]').click();
    await expect(inline.locator('[data-position="near_price"]')).toHaveAttribute('aria-checked', 'true');
    await expect(picker.locator('[aria-checked="true"]')).toHaveCount(0);
    await expect(page.locator('.ol-preview__price .ol-inline--near-price [data-role="ol-preview-label"]')).toHaveCount(1);
    await expect(page.locator('.ol-preview__image-wrap .ol-stack')).toHaveCount(0);

    await page.locator('.page-actions-buttons').getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.locator('.message-success')).toContainText('The label was saved.');
    expect(sql(`SELECT p.position FROM openlabel_placement p JOIN openlabel_label l ON l.label_id = p.label_id WHERE l.name = '${name}'`)[0][0])
      .toBe('near_price');
    await expect(page.locator('.data-row').filter({ hasText: name })).toContainText('next to the price');
  });

  test('item lists are offered as pages and always show labels next to the item (1.1)', async ({ page }) => {
    const name = uniqueName('Where');
    await openAdmin(page, 'openlabel/label/new');
    await page.fill('input[name="name"]', name);
    await page.locator('.ol-design-tile').first().click();
    const area = page.locator('select[name="placements[0][area]"]');
    for (const option of ['Shopping cart', 'Mini cart', 'Wish list', 'Compare products', 'Order emails']) {
      await expect(area.locator('option', { hasText: option })).toHaveCount(1);
    }
    await area.selectOption('cart');
    await page.locator('.page-actions-buttons').getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.locator('.message-success')).toContainText('The label was saved.');
    expect(sql(`SELECT p.area, p.position FROM openlabel_placement p JOIN openlabel_label l ON l.label_id = p.label_id WHERE l.name = '${name}'`)[0])
      .toEqual(['cart', 'under_name']);
  });
});
