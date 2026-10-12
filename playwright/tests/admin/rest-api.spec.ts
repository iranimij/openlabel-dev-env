import { test, expect, APIRequestContext } from '@playwright/test';
import { adminCredentials, sql } from './admin';
import { cleanupStorefront, fixtureName, magento } from '../storefront/storefront';

/**
 * REST API for labels and designs (1.1), over real HTTP with an admin token: create a design and a label, see the
 * label on the storefront, read it back and send it back changed, delete both. Built-in designs stay locked and a
 * request without a token is refused.
 */
const tag = 'rest-api';
const text = 'E2E REST';
const TOTE = { sku: '24-WB05', search: '/catalogsearch/result/?q=Savvy+Shoulder+Tote' };

test.describe.configure({ mode: 'serial' });

let token = '';

async function api(request: APIRequestContext, method: string, path: string, data?: unknown) {
  const response = await request.fetch(`/rest/V1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status(), body: await response.json() };
}

test.beforeAll(async ({ request }) => {
  cleanupStorefront(tag);
  const { user, password } = adminCredentials();
  const response = await request.post('/rest/V1/integration/admin/token', { data: { username: user, password } });
  expect(response.status()).toBe(200);
  token = await response.json();
});

test.afterAll(() => {
  cleanupStorefront(tag);
  magento('cache:clean', 'full_page');
});

test('without a token the API refuses', async ({ request }) => {
  const response = await request.get('/rest/V1/openlabel/labels?searchCriteria[pageSize]=1');
  expect(response.status()).toBe(401);
});

test('a label created through the API shows on the storefront, can be changed and deleted', async ({ request, page }) => {
  const design = await api(request, 'POST', '/openlabel/designs', {
    design: {
      name: fixtureName(tag, 'Design'), type: 'shape', shape: 'pill', bg_color: '#1d4ed8', text_color: '#ffffff', width: 24,
      store_texts: { 0: { text, tooltip: 'Made over REST' } },
    },
  });
  expect(design.status).toBe(200);
  const designId: number = design.body.design_id;

  const conditions = JSON.stringify({
    type: 'Iranimij\\OpenLabel\\Model\\Rule\\Condition\\Combine', aggregator: 'all', value: '1',
    conditions: [{ type: 'Iranimij\\OpenLabel\\Model\\Rule\\Condition\\Product', attribute: 'sku', operator: '==', value: TOTE.sku }],
  });
  const created = await api(request, 'POST', '/openlabel/labels', {
    label: {
      name: fixtureName(tag, 'Label'), status: 1, priority: 1, design_id: designId, conditions_serialized: conditions,
      placements: [{ area: 'listing', position: 'tr' }],
    },
  });
  expect(created.status).toBe(200);
  const labelId: number = created.body.label_id;
  expect(sql(`SELECT COUNT(*) FROM openlabel_index WHERE label_id = ${labelId}`)[0][0]).not.toBe('0');

  await page.goto(TOTE.search);
  await expect(page.locator('.ol-label', { hasText: text }).first()).toBeVisible();

  const listed = await api(
    request,
    'GET',
    `/openlabel/labels?searchCriteria[filterGroups][0][filters][0][field]=label_id&searchCriteria[filterGroups][0][filters][0][value]=${labelId}`,
  );
  expect(listed.status).toBe(200);
  expect(listed.body.total_count).toBe(1);

  const read = await api(request, 'GET', `/openlabel/labels/${labelId}`);
  expect(read.body.placements[0].position).toBe('tr');
  const renamed = fixtureName(tag, 'Renamed');
  const updated = await api(request, 'PUT', `/openlabel/labels/${labelId}`, { label: { ...read.body, name: renamed } });
  expect(updated.status).toBe(200);
  expect((await api(request, 'GET', `/openlabel/labels/${labelId}`)).body.name).toBe(renamed);

  expect((await api(request, 'DELETE', `/openlabel/labels/${labelId}`)).body).toBe(true);
  expect((await api(request, 'GET', `/openlabel/labels/${labelId}`)).status).toBe(404);
  expect((await api(request, 'DELETE', `/openlabel/designs/${designId}`)).body).toBe(true);
});

test('built-in designs are locked over the API too', async ({ request }) => {
  const builtIn = Number(sql('SELECT MIN(design_id) FROM openlabel_design WHERE is_system = 1;')[0][0]);
  const read = await api(request, 'GET', `/openlabel/designs/${builtIn}`);
  expect(read.body.system).toBe(true);

  const changed = await api(request, 'PUT', `/openlabel/designs/${builtIn}`, { design: { ...read.body, name: 'Changed' } });
  expect(changed.status).toBe(400);
  expect(changed.body.message).toContain('Built-in designs are locked');
  expect((await api(request, 'DELETE', `/openlabel/designs/${builtIn}`)).status).toBe(400);
});
