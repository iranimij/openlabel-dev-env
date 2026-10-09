import { Page } from '@playwright/test';

/** Collects Content-Security-Policy violations reported by the browser console on a page. */
export function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to (load|execute|apply)/i.test(text)) {
      violations.push(text);
    }
  });
  return violations;
}

/** First product URL on the given category page, read from the product card link. */
export async function firstProductUrl(page: Page, categoryPath: string): Promise<string> {
  await page.goto(categoryPath);
  const href = await page.locator('.product-item a.product-item-photo').first().getAttribute('href');
  if (!href) {
    throw new Error(`No product card link found on ${categoryPath}`);
  }
  return href;
}
