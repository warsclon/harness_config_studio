import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startSitePreview } from './serve-site.mjs';

const demoPath = new URL('../_site/demo.html', import.meta.url);
const before = await readFile(demoPath, 'utf8');
execFileSync(process.execPath, [fileURLToPath(new URL('./build-site.mjs', import.meta.url))]);
assert.equal(await readFile(demoPath, 'utf8'), before, 'Demo build must be deterministic');
assert.doesNotMatch(before, /\/Users\/|\/private\/|\/home\/runner|hcs-presentation-/);
let running, browser;
try {
  running = await startSitePreview('/harness_config_studio/');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  const response = await page.goto(running.url);
  assert.equal(response.status(), 200);
  const links = await page.locator('a[href],img[src]').evaluateAll(elements => elements.map(element => element.href || element.src));
  for (const url of links) {
    assert.ok(url.startsWith(running.url), `Site resource must stay under the Pages prefix: ${url}`);
    assert.equal((await page.request.get(url)).status(), 200, url);
  }
  await page.getByRole('link', { name: 'Explore the interactive demo ↗' }).click();
  await page.locator('#app[data-state="ready"]').waitFor();
  await page.getByTestId('toggle-sections').click();
  await page.getByRole('button', { name: /\.codex.*Global Root/i }).click();
  await page.locator('[data-tree-path="/demo/home/.codex/AGENTS.md"] .artifact-button').click();
  assert.equal(await page.getByLabel('Artifact content').getAttribute('readonly'), '');
  assert.equal(await page.locator('[data-remove-artifact],[data-reveal-artifact],[data-reveal-source-kind],[data-testid="review-save"]').count(), 0);
  await page.getByRole('link', { name: '← Overview' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Landing must fit mobile width');
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(running.url)), 'No external network resources');
  assert.ok(requests.every(url => !url.includes('/api/')), 'Demo must not request an API');
  console.log('Site passed: deterministic demo, prefixed links, images, read-only explorer, no API/external resources, mobile landing.');
} finally { await browser?.close(); await running?.close(); }
