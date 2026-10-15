import { test, expect, Page, CDPSession } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from '../admin/admin';
import { cleanupStorefront, fixtureName, galleryRoot, magento, seedSkuLabel } from '../storefront/storefront';

/**
 * The animated GIF at the top of OpenLabel's README (docs/assets/labels-showcase.gif in the openlabel repo, written
 * to modules/openlabel or OL_GIF_OUT). Not a test gate: runs only with OL_SCREENSHOTS=1 (project
 * "screenshots-chromium") and needs ffmpeg. The store's own labels are paused while it records and switched back on
 * afterwards; the showcase labels use copies of the built-in designs and are removed afterwards.
 */
const CATEGORY = '/women/tops-women.html';
const PRODUCT = { sku: 'WS05', path: '/desiree-fitness-tee.html' };
const OUT = process.env.OL_GIF_OUT ?? resolve(__dirname, '../../../modules/openlabel/docs/assets/labels-showcase.gif');
const WORK = resolve(__dirname, '../../test-results/readme-gif');
const PAUSED = resolve(WORK, 'paused-labels.json');
const tag = 'readme-gif';
// Visible area of every scene in CSS pixels, recorded at device scale 2 and scaled to GIF_WIDTH.
const CLIP = { width: 900, height: 620 };
const GIF_WIDTH = 800;
const FPS = 15;

type Placement = [string, string];
const SHOWCASE: Array<{ sku: string; design: string; text: string; at: Placement[]; tooltip?: string }> = [
  { sku: 'WT09', design: 'New corner (teal)', text: 'New', at: [['listing', 'tl'], ['product', 'tl']] },
  { sku: 'WT09', design: 'Ships free (sky)', text: 'Ships free', at: [['listing', 'near_price'], ['product', 'near_price']] },
  { sku: 'WT08', design: 'Bestseller (bronze)', text: 'Bestseller', at: [['listing', 'tl'], ['product', 'tl']], tooltip: 'Top 10 this month' },
  { sku: 'WT08', design: 'Rating (cream)', text: '★ 4.8', at: [['listing', 'br'], ['product', 'br']] },
  { sku: 'WS05', design: 'Flash sale (red, pops in)', text: '-30%', at: [['listing', 'tr'], ['product', 'tr']] },
  { sku: 'WS05', design: 'Low stock pill (amber)', text: 'Only 3 left', at: [['listing', 'bl'], ['product', 'bl']] },
  { sku: 'WS05', design: 'Save amount (rust)', text: 'Save €10.20', at: [['listing', 'near_price'], ['product', 'near_price']] },
  { sku: 'WT07', design: 'Black Friday (black and yellow)', text: 'Black Friday', at: [['listing', 'tl'], ['product', 'tl']] },
  { sku: 'WT07', design: 'Gift idea (berry)', text: 'Gift idea', at: [['listing', 'br'], ['product', 'br']] },
  { sku: 'WJ12', design: 'Eco (forest)', text: 'Eco', at: [['listing', 'tl'], ['product', 'tl']] },
  { sku: 'WJ12', design: 'Vegan (green outline)', text: 'Vegan', at: [['listing', 'tr'], ['product', 'tr']] },
  { sku: 'WJ12', design: 'Organic (olive)', text: 'Organic cotton', at: [['listing', 'under_name'], ['product', 'under_name']] },
  { sku: 'WH12', design: 'Sale ribbon (rose)', text: 'Sale', at: [['listing', 'tr'], ['product', 'tr']] },
  { sku: 'WH12', design: 'Trending (magenta)', text: 'Trending', at: [['listing', 'bl'], ['product', 'bl']] },
  { sku: 'WS01', design: 'Discount circle (red)', text: '-25%', at: [['listing', 'tl'], ['product', 'tl']] },
  { sku: 'WS01', design: 'Top rated (violet)', text: 'Top rated', at: [['listing', 'bc'], ['product', 'bc']] },
  { sku: 'WT06', design: 'Clearance (yellow)', text: 'Clearance', at: [['listing', 'tr'], ['product', 'tr']] },
  { sku: 'WT06', design: 'Online only (teal)', text: 'Online only', at: [['listing', 'near_price'], ['product', 'near_price']] },
  { sku: 'WJ06', design: 'Back in stock (emerald)', text: 'Back in stock', at: [['listing', 'tl'], ['product', 'tl']] },
  { sku: 'WJ06', design: 'Exclusive (navy)', text: 'Exclusive', at: [['listing', 'tr'], ['product', 'tr']] },
];

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** A copy of a built-in design with its own text (and tooltip), so texts never depend on the sample catalog's prices. */
function copyDesign(builtIn: string, text: string, tooltip?: string): number {
  const columns = 'type, shape, image_path, image_width, image_height, bg_color, text_color, border_color, border_width,'
    + ' font_size, size_mode, width, height, opacity, rotation, custom_css, animation, hover_effect, sizes';
  const rows = sql(
    `INSERT INTO openlabel_design (name, is_system, ${columns})`
    + ` SELECT ${q(fixtureName(tag, `${builtIn} ${text}`))}, 0, ${columns} FROM openlabel_design`
    + ` WHERE is_system = 1 AND name = ${q(builtIn)};`
    + ' SET @d = LAST_INSERT_ID();'
    + ` INSERT INTO openlabel_design_store (design_id, store_id, text, tooltip) VALUES (@d, 0, ${q(text)}, ${tooltip ? q(tooltip) : 'NULL'});`
    + ' SELECT @d;',
  );
  return Number(rows[rows.length - 1][0]);
}

