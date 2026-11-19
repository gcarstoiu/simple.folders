/* simple.folders - product screenshots for the README and the Community Apps
 * listing.
 *
 *   node harness/test/shoot.mjs
 *
 * Hides the harness' own chrome so the capture shows only the plugin, then
 * writes docs/screenshot-*.png. Needs the harness and a CDP Chrome running
 * (see run.sh).
 *
 * NOT part of the plugin package. Never shipped.
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT  = join(dirname(fileURLToPath(import.meta.url)), '../../docs');
const BASE = process.env.HARNESS_URL || 'http://localhost:8089';
const CDP  = process.env.CDP_URL || 'http://localhost:9222';

/* Wide enough for every column without the table scrolling sideways
 * (--sf-table-min plus the page's padding). */
const WIDTH = 1520;

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: { width: WIDTH, height: 900 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(query) {
  await page.goto(`${BASE}/_reset`, { waitUntil: 'domcontentloaded' });
  await page.setViewport({ width: WIDTH, height: 900 });
  await page.goto(`${BASE}/?nostream=1${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sf-card');

  /* Strip the harness' own header so the shot is the plugin alone. */
  await page.evaluate(() => {
    document.querySelector('.harness-bar')?.remove();
    document.querySelector('.title')?.remove();
    document.body.style.background = '#101215';
  });

  /* Give the live columns plausible values: the real page fills these from
     the dockerload stream, which is off for a settled capture. */
  await page.evaluate(() => {
    const SF = window.SimpleFolders;
    SF.store.state.containers.forEach((ct) => {
      if (ct.state !== 'running') return;
      SF.store.state.live[ct.name] = { cpu: ct.cpu ?? 0, mem: ct.mem ?? 0 };
    });
    SF.store.emit();
  });
}

/* Bottom of the given element plus a margin small enough to stop short of
 * the actions bar under the table. */
const bottomOf = (selector) => page.evaluate((sel) =>
  Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom) + 8, selector);

async function save(name, height) {
  await page.setViewport({ width: WIDTH, height });
  await pause(300);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

/* Everything folded: the folders with their icon strips, then the
 * containers in no folder. */
await open('&folded=all');
await save('screenshot-folded', await bottomOf('.sf-card'));

/* Everything unfolded. */
await open('');
await save('screenshot-expanded', await bottomOf('.sf-card'));

/* The Columns list, over the folded table. */
await open('&folded=all');
await page.setViewport({ width: WIDTH, height: await bottomOf('.sf-card') });
await page.click('.sf-btn-cols');
await page.waitForSelector('.sf-cols');
await save('screenshot-columns', Math.max(await bottomOf('.sf-card'), await bottomOf('.sf-cols')));

/* A container's menu with its Details unfolded: network, MAC, creation
 * date and volume mappings. Cut off under the menu. */
await open('');
await page.setViewport({ width: WIDTH, height: await bottomOf('.sf-card') });
await page.click('.sf-ct-icon[aria-label^="Actions for sonarr,"]');
await page.waitForSelector('.sf-ctm');
await page.click('.sf-ctm-disc');
await save('screenshot-details', (await bottomOf('.sf-ctm')) + 8);

await page.close();
await browser.disconnect();
