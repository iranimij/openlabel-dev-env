import { test, expect, Page } from '@playwright/test';
import { firstProductUrl } from './helpers';
import { isHyva15Gallery } from './fixture';

/**
 * Verifies the Hyvä injection points (1.4 and 1.5) OpenLabel relies on (docs/hyva-integration.md in the core repo):
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

test.describe('Hyvä hooks for OpenLabel', () => {
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

  test('listing: nothing absolutely positioned overlaps the product image', async ({ page }) => {
    await page.goto(CATEGORY);
    await page.locator('.product-item a.product-item-photo img').first().waitFor();
    // Hyvä positions swatch radio inputs absolutely (under the swatch buttons) and uses `sr-only` helpers;
    // neither touches the image area. Anything that does would collide with label positions (FE5).
    const offenders = await page.locator('.product-item').evaluateAll((cards) => {
      const hits: string[] = [];
      for (const card of cards) {
        const image = card.querySelector('a.product-item-photo');
        if (!image) continue;
        const area = image.getBoundingClientRect();
        for (const el of Array.from(card.querySelectorAll('*'))) {
          const style = getComputedStyle(el as HTMLElement);
          const r = (el as HTMLElement).getBoundingClientRect();
          const overlaps = r.width > 1 && r.height > 1 && r.left < area.right && r.right > area.left && r.top < area.bottom && r.bottom > area.top;
          if (style.position === 'absolute' && overlaps && !el.classList.contains('sr-only')) {
            hits.push(`${el.tagName.toLowerCase()}.${Array.from(el.classList).join('.')}`);
          }
        }
      }
      return hits;
    });
    expect(offenders).toEqual([]);
  });

  test('listing: container-type inline-size on the image anchor collapses it (so OpenLabel must not do that)', async ({ page }) => {
    await page.goto(CATEGORY);
    await page.locator('.product-item a.product-item-photo img').first().waitFor();
    const before = await boxesOf(page, '.product-item a.product-item-photo', 1);
    expect(before[0].width).toBeGreaterThan(50);
    await page.addStyleTag({ content: '.product-item a.product-item-photo{container-type:inline-size}' });
    const after = await boxesOf(page, '.product-item a.product-item-photo', 1);
    // The anchor is shrink-to-fit (mx-auto in a flex column): inline-size containment removes its only size source.
    expect(after[0].width).toBe(0);
  });

  test('listing: container-type inline-size on the product card does not shift layout', async ({ page }) => {
    await page.goto(CATEGORY);
    await page.waitForLoadState('networkidle');
    const selector = '.product-item, .product-item a.product-item-photo, .product-item a.product-item-photo img, .product-item .product-info';
    const before = await boxesOf(page, selector, 48);
    await page.addStyleTag({ content: '.product-item{container-type:inline-size}' });
    const after = await boxesOf(page, selector, 48);
    expect(after).toEqual(before);
  });

  test('product page: the gallery has a positioned box for the labels, sized before images load', async ({ page }) => {
    await page.goto(await firstProductUrl(page, CATEGORY));
    if (isHyva15Gallery()) {
      // Hyvä 1.5: #gallery-main is the scrolling track (data-track) inside the positioned #gallery > .relative.
      const wrapper = page.locator('#gallery > .relative');
      await expect(wrapper).toHaveCSS('position', 'relative');
      await expect(wrapper.locator('> #gallery-main[data-track]')).toHaveCount(1);
      const box = await wrapper.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThan(100);
      expect(box?.width ?? 0).toBeGreaterThan(100);
      return;
    }
    const gallery = page.locator('#gallery-main');
    await expect(gallery).toHaveCSS('position', 'relative');
    const placeholder = gallery.locator('> img').first();
    await expect(placeholder).toHaveAttribute('width', /\d+/);
    await expect(placeholder).toHaveAttribute('height', /\d+/);
    const box = await gallery.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(100);
  });

  test('product page: container-type inline-size on the label container root does not shift layout', async ({ page }) => {
    await page.goto(await firstProductUrl(page, CATEGORY));
    // OpenLabel's root: #gallery-main on Hyvä 1.3/1.4, the #gallery section on 1.5 (openlabel-hyva CSS).
    const root = isHyva15Gallery() ? '#gallery' : '#gallery-main';
    const selector = `${root}, #gallery-main, #gallery-main img, #thumbs, .product-info`;
    const before = await boxesOf(page, selector);
    await page.addStyleTag({ content: `${root}{container-type:inline-size}` });
    const after = await boxesOf(page, selector);
    expect(after).toEqual(before);
  });

  test('product page: Hyvä dispatches configurable-selection-changed on swatch selection', async ({ page }) => {
    // Radiant Tee is a configurable product from the Magento sample data.
    await page.goto('/radiant-tee.html');
    await page.evaluate(() => {
      (window as unknown as { __olEvents: string[] }).__olEvents = [];
      for (const name of ['configurable-selection-changed', 'update-gallery', 'reset-gallery']) {
        window.addEventListener(name, (e) => (window as unknown as { __olEvents: string[] }).__olEvents.push(name + ':' + JSON.stringify((e as CustomEvent).detail?.productIndex ?? null)));
      }
    });
    // Options are rendered by Alpine once the swatch block is in the viewport (x-defer), so scroll first.
    // Hyvä 1.4: role="radiogroup" named "Size"; 1.5: a fieldset whose legend reads "Size:".
    const group = page.getByRole('radiogroup', { name: 'Size' }).or(page.getByRole('group', { name: /^Size/ })).first();
    await group.scrollIntoViewIfNeeded();
    const swatch = group.locator('label').first();
    await swatch.waitFor();
    await swatch.click();
    await page.waitForTimeout(300);
    const events = await page.evaluate(() => (window as unknown as { __olEvents: string[] }).__olEvents);
    expect(events.some((e) => e.startsWith('configurable-selection-changed:'))).toBe(true);
  });
});
