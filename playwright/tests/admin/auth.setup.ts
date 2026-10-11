import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { adminCredentials, AUTH_FILE, dismissAdminPopups } from './admin';

setup('log in to the admin once and keep the session', async ({ page }) => {
  const { user, password } = adminCredentials();
  await page.goto('/admin');
  await page.fill('#username', user);
  await page.fill('#login', password);
  await page.click('.action-login');
  await expect(page.locator('#menu-magento-backend-dashboard')).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await dismissAdminPopups(page);
  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});
