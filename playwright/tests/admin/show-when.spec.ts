import { test, expect } from '@playwright/test';
import { deleteE2eLabels, openAdmin, sql, uniqueName } from './admin';

test.describe('label form · show when', () => {
  test.afterAll(() => deleteE2eLabels());

  test('switching on "On sale" with a minimum discount matches products', async ({ page }) => {
    const name = uniqueName('Quick sale');
    await openAdmin(page, 'openlabel/label/new');
    await page.fill('input[name="name"]', name);
    await page.locator('.ol-design-tile').first().click();
    await page.locator('[data-index="on_sale"] .admin__actions-switch-label').click();
    await page.fill('input[name="quick[on_sale_min]"]', '5');
    await page.locator('.page-actions-buttons').getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.locator('.message-success')).toContainText('The label was saved.');
    const id = sql(`SELECT label_id FROM openlabel_label WHERE name = '${name}'`)[0][0];
    const matched = Number(sql(`SELECT COUNT(DISTINCT product_id) FROM openlabel_index WHERE label_id = ${id}`)[0][0]);
    const all = Number(sql('SELECT COUNT(*) FROM catalog_product_entity')[0][0]);
    expect(matched).toBeGreaterThan(0);
    expect(matched).toBeLessThan(all);
    const conditions = sql(`SELECT conditions_serialized FROM openlabel_label WHERE label_id = ${id}`)[0][0];
    expect(conditions).toContain('discount_percent');
  });

  test('advanced conditions add a rule-tree row', async ({ page }) => {
    await openAdmin(page, 'openlabel/label/new');
    const tree = page.locator('#rule_conditions_fieldset');
    await expect(tree).toBeVisible();
    await tree.locator('.rule-param-new-child a').first().click();
    const select = tree.locator('select[name="rule[conditions][1][new_child]"]');
    await select.selectOption('Iranimij\\OpenLabel\\Model\\Rule\\Condition\\Product|sku');
    await expect(tree.locator('input[name^="rule[conditions][1--1]"], [name="rule[conditions][1--1][type]"]').first()).toBeAttached();
    await expect(tree.locator('li').filter({ hasText: 'SKU' }).first()).toBeVisible();
  });

  test('quick switches together with an advanced category condition save and match (no error page)', async ({ page }) => {
    // Regression: the switches' SQL joins were lost next to a nested advanced tree ("Unknown column ol_price.price").
    const name = uniqueName('Switches and category');
    await openAdmin(page, 'openlabel/label/new');
    await page.fill('input[name="name"]', name);
    await page.locator('.ol-design-tile').first().click();
    await page.locator('[data-index="on_sale"] .admin__actions-switch-label').click();
    await page.fill('input[name="quick[on_sale_min]"]', '5');
    const tree = page.locator('#rule_conditions_fieldset');
    await tree.locator('.rule-param-new-child a').first().click();
    await tree.locator('select[name="rule[conditions][1][new_child]"]')
      .selectOption('Iranimij\\OpenLabel\\Model\\Rule\\Condition\\Product|category_ids');
    const row = tree.locator('li').filter({ hasText: 'Category' }).first();
    await row.getByText('...', { exact: true }).click();
    await row.locator('input[name="rule[conditions][1--1][value]"]').fill('2, 3, 7, 11, 20, 38');
    await page.locator('.page-actions-buttons').getByRole('button', { name: 'Save', exact: true }).first().click();

    await expect(page.locator('.message-success')).toContainText('The label was saved.');
    await expect(page.locator('.message-error')).toHaveCount(0);
    const id = sql(`SELECT label_id FROM openlabel_label WHERE name = '${name}'`)[0][0];
    const conditions = sql(`SELECT conditions_serialized FROM openlabel_label WHERE label_id = ${id}`)[0][0];
    expect(conditions).toContain('discount_percent');
    expect(conditions).toContain('category_ids');
    const matched = Number(sql(`SELECT COUNT(DISTINCT product_id) FROM openlabel_index WHERE label_id = ${id}`)[0][0]);
    expect(matched, 'discounted products in those categories').toBeGreaterThan(0);
  });
});