/** Switches the store's own labels back on (also after a run that was interrupted). */
function resumeStoreLabels(): void {
  if (!existsSync(PAUSED)) {
    return;
  }
  const ids: string[] = JSON.parse(readFileSync(PAUSED, 'utf8'));
  if (ids.length > 0) {
    sql(`UPDATE openlabel_label SET status = 1 WHERE label_id IN (${ids.map(Number).join(',')});`);
  }
  rmSync(PAUSED);
}

function refreshStorefront(): void {
  magento('openlabel:reindex');
  magento('openlabel:css:regenerate');
  magento('cache:clean', 'full_page');
}

test.beforeAll(() => {
  mkdirSync(WORK, { recursive: true });
  cleanupStorefront(tag);
  resumeStoreLabels();
  const active = sql("SELECT label_id FROM openlabel_label WHERE status = 1 AND name NOT LIKE '%sfe2e-%';").map((row) => row[0]);
  writeFileSync(PAUSED, JSON.stringify(active));
  if (active.length > 0) {
    sql(`UPDATE openlabel_label SET status = 0 WHERE label_id IN (${active.join(',')});`);
  }
  SHOWCASE.forEach((label, i) => {
    const design = copyDesign(label.design, label.text, label.tooltip);
    seedSkuLabel(fixtureName(tag, `${i} ${label.text}`), design, label.sku, { placements: label.at, reindex: false });
  });
  refreshStorefront();
});

test.afterAll(() => {
  cleanupStorefront(tag);
  resumeStoreLabels();
  refreshStorefront();
});

/** Chrome's screencast: a JPEG frame each time the page paints, resampled to FPS from the frames' timestamps. */
class Recorder {
  private frames: Array<{ file: string; at: number }> = [];
  private scene = 0;
  private client?: CDPSession;

  constructor(private readonly page: Page) {}

  private get dir(): string {
    return resolve(WORK, `scene-${this.scene}`);
  }

  /** Starts a scene; `clip` is the CLIP-sized box (CSS pixels, viewport coordinates) the GIF shows. */
  async start(clip: { x: number; y: number }): Promise<void> {
    this.scene += 1;
    const dir = this.dir;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(resolve(dir, 'seq'), { recursive: true });
    writeFileSync(resolve(dir, 'clip.json'), JSON.stringify({ ...clip, viewport: this.page.viewportSize()!.width }));
    this.frames = [];
    const client = await this.page.context().newCDPSession(this.page);
    this.client = client;
    client.on('Page.screencastFrame', (frame) => {
      const file = resolve(dir, `${String(this.frames.length).padStart(5, '0')}.jpg`);
      writeFileSync(file, Buffer.from(frame.data, 'base64'));
      this.frames.push({ file, at: frame.metadata.timestamp ?? Date.now() / 1000 });
      client.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
    });
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1 });
  }

  /** Holds the last frame for `hold` seconds, stops, and links the frame shown at each 1/FPS tick into seq/. */
  async stop(hold: number): Promise<void> {
    await this.page.waitForTimeout(hold * 1000);
    const end = Date.now() / 1000;
    await this.client?.send('Page.stopScreencast');
    await this.client?.detach();
    expect(this.frames.length, `scene ${this.scene} recorded frames`).toBeGreaterThan(0);
    const start = this.frames[0].at;
    let shown = 0;
    for (let tick = 0; start + tick / FPS <= Math.max(end, start); tick++) {
      while (shown + 1 < this.frames.length && this.frames[shown + 1].at <= start + tick / FPS) {
        shown += 1;
      }
      symlinkSync(this.frames[shown].file, resolve(this.dir, 'seq', `${String(tick).padStart(5, '0')}.jpg`));
    }
  }

  get scenes(): number {
    return this.scene;
  }
}

