// Lighthouse gate for M3 (04 · Roadmap: "Lighthouse and CLS unchanged vs. no module"; 10 · FE10):
// the same pages are measured with OpenLabel enabled and disabled, three viewports, three runs each (median).
// Asserts: CLS added by labels = 0.00, performance score not lower than the noise margin, exactly one OpenLabel
// stylesheet request and no OpenLabel script. Writes lighthouse-report/summary.{json,md}.
//
// Usage (local Warden fixture): node scripts/lh-compare.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const base = process.env.BASE_URL ?? 'https://app.openlabel.test';
const runs = Number(process.env.LH_RUNS ?? 3);
const pages = { listing: '/men/bottoms-men/pants-men.html', product: '/aether-gym-pant.html' };
const viewports = {
  mobile: { formFactor: 'mobile', screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false } },
  tablet: { formFactor: 'desktop', screenEmulation: { mobile: false, width: 820, height: 1180, deviceScaleFactor: 1, disabled: false } },
  desktop: { formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false } },
};
const SCORE_MARGIN = 0.05; // Lighthouse noise on a local Docker fixture
const NAME = 'Lighthouse all products sfe2e-lighthouse';

function sh(file, args) {
  return execFileSync(file, args, { cwd: root, encoding: 'utf8' });
}
// Same fixture modes as tests/fixture.ts: Warden locally, plain shell in CI (OL_FIXTURE=shell).
const shell = process.env.OL_FIXTURE === 'shell';
function sql(query) {
  return (shell
    ? execFileSync('mysql', ['-h', process.env.DB_HOST ?? '127.0.0.1', '-u', process.env.DB_USER ?? 'magento',
      `-p${process.env.DB_PASSWORD ?? 'magento'}`, process.env.DB_NAME ?? 'magento', '-N', '-B', '-e', query], { encoding: 'utf8' })
    : sh('warden', ['env', 'exec', '-T', 'db', 'mysql', '-umagento', '-pmagento', 'magento', '-N', '-B', '-e', query])).trim();
}
function magento(...args) {
  return shell
    ? execFileSync('php', ['bin/magento', ...args], { cwd: process.env.MAGENTO_ROOT ?? root, encoding: 'utf8' })
    : sh('warden', ['env', 'exec', '-T', 'php-fpm', 'bin/magento', ...args]);
}
function setEnabled(on) {
  magento('config:set', 'openlabel/general/enabled', on ? '1' : '0');
  magento('cache:flush');
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** A label on every product: every card and every gallery carries one (worst case for layout shift). */
function seed() {
  sql(`DELETE FROM openlabel_label WHERE name = '${NAME}'`);
  const id = sql(
    `INSERT INTO openlabel_label (name, status, priority, design_id, store_ids, customer_group_ids, conditions_serialized) `
    + `SELECT '${NAME}', 1, 9, MIN(design_id), '', '', NULL FROM openlabel_design WHERE is_system = 1; `
    + `SET @l = LAST_INSERT_ID(); `
    + `INSERT INTO openlabel_placement (label_id, area, position, max_labels) VALUES (@l, 'listing', 'tl', 3), (@l, 'product', 'tl', 3); `
    + `SELECT @l;`,
  ).split('\n').pop();
  magento('openlabel:reindex', id);
  magento('openlabel:css:regenerate');
  return id;
}
function unseed(id) {
  sql(`DELETE FROM openlabel_label WHERE label_id = ${Number(id)}`);
}

async function measure(chrome, url, viewport) {
  const result = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'] }, {
    extends: 'lighthouse:default',
    settings: { ...viewports[viewport], throttlingMethod: 'provided', disableStorageReset: false },
  });
  const lhr = result.lhr;
  const requests = lhr.audits['network-requests'].details.items.map((item) => item.url);
  return {
    score: lhr.categories.performance.score,
    cls: lhr.audits['cumulative-layout-shift'].numericValue,
    lcp: lhr.audits['largest-contentful-paint'].numericValue,
    olCss: requests.filter((u) => /\/media\/openlabel\/\d+\/openlabel\.[0-9a-f]{12}\.css/.test(u)).length,
    olJs: requests.filter((u) => /openlabel/i.test(new URL(u).pathname) && /\.js(\?|$)/.test(u)).length,
  };
}

async function series(chrome, label) {
  const out = {};
  for (const [page, path] of Object.entries(pages)) {
    for (const viewport of Object.keys(viewports)) {
      const url = base + path;
      await fetch(url).catch(() => undefined); // warm Varnish
      const samples = [];
      for (let i = 0; i < runs; i++) {
        samples.push(await measure(chrome, url, viewport));
      }
      out[`${page}/${viewport}`] = {
        score: median(samples.map((s) => s.score)),
        cls: median(samples.map((s) => s.cls)),
        lcp: median(samples.map((s) => s.lcp)),
        olCss: Math.max(...samples.map((s) => s.olCss)),
        olJs: Math.max(...samples.map((s) => s.olJs)),
      };
      console.log(label, page, viewport, JSON.stringify(out[`${page}/${viewport}`]));
    }
  }
  return out;
}

if (base.startsWith('https:')) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // the local fixture's self-signed certificate
}
const chrome = await chromeLauncher.launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ['--headless=new', '--ignore-certificate-errors', '--no-sandbox'],
});
const labelId = seed();
let on;
let off;
try {
  setEnabled(true);
  on = await series(chrome, 'on ');
  setEnabled(false);
  off = await series(chrome, 'off');
} finally {
  setEnabled(true);
  unseed(labelId);
  await chrome.kill();
}

const failures = [];
const rows = [];
for (const key of Object.keys(on)) {
  const a = on[key];
  const b = off[key];
  const clsDelta = a.cls - b.cls;
  const scoreDelta = a.score - b.score;
  rows.push(`| ${key} | ${b.score.toFixed(2)} → ${a.score.toFixed(2)} | ${b.cls.toFixed(3)} → ${a.cls.toFixed(3)} | ${Math.round(b.lcp)} → ${Math.round(a.lcp)} ms | ${a.olCss} | ${a.olJs} |`);
  if (clsDelta > 0.0005) failures.push(`${key}: labels add CLS ${clsDelta.toFixed(4)}`);
  if (scoreDelta < -SCORE_MARGIN) failures.push(`${key}: performance score ${scoreDelta.toFixed(2)}`);
  if (a.olCss !== 1) failures.push(`${key}: ${a.olCss} OpenLabel stylesheet requests (expected 1)`);
  if (a.olJs !== 0) failures.push(`${key}: ${a.olJs} OpenLabel scripts (expected 0)`);
}
const report = resolve(here, '../lighthouse-report');
mkdirSync(report, { recursive: true });
writeFileSync(resolve(report, 'summary.json'), JSON.stringify({ runs, on, off, failures }, null, 2));
writeFileSync(resolve(report, 'summary.md'), [
  `Lighthouse, OpenLabel off → on (median of ${runs} runs, no throttling, Varnish warm)`,
  '',
  '| page / viewport | performance | CLS | LCP | OpenLabel CSS requests | OpenLabel JS |',
  '|---|---|---|---|---|---|',
  ...rows,
  '',
  failures.length === 0 ? 'Result: pass' : `Result: FAIL\n- ${failures.join('\n- ')}`,
].join('\n'));
console.log(rows.join('\n'));
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Lighthouse gate: pass');
