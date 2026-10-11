import { defineConfig, devices } from '@playwright/test';

/**
 * Fixture store: https://app.openlabel.test (override with BASE_URL). The store runs behind Varnish with
 * a self-signed certificate, so HTTPS errors are ignored. CSP violations are collected per test.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'https://app.openlabel.test',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Storefront projects start after the admin project: the empty-state acceptance spec needs an empty label
    // table, and storefront specs seed their own labels.
    { name: 'desktop-chromium', testIgnore: /admin\//, dependencies: ['admin-chromium'], use: { ...devices['Desktop Chrome'] } },
    // Storefront specs that seed the database run once (desktop); read-only checks also run on mobile.
    {
      name: 'mobile-chromium',
      testIgnore: /admin\/|storefront\/(?!.*\.mobile\.spec)/,
      dependencies: ['admin-chromium'],
      use: { ...devices['Pixel 7'] },
    },
    // Admin specs: one login (auth.setup.ts), desktop only, serial because they share the fixture database.
    { name: 'admin-setup', testMatch: /admin\/auth\.setup\.ts/ },
    {
      name: 'admin-chromium',
      testMatch: /admin\/.*\.spec\.ts/,
      dependencies: ['admin-setup'],
      fullyParallel: false,
      // One admin session for all specs: parallel workers would contend for its Redis session lock.
      workers: 1,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: '.auth/admin.json' },
    },
  ],
});
