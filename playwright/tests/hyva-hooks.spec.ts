import { test, expect, Page } from '@playwright/test';
import { firstProductUrl } from './helpers';

/**
 * Verifies the Hyvä 1.4 injection points OpenLabel relies on (docs/hyva-integration.md in the core repo):
 * the listing image anchor and the product gallery container, and that both can become CSS containers
 * (`container-type: inline-size`) without moving anything (10 · Front-end Review, FE3).
 */
const CATEGORY = '/women/tops-women.html';

type Box = { x: number; y: number; width: number; height: number };

async function boxesOf(page: Page, selector: string, limit = 12): Promise<Box[]> {
  return page.locator(selector).evaluateAll((els, max) =>
    els.slice(0, max).map((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    }),
    limit,
  );
}

test.describe('Hyvä 1.4 hooks for OpenLabel', () => {
  test('listing: image anchor wraps a bare <img> with width/height and the swatch-swap listener', async ({ page }) => {
    await page.goto(CATEGORY);
    const anchor = page.locator('.product-item a.product-item-photo').first();
    await expect(anchor).toBeVisible();
    const img = anchor.locator('> img');
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute('width', /\d+/);
    await expect(img).toHaveAttribute('height', /\d+/);
    expect(await anchor.locator('*').count(), 'anchor must contain only the image (no hook element to reuse)').toBe(1);
    await expect(anchor).toHaveCSS('display', 'block');
  });

  test('listing: no absolutely positioned elements inside the product card image area', async ({ page }) => {
    await page.goto(CATEGORY);
    const absoluteInCards = await page.locator('.product-item *').evaluateAll((els) =>
      els.filter((el) => getComputedStyle(el as HTMLElement).position === 'absolute').length,
    );
    expect(absoluteInCards).toBe(0);
  });

  test('listing: container-type inline-size on the image anchor does not shift layout', async ({ page }) => {
    await page.goto(CATEGORY);
    const selector = '.product-item a.product-item-photo, .product-item a.product-item-photo img, .product-item .product-info';
    const before = await boxesOf(page, selector);
    await page.addStyleTag({ content: '.product-item a.product-item-photo{container-type:inline-size}' });
    const after = await boxesOf(page, selector);
    expect(after).toEqual(before);
  });

  test('product page: #gallery-main is a relative block with a size-reserving placeholder image', async ({ page }) => {
    await page.goto(await firstProductUrl(page, CATEGORY));
    const gallery = page.locator('#gallery-main');
    await expect(gallery).toHaveCSS('position', 'relative');
    const placeholder = gallery.locator('> img').first();
    await expect(placeholder).toHaveAttribute('width', /\d+/);
    await expect(placeholder).toHaveAttribute('height', /\d+/);
    const box = await gallery.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(100);
  });

  test('product page: container-type inline-size on #gallery-main does not shift layout', async ({ page }) => {
    await page.goto(await firstProductUrl(page, CATEGORY));
    const selector = '#gallery-main, #gallery-main img, #thumbs, .product-info';
    const before = await boxesOf(page, selector);
    await page.addStyleTag({ content: '#gallery-main{container-type:inline-size}' });
    const after = await boxesOf(page, selector);
    expect(after).toEqual(before);
  });

  test('product page: Hyvä dispatches configurable-selection-changed on swatch selection', async ({ page }) => {
    await page.goto(CATEGORY);
    const configurableCard = page.locator('.product-item').filter({ has: page.locator('.swatch-option, [data-attribute-code]') }).first();
    const url = await configurableCard.locator('a.product-item-photo').getAttribute('href');
    test.skip(!url, 'no configurable product on the first listing page');
    await page.goto(url!);
    await page.evaluate(() => {
      (window as unknown as { __olEvents: string[] }).__olEvents = [];
      for (const name of ['configurable-selection-changed', 'update-gallery', 'reset-gallery']) {
        window.addEventListener(name, (e) => (window as unknown as { __olEvents: string[] }).__olEvents.push(name + ':' + JSON.stringify((e as CustomEvent).detail?.productIndex ?? null)));
      }
    });
    await page.locator('.swatch-attribute .swatch-option, [x-data*="initConfigurableSwatchOptions"] button, .product-option-values button').first().click();
    const events = await page.evaluate(() => (window as unknown as { __olEvents: string[] }).__olEvents);
    expect(events.some((e) => e.startsWith('configurable-selection-changed:'))).toBe(true);
  });
});
