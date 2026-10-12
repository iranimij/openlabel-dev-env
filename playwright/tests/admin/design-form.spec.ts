import { test, expect, Page } from '@playwright/test';
import { openAdmin, sql, uniqueName } from './admin';

async function newDesign(page: Page): Promise<void> {
  await openAdmin(page, 'openlabel/design/new');
  await expect(page.locator('.ol-type-cards')).toBeVisible();
}

async function setColour(page: Page, name: string, hex: string): Promise<void> {
  const input = page.locator(`input[name="${name}"]`);
  await input.fill(hex);
  await input.dispatchEvent('change');
}

test.describe('design form', () => {
  test.afterAll(() => sql("DELETE FROM openlabel_design WHERE name LIKE '% e2e %';"));

  test('type cards switch the visible sections', async ({ page }) => {
    await newDesign(page);
    await page.locator('.ol-type-card[data-type="image"]').click();
    await expect(page.locator('.ol-type-card[data-type="image"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.fieldset-wrapper[data-index="image"]')).toBeVisible();
    await expect(page.locator('.fieldset-wrapper[data-index="text"]')).toBeHidden();
    await page.locator('.ol-type-card[data-type="shape"]').click();
    await expect(page.locator('.fieldset-wrapper[data-index="text"]')).toBeVisible();
    await expect(page.locator('.fieldset-wrapper[data-index="shape"]')).toBeVisible();
  });

  test('contrast badge warns for white text on yellow and passes for dark text', async ({ page }) => {
    await newDesign(page);
    await setColour(page, 'bg_color', '#facc15');
    await setColour(page, 'text_color', '#ffffff');
    const badge = page.locator('[data-role="ol-contrast"] .ol-contrast__badge');
    await expect(badge).toHaveAttribute('data-level', 'fail');
    await expect(badge).toContainText('too low');
    await setColour(page, 'text_color', '#1f2937');
    await expect(badge).toHaveAttribute('data-level', 'pass');
  });

  test('a text design with a variable is created and appears in the grid', async ({ page }) => {
    const name = uniqueName('Design');
    await newDesign(page);
    await page.fill('input[name="name"]', name);
    await page.locator('.ol-type-card[data-type="shape"]').click();
    const text = page.locator('.ol-text-vars input.admin__control-text');
    await text.fill('Sale');
    await page.locator('[data-role="ol-variable-picker"]').selectOption('{SAVE_PERCENT}');
    await expect(text).toHaveValue('Sale {SAVE_PERCENT}');
    await expect(page.locator('[data-role="ol-char-counter"]')).toContainText('19 / 24');
    await setColour(page, 'bg_color', '#b91c1c');
    await setColour(page, 'text_color', '#ffffff');
    await page.locator('.page-actions-buttons').getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.locator('.message-success')).toContainText('The design was saved.');
    await expect(page.locator('.data-row').filter({ hasText: name })).toBeVisible();
    expect(sql(`SELECT s.text FROM openlabel_design d JOIN openlabel_design_store s ON s.design_id = d.design_id AND s.store_id = 0 WHERE d.name = '${name}'`)[0][0])
      .toBe('Sale {SAVE_PERCENT}');
  });

  test('image upload shows the dimensions of the file', async ({ page }) => {
    await newDesign(page);
    await page.locator('.ol-type-card[data-type="image"]').click();
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'e2e-badge.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="32"><rect width="96" height="32" rx="16" fill="#b91c1c"/></svg>'),
    });
    await expect(page.locator('[data-role="ol-image-meta"]')).toContainText('96 × 32 px');
  });

  test('motion and per-screen sizes are saved (1.1)', async ({ page }) => {
    const name = uniqueName('Design');
    await newDesign(page);
    await page.fill('input[name="name"]', name);
    await page.locator('.ol-type-card[data-type="shape"]').click();
    await page.locator('.ol-text-vars input.admin__control-text').fill('Hot');
    await setColour(page, 'bg_color', '#b91c1c');
    await setColour(page, 'text_color', '#ffffff');
    await page.fill('input[name="store_texts[0][tooltip]"]', 'Ends Sunday');
    await page.locator('.fieldset-wrapper[data-index="motion"] .fieldset-wrapper-title').click();
    await page.locator('select[name="animation"]').selectOption('pop');
    await page.locator('select[name="hover_effect"]').selectOption('grow');
    await page.locator('.fieldset-wrapper[data-index="size"] .fieldset-wrapper-title').click();
    await page.locator('input[name="sizes[sm][width]"]').fill('30');
    await page.locator('input[name="sizes[sm][font_size]"]').fill('12');
    await page.locator('.page-actions-buttons').getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.locator('.message-success')).toContainText('The design was saved.');
    expect(sql(`SELECT animation, hover_effect, sizes FROM openlabel_design WHERE name = '${name}'`)[0])
      .toEqual(['pop', 'grow', '{"sm":{"width":30,"font_size":12}}']);
    expect(sql(`SELECT s.tooltip FROM openlabel_design d JOIN openlabel_design_store s ON s.design_id = d.design_id AND s.store_id = 0 WHERE d.name = '${name}'`)[0][0])
      .toBe('Ends Sunday');
  });

  test('an AVIF image is accepted with its dimensions (1.1)', async ({ page }) => {
    await newDesign(page);
    await page.locator('.ol-type-card[data-type="image"]').click();
    const ispe = Buffer.alloc(20);
    ispe.writeUInt32BE(20, 0); ispe.write('ispe', 4); ispe.writeUInt32BE(120, 12); ispe.writeUInt32BE(40, 16);
    const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 28]), Buffer.from('ftypavif'), Buffer.alloc(4), Buffer.from('mif1miafMA1B')]);
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'e2e-badge.avif',
      mimeType: 'image/avif',
      buffer: Buffer.concat([ftyp, ispe, Buffer.alloc(64)]),
    });
    await expect(page.locator('[data-role="ol-image-meta"]')).toContainText('120 × 40 px');
  });

  test('built-in designs are locked with a Duplicate to edit button', async ({ page }) => {
    const id = sql('SELECT MIN(design_id) FROM openlabel_design WHERE is_system = 1')[0][0];
    await openAdmin(page, `openlabel/design/edit/id/${id}`);
    await expect(page.locator('.ol-locked-notice')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Duplicate to edit' })).toBeVisible();
  });
});
