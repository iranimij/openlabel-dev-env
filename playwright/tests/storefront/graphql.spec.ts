import { test, expect, APIRequestContext } from '@playwright/test';
import {
  CUSTOMER_PASSWORD, Persona, cleanupStorefront, customerEmail, ensureCustomers, fixtureName, seedDesign, seedSkuLabel,
} from './storefront';

/**
 * M4 S1: `openlabel_labels` on ProductInterface through the real stack (nginx, Varnish, GraphQL GET cache).
 * Each customer group gets its own label, also from cached GET responses, and the data is structured, never HTML.
 */
test.describe.configure({ mode: 'serial' });

const TAG = 'graphql';
// A product in no category the other storefront specs visit: seeding labels purges its pages, which must not
// turn another spec's second (cached) visit into a Varnish MISS.
const SKU = 'MH01';
const name = (n: string): string => fixtureName(TAG, n);
const TEXTS: Record<Persona, string> = { guest: 'GQL Guest', general: 'GQL General', wholesale: 'GQL Wholesale' };
const QUERY = `{ products(filter: { sku: { eq: "${SKU}" } }) { items { sku openlabel_labels {`
  + ' id name type text image_url alt position area css_class bg_color text_color priority } } } }';

test.beforeAll(() => {
  cleanupStorefront(TAG);
  ensureCustomers();
  seedSkuLabel(name('Guest only'), seedDesign(name('Guest'), TEXTS.guest), SKU, { groups: [0], position: 'tl' });
  seedSkuLabel(name('General only'), seedDesign(name('General'), TEXTS.general, '#166534'), SKU, { groups: [1] });
  seedSkuLabel(name('Wholesale only'), seedDesign(name('Wholesale'), TEXTS.wholesale, '#6d28d9'), SKU, { groups: [2] });
});

test.afterAll(() => {
  cleanupStorefront(TAG);
});

async function token(request: APIRequestContext, persona: Persona): Promise<string | null> {
  if (persona === 'guest') {
    return null;
  }
  const response = await request.post('/graphql', {
    data: {
      query: `mutation { generateCustomerToken(email: "${customerEmail(persona)}", password: "${CUSTOMER_PASSWORD}") { token } }`,
    },
  });
  const body = await response.json();
  expect(body.errors, JSON.stringify(body.errors)).toBeUndefined();
  return body.data.generateCustomerToken.token as string;
}

for (const persona of ['guest', 'general', 'wholesale'] as Persona[]) {
  test(`${persona} gets only its label from GraphQL, also from the GET cache`, async ({ request }) => {
    const bearer = await token(request, persona);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Store: 'default' };
    if (bearer) {
      headers.Authorization = `Bearer ${bearer}`;
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await request.get('/graphql', { params: { query: QUERY }, headers });
      expect(response.ok()).toBe(true);
      const body = await response.json();
      expect(body.errors, JSON.stringify(body.errors)).toBeUndefined();
      // Like a headless client: send back the cache id, so Varnish may serve customers from the cache too.
      const cacheId = response.headers()['x-magento-cache-id'];
      if (cacheId) {
        headers['X-Magento-Cache-Id'] = cacheId;
      }
      const labels = body.data.products.items[0].openlabel_labels as Array<Record<string, unknown>>;
      expect([...new Set(labels.map((label) => label.text))]).toEqual([TEXTS[persona]]);
      for (const label of labels) {
        expect(label.type).toBe('text');
        expect(String(label.css_class)).toMatch(/^ol-label ol-label--text ol-d-\d+ ol-shape-pill$/);
        expect(String(label.text)).not.toMatch(/</);
        expect(['listing', 'product']).toContain(label.area);
      }
      if (attempt === 3) {
        expect(response.headers()['x-cache'] ?? '', 'third GET (with the cache id) served by Varnish').toMatch(/HIT/);
      }
    }
  });
}
