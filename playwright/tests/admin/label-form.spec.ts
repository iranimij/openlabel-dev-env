import { test, expect, Page } from '@playwright/test';
import { deleteE2eLabels, openAdmin, sql, uniqueName } from './admin';

async function saveButton(page: Page) {
  return page.locator('.page-actions-buttons').getByRole('button', { name: 'Save', exact: true }).first();
}

test.describe('label form', () => {
  test.afterAll(() => deleteE2eLabels());

  test('a custom label with a design, a placement and dates is saved', async ({ page }) => {
    const name = uniqueName('Form');
    await openAdmin(page, 'openlabel/label/new');
    await expect(page.locator('.fieldset-wrapper-title').filter({ hasText: 'Show where' })).toBeVisible();
    await page.fill('input[name="name"]', name);
    await page.locator('.ol-design-tile').first().click();
    await expect(page.locator('.ol-design-tile').first()).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-index="placements"] [data-role="ol-position-picker"]').first().locator('[data-position="tr"]').click();
    await page.locator('.fieldset-wrapper-title').filter({ hasText: 'Who and when' }).click();
    // Type like a person (the datepicker parses keystrokes), then close it with Escape.
    for (const [field, value] of [['valid_from', '11/01/2026 12:00 AM'], ['valid_to', '11/30/2026 11:59 PM']]) {
      const input = page.locator(`input[name="${field}"]`);
      await input.click();
      await input.pressSequentially(value);
      await input.press('Escape');
      await input.dispatchEvent('change');
    }
    await page.locator('input[name="name"]').click();
    await (await saveButton(page)).click();
    await expect(page.locator('.message-success')).toContainText('The label was saved.');
    const row = sql(`SELECT l.valid_from, l.valid_to, p.position FROM openlabel_label l JOIN openlabel_placement p ON p.label_id = l.label_id WHERE l.name = '${name}'`)[0];
    expect(row[2]).toBe('tr');
    expect(row[0]).toMatch(/^2026-10-31 2[23]:00:00$/);
    expect(row[1]).toMatch(/^2026-11-30 2[23]:59:00$/);
  });

  test('missing placement is reported inline without leaving the form', async ({ page }) => {
    await openAdmin(page, 'openlabel/label/new');
    await page.fill('input[name="name"]', uniqueName('Nowhere'));
    await page.locator('.ol-design-tile').first().click();
    await page.locator('[data-index="placements"] button.action-delete').first().click();
    await (await saveButton(page)).click();
    await expect(page.locator('.messages, .message-error').filter({ hasText: 'Pick at least one placement so the label appears somewhere.' }).first())
      .toBeVisible();
    await expect(page).toHaveURL(/openlabel\/label\/new/);
  });

  test('Save & Duplicate opens a disabled copy', async ({ page }) => {
    const name = uniqueName('Dup');
    await openAdmin(page, 'openlabel/label/new');
    await page.fill('input[name="name"]', name);
    await page.locator('.ol-design-tile').first().click();
    await page.locator('.page-actions-buttons button.action-toggle').first().click();
    await page.locator('#save_and_duplicate').click();
    await expect(page.locator('.message-success').filter({ hasText: 'disabled copy' })).toBeVisible();
    await expect(page.locator('input[name="name"]')).toHaveValue(`${name} (copy)`);
    expect(sql(`SELECT status FROM openlabel_label WHERE name = '${name} (copy)'`)[0][0]).toBe('0');
  });
});
