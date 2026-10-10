import { expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Admin credentials from the gitignored admin.env at the repository root (or ADMIN_USER / ADMIN_PASSWORD). */
export function adminCredentials(): { user: string; password: string } {
  let env: Record<string, string> = {};
  try {
    const text = readFileSync(resolve(__dirname, '../../../admin.env'), 'utf8');
    env = Object.fromEntries(
      text.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    // fall back to the environment
  }
  const user = process.env.ADMIN_USER ?? env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD ?? env.ADMIN_PASSWORD;
  if (!user || !password) {
    throw new Error('Admin credentials missing: create admin.env from admin.env.example or set ADMIN_USER/ADMIN_PASSWORD');
  }
  return { user, password };
}

export const AUTH_FILE = resolve(__dirname, '../../.auth/admin.json');

/** Waits until the admin UI-component spinner is gone. */
export async function waitForAdmin(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.admin__data-grid-loading-mask:visible, .loading-mask:visible')).toHaveCount(0, { timeout: 30_000 });
}

/** Opens an admin route such as "openlabel/label/index" and waits for the UI components. */
export async function openAdmin(page: Page, route: string): Promise<void> {
  await page.goto(`/admin/${route}`);
  await waitForAdmin(page);
}

/** Unique, recognisable name for records created by a test. */
export function uniqueName(prefix: string): string {
  return `${prefix} e2e ${Date.now().toString(36)}`;
}

/**
 * Runs SQL against the fixture database through Warden (local fixture only). Returns tab-separated rows.
 */
export function sql(query: string): string[][] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  const out = execFileSync(
    'warden',
    ['env', 'exec', '-T', 'db', 'mysql', '-umagento', '-pmagento', 'magento', '-N', '-B', '-e', query],
    { cwd: resolve(__dirname, '../../..'), encoding: 'utf8' },
  );
  return out.trim() === '' ? [] : out.trim().split('\n').map((line) => line.split('\t'));
}

/** Creates a label directly in the database (one listing placement, first system design) and returns its id. */
export function seedLabel(name: string, status = 1): number {
  const rows = sql(
    `INSERT INTO openlabel_label (name, status, priority, design_id) SELECT '${name.replace(/'/g, "''")}', ${status}, 0, MIN(design_id) FROM openlabel_design WHERE is_system = 1;`
    + ' SET @id = LAST_INSERT_ID();'
    + " INSERT INTO openlabel_placement (label_id, area, position) VALUES (@id, 'listing', 'tr');"
    + ' SELECT @id;',
  );
  return Number(rows[rows.length - 1][0]);
}

/** Removes labels created by end-to-end tests. */
export function deleteE2eLabels(): void {
  sql("DELETE FROM openlabel_label WHERE name LIKE '% e2e %';");
}