/** Scrolls the window smoothly by `dy` CSS pixels over `ms`. */
async function glide(page: Page, dy: number, ms: number): Promise<void> {
  await page.evaluate(([distance, duration]) => new Promise<void>((done) => {
    const from = window.scrollY;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
      window.scrollTo(0, from + distance * eased);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        done();
      }
    };
    requestAnimationFrame(step);
  }), [dy, ms]);
}

async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => window.scrollTo(0, top), Math.round(y));
}

/** Top of the element in page coordinates. */
async function pageTop(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
}

/** Left edge of a CLIP-wide box starting `inset` pixels left of the element, kept inside the viewport. */
async function clipX(page: Page, selector: string, inset: number | 'centre'): Promise<number> {
  const box = (await page.locator(selector).first().boundingBox())!;
  const x = inset === 'centre' ? box.x + box.width / 2 - CLIP.width / 2 : box.x - inset;
  return Math.round(Math.max(0, Math.min(page.viewportSize()!.width - CLIP.width, x)));
}

/** Crops and scales each scene, then one palette for the whole GIF. */
function buildGif(scenes: number): void {
  const parts: string[] = [];
  for (let s = 1; s <= scenes; s++) {
    const dir = resolve(WORK, `scene-${s}`);
    const clip = JSON.parse(readFileSync(resolve(dir, 'clip.json'), 'utf8'));
    const frameWidth = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=width', '-of', 'csv=p=0', resolve(dir, '00000.jpg')], { encoding: 'utf8' }).trim());
    const k = frameWidth / clip.viewport;
    const crop = [CLIP.width * k, CLIP.height * k, clip.x * k, clip.y * k].map(Math.round).join(':');
    const part = resolve(dir, 'scene.mp4');
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', resolve(dir, 'seq', '%05d.jpg'),
      '-vf', `crop=${crop},scale=${GIF_WIDTH}:-2:flags=lanczos`, '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv444p', part,
    ]);
    parts.push(`file '${part}'`);
  }
  writeFileSync(resolve(WORK, 'scenes.txt'), parts.join('\n'));
  const input = ['-f', 'concat', '-safe', '0', '-i', resolve(WORK, 'scenes.txt')];
  const palette = resolve(WORK, 'palette.png');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-vf', 'palettegen=max_colors=256:stats_mode=diff', palette]);
  mkdirSync(resolve(OUT, '..'), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-i', palette,
    '-lavfi', 'paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', '-loop', '0', OUT]);
}

test('README GIF: built-in designs on a category page, a tooltip, the product page', async ({ page }) => {
  const rec = new Recorder(page);
  const grid = '.products-grid, .products.wrapper';
  const items = page.locator('.product-item');

  // Warm Varnish so the recording never waits on a page build.
  await page.goto(PRODUCT.path);
  await page.goto(CATEGORY);
  await expect(page.locator('.product-item .ol-label', { hasText: 'Black Friday' })).toBeVisible();

  // Scene 1: the first row, a tooltip on hover, then row by row through the grid.
  const top = await pageTop(page, grid);
  const rowPitch = (await items.nth(3).boundingBox())!.y - (await items.nth(0).boundingBox())!.y;
  await scrollTo(page, top - 4);
  await page.mouse.move(5, 790);
  await rec.start({ x: await clipX(page, grid, 'centre'), y: 0 });
  await page.waitForTimeout(1800);
  const bestseller = page.locator('.product-item .ol-label', { hasText: 'Bestseller' }).first();
  await bestseller.hover();
  await expect(page.locator(`#${await bestseller.getAttribute('aria-describedby')}`)).toBeVisible();
  await page.waitForTimeout(1800);
  await page.mouse.move(5, 790);
  await page.waitForTimeout(500);
  await glide(page, rowPitch, 1400);
  await page.waitForTimeout(2000);
  await glide(page, rowPitch, 1400);
  await page.waitForTimeout(2000);
  await rec.stop(0.1);

  // Scene 2: the same labels on the product page (a narrower window, so the gallery and the name fit side by side).
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(PRODUCT.path);
  const gallery = galleryRoot();
  await expect(page.locator(`${gallery} .ol-label`, { hasText: '-30%' }).first()).toBeVisible();
  await scrollTo(page, (await pageTop(page, gallery)) - 16);
  await rec.start({ x: await clipX(page, gallery, 16), y: 0 });
  await page.waitForTimeout(3000);
  await rec.stop(0.1);

  buildGif(rec.scenes);
  console.log(`README GIF written to ${OUT}`);
});
