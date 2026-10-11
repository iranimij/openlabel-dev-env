import { test, expect, Page } from '@playwright/test';
import { openAdmin, sql } from './admin';

const preview = (page: Page) => page.locator('[data-role="ol-live-preview"]');
const badge = (page: Page) => preview(page).locator('[data-role="ol-preview-label"]').first();

async function pickDesign(page: Page, name: string): Promise<void> {
  await page.locator('.ol-design-tile').filter({ hasText: name }).first().click();
}

test.describe('label form · live preview', () => {
  test.beforeAll(() => {
    sql("DELETE FROM openlabel_design WHERE name = 'Yellow e2e contrast';"
      + " INSERT INTO openlabel_design (name, type, shape, bg_color, text_color, size_mode, width) VALUES ('Yellow e2e contrast', 'shape', 'pill', '#facc15', '#ffffff', 'percent', 24);"
      + " INSERT INTO openlabel_design_store (design_id, store_id, text) VALUES (LAST_INSERT_ID(), 0, 'Hot');");
  });
  test.afterAll(() => sql("DELETE FROM openlabel_design WHERE name = 'Yellow e2e contrast';"));

  test('shows the chosen design with sample values and follows the position', async ({ page }) => {
    await openAdmin(page, 'openlabel/label/new');
    await expect(preview(page)).toBeVisible();
    await pickDesign(page, 'Sale pill (red)');
    await expect(badge(page)).toHaveText('Sale -25%');
    await expect(badge(page)).toHaveCSS('background-color', 'rgb(185, 28, 28)');
    const stack = preview(page).locator('.ol-stack').first();
    await expect(stack).toHaveClass(/ol-pos-ts/);
    await page.locator('[data-index="placements"] [data-role="ol-position-picker"]').first().locator('[data-position="br"]').click();
    await expect(stack).toHaveClass(/ol-pos-be/);
    const img = await preview(page).locator('.ol-preview__image').boundingBox();
    const b = await badge(page).boundingBox();
    expect(b!.x + b!.width).toBeGreaterThan(img!.x + img!.width * 0.6);
    expect(b!.y + b!.height).toBeGreaterThan(img!.y + img!.height * 0.6);
  });

  test('mobile view scales the badge and keeps it clear of add to cart', async ({ page }) => {
    await openAdmin(page, 'openlabel/label/new');
    await pickDesign(page, 'Sale pill (red)');
    const desktop = (await badge(page).boundingBox())!.width;
    await preview(page).getByRole('button', { name: 'Mobile' }).click();
    await expect(preview(page).getByRole('button', { name: 'Mobile' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await badge(page).boundingBox())!.width).toBeLessThan(desktop);
    const logical: Record<string, string> = { tl: 'ts', tr: 'te', bl: 'bs', br: 'be', bc: 'bc' };
    for (const position of ['tl', 'tr', 'bl', 'br', 'bc']) {
      await page.locator('[data-index="placements"] [data-role="ol-position-picker"]').first().locator(`[data-position="${position}"]`).click();
      // Measure only after the preview re-rendered the stack at the new position.
      await expect(preview(page).locator('.ol-stack').first()).toHaveClass(new RegExp(`ol-pos-${logical[position]}`));
      const b = (await badge(page).boundingBox())!;
      const cart = (await preview(page).locator('[data-role="ol-preview-cart"]').boundingBox())!;
      const overlaps = b.x < cart.x + cart.width && b.x + b.width > cart.x && b.y < cart.y + cart.height && b.y + b.height > cart.y;
      expect(overlaps, `badge at ${position} must not cover add to cart`).toBe(false);
    }
  });

  test('warns about white text on yellow', async ({ page }) => {
    await openAdmin(page, 'openlabel/label/new');
    await pickDesign(page, 'Yellow e2e contrast');
    await expect(preview(page).locator('[data-role="ol-preview-contrast"]')).toContainText('hard to read');
    await pickDesign(page, 'Sale pill (red)');
    await expect(preview(page).locator('[data-role="ol-preview-contrast"]')).toBeHidden();
  });

  test('"Preview as" shows when a customer group would not see the label', async ({ page }) => {
    await openAdmin(page, 'openlabel/label/new');
    await pickDesign(page, 'Sale pill (red)');
    await page.locator('.fieldset-wrapper-title').filter({ hasText: 'Who and when' }).click();
    await page.locator('select[name="customer_group_ids"]').selectOption(['2']);
    await preview(page).locator('select[data-role="ol-preview-group"]').selectOption({ label: 'NOT LOGGED IN' });
    await expect(preview(page).locator('[data-role="ol-preview-hidden"]')).toContainText('hidden for this customer group');
    await preview(page).locator('select[data-role="ol-preview-group"]').selectOption({ label: 'Wholesale' });
    await expect(preview(page).locator('[data-role="ol-preview-hidden"]')).toBeHidden({ timeout: 15_000 });
    await expect(badge(page)).toBeVisible({ timeout: 15_000 });
  });
});
