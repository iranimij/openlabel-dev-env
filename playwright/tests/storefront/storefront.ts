import { createHash, randomBytes } from 'node:crypto';
import { Page, expect } from '@playwright/test';
import { magento, sql } from '../fixture';

/** Storefront fixtures for M3 (SQL and bin/magento through ../fixture: Warden locally, plain shell in CI). */

export const BAG = { sku: '24-MB01', path: '/joust-duffle-bag.html', category: '/gear/bags.html' };
export const GROUPS = { guest: 0, general: 1, wholesale: 2 } as const;
export type Persona = keyof typeof GROUPS;
export const CUSTOMER_PASSWORD = 'E2e-OpenLabel-1';

export { magento } from '../fixture';

function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** A text design with a store-0 text, not a system design. */
export function seedDesign(name: string, text: string, bg = '#1d4ed8'): number {
  const rows = sql(
    'INSERT INTO openlabel_design (name, type, shape, bg_color, text_color, size_mode, width, font_size, opacity, is_system)'
    + ` VALUES (${q(name)}, 'text', 'pill', '${bg}', '#ffffff', 'percent', 24, 14, 100, 0);`
    + ' SET @d = LAST_INSERT_ID();'
    + ` INSERT INTO openlabel_design_store (design_id, store_id, text) VALUES (@d, 0, ${q(text)});`
    + ' SELECT @d;',
  );
  return Number(rows[rows.length - 1][0]);
}

/**
 * A label for one SKU with listing + product placements, optionally limited to customer groups, then indexed
 * through the CLI (which also cleans the page cache, Varnish included).
 */
export function seedSkuLabel(
  name: string,
  designId: number,
  sku: string,
  options: { groups?: number[]; position?: string; pin?: boolean; reindex?: boolean } = {},
): number {
  const conditions = JSON.stringify({
    type: 'Iranimij\\OpenLabel\\Model\\Rule\\Condition\\Combine',
    aggregator: 'all',
    value: '1',
    conditions: [{
      type: 'Iranimij\\OpenLabel\\Model\\Rule\\Condition\\Product',
      attribute: 'sku',
      operator: '==',
      value: sku,
    }],
  });
  const position = options.position ?? 'tr';
  const pin = options.pin ? 1 : 0;
  const rows = sql(
    'INSERT INTO openlabel_label (name, status, priority, design_id, store_ids, customer_group_ids, conditions_serialized)'
    + ` VALUES (${q(name)}, 1, 5, ${designId}, '', ${q((options.groups ?? []).join(','))}, ${q(conditions)});`
    + ' SET @l = LAST_INSERT_ID();'
    + ' INSERT INTO openlabel_placement (label_id, area, position, pin_physical_side, max_labels)'
    + ` VALUES (@l, 'listing', '${position}', ${pin}, 3), (@l, 'product', '${position}', ${pin}, 3);`
    + ' SELECT @l;',
  );
  const id = Number(rows[rows.length - 1][0]);
  if (options.reindex !== false) {
    magento('openlabel:reindex', String(id));
  }
  return id;
}

/**
 * Fixture names carry `sfe2e-<tag>` (one tag per spec file; the admin specs' "% e2e %" cleanup never matches it),
 * so spec files running in parallel never delete each other's labels.
 */
export function fixtureName(tag: string, name: string): string {
  return `${name} sfe2e-${tag}`;
}

/**
 * Removes one spec file's labels and designs. Each label first gets a condition that matches nothing and is
 * reindexed, which purges exactly its products' pages (Varnish and block cache); no global cache flush, so specs
 * running in parallel keep their cached pages.
 */
export function cleanupStorefront(tag: string): void {
  const like = q(`%sfe2e-${tag}`);
  const ids = sql(`SELECT label_id FROM openlabel_label WHERE name LIKE ${like};`).map((row) => row[0]);
  if (ids.length > 0) {
    const nothing = JSON.stringify({
      type: 'Iranimij\\OpenLabel\\Model\\Rule\\Condition\\Combine',
      aggregator: 'all',
      value: '1',
      conditions: [{
        type: 'Iranimij\\OpenLabel\\Model\\Rule\\Condition\\Product',
        attribute: 'sku',
        operator: '==',
        value: '__openlabel_e2e_none__',
      }],
    });
    sql(`UPDATE openlabel_label SET conditions_serialized = ${q(nothing)} WHERE label_id IN (${ids.join(',')});`);
    for (const id of ids) {
      magento('openlabel:reindex', id);
    }
  }
  sql(
    `DELETE FROM openlabel_label WHERE name LIKE ${like};`
    + ` DELETE FROM openlabel_design WHERE name LIKE ${like} AND is_system = 0;`,
  );
}

/** Customers in General and Wholesale with a known password (sha256 hash, version 1; Magento upgrades it on login). */
export function ensureCustomers(): void {
  for (const persona of ['general', 'wholesale'] as const) {
    const salt = randomBytes(16).toString('hex');
    const hash = createHash('sha256').update(salt + CUSTOMER_PASSWORD).digest('hex');
    sql(
      'INSERT INTO customer_entity (website_id, email, group_id, store_id, created_in, firstname, lastname, password_hash, is_active)'
      + ` VALUES (1, '${customerEmail(persona)}', ${GROUPS[persona]}, 1, 'Default Store View', 'E2E', '${persona}', '${hash}:${salt}:1', 1)`
      + ` ON DUPLICATE KEY UPDATE group_id = ${GROUPS[persona]}, password_hash = '${hash}:${salt}:1';`,
    );
  }
}

export function customerEmail(persona: Persona): string {
  return `e2e-${persona}@openlabel.test`;
}

/** Logs a customer in through Hyvä's login form (guests do nothing). */
export async function loginAs(page: Page, persona: Persona): Promise<void> {
  if (persona === 'guest') {
    return;
  }
  await page.goto('/customer/account/login/');
  await page.locator('input[name="login[username]"]').fill(customerEmail(persona));
  await page.locator('#pass').fill(CUSTOMER_PASSWORD);
  await page.locator('button[name="send"]').click();
  await expect(page).toHaveURL(/customer\/account\/?$/);
}

/** Texts of the labels on one product card of a listing page. */
export async function cardLabels(page: Page, productPath: string): Promise<string[]> {
  const card = page.locator('.product-item', { has: page.locator(`a.product-item-photo[href$="${productPath}"]`) }).first();
  await expect(card).toBeVisible();
  return card.locator('.ol-label').allInnerTexts();
}

/** Texts of the labels inside the product page gallery. */
export async function galleryLabels(page: Page): Promise<string[]> {
  return page.locator('#gallery-main > .ol-stack .ol-label').allInnerTexts();
}
