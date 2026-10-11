import { test, expect } from '@playwright/test';
import { collectCspViolations } from '../helpers';
import {
  BAG, Persona, cardLabels, cleanupStorefront, ensureCustomers, fixtureName, galleryLabels, loginAs, magento,
  seedDesign, seedSkuLabel,
} from './storefront';

/**
 * M3 done-when: labels correct for three customer groups with Varnish on (FPC varies by group natively,
 * 06 · F1). Each group sees only its own label, on the listing and on the product page, from cached pages.
 */
test.describe.configure({ mode: 'serial' });

const TAG = 'groups';
const name = (n: string): string => fixtureName(TAG, n);
const TEXTS: Record<Persona, string> = { guest: 'E2E Guest', general: 'E2E General', wholesale: 'E2E Wholesale' };

test.beforeAll(() => {
  cleanupStorefront(TAG);
  ensureCustomers();
  seedSkuLabel(name('Guest only'), seedDesign(name('Guest'), TEXTS.guest), BAG.sku, { groups: [0] });
  seedSkuLabel(name('General only'), seedDesign(name('General'), TEXTS.general, '#166534'), BAG.sku, { groups: [1] });
  seedSkuLabel(name('Wholesale only'), seedDesign(name('Wholesale'), TEXTS.wholesale, '#6d28d9'), BAG.sku, { groups: [2] });
  magento('openlabel:css:regenerate');
});

test.afterAll(() => {
  cleanupStorefront(TAG);
});

for (const persona of ['guest', 'general', 'wholesale'] as Persona[]) {
  test(`${persona} sees only its label on listing and product page, twice (second from cache)`, async ({ page }) => {
    const csp = collectCspViolations(page);
    await loginAs(page, persona);

    for (let visit = 1; visit <= 2; visit++) {
      const listing = await page.goto(BAG.category);
      expect(await cardLabels(page, BAG.path)).toEqual([TEXTS[persona]]);
      if (visit === 2) {
        expect(listing?.headers()['x-cache'] ?? '', 'listing served by Varnish on the second visit').toMatch(/HIT/);
      }
      await page.goto(BAG.path);
      expect(await galleryLabels(page)).toEqual([TEXTS[persona]]);
    }
    expect(csp).toEqual([]);
  });
}
