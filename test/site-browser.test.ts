import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { startSitePreview } from '../scripts/serve-site.mjs';
import { chromium } from 'playwright';
import test from 'node:test';
import { renderWebShell } from '../src/web.ts';

const fixture = JSON.parse(await readFile(new URL('../site/fixture.json', import.meta.url), 'utf8'));

test('static demo uses the real explorer without network, native controls or writable content', async () => {
  const examples = structuredClone(fixture);
  examples.artifacts['/demo/home/.codex/AGENTS.md'].content += '\n</script><script>globalThis.demoEscaped = true;</script>';
  const html = renderWebShell('', '0.2.6', false, false, examples);
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if(req.url !== '/harness_config_studio/demo.html'){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type', 'text/html');res.end(html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();assert.ok(address && typeof address !== 'string');
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:960}});
    page.setDefaultTimeout(4000);
    const errors: string[]=[];page.on('pageerror', e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${address.port}/harness_config_studio/demo.html`);
    await page.locator('#app[data-state="ready"]').waitFor();
    assert.match(await page.locator('body').innerText(), /READ-ONLY DEMO/);
    await page.getByTestId('toggle-sections').click();
    await page.getByRole('button',{name:/\.codex.*Global Root/i}).click();
    await page.locator('[data-tree-path="/demo/home/.codex/AGENTS.md"] .artifact-button').click();
    assert.match(await page.getByLabel('Artifact content').inputValue(), /Working together/);
    assert.equal(await page.getByLabel('Artifact content').getAttribute('readonly'), '');
    assert.equal(await page.locator('[data-remove-artifact],[data-reveal-artifact],[data-reveal-source-kind],[data-testid="review-save"]').count(),0);
    await page.getByLabel('Artifact content').press('ControlOrMeta+s');
    assert.equal(await page.getByRole('dialog').count(),0);
    await page.getByTestId('refresh').click();
    await page.getByRole('button',{name:/atlas-web.*Project Root/i}).click();
    await page.locator('[data-tree-path="/demo/projects/atlas-web/AGENTS.md"] .artifact-button').click();
    assert.match(await page.getByLabel('Artifact content').inputValue(), /Atlas Web/);
    await page.getByTestId('help').click();
    assert.match(await page.getByRole('dialog').innerText(), /fictional/i);
    await page.getByTestId('close-help').click();
    assert.equal(await page.evaluate(() => Reflect.get(globalThis, "demoEscaped")), undefined);
    assert.deepEqual(errors,[]);
    assert.deepEqual(requests.filter(x=>x!='/favicon.ico'),['/harness_config_studio/demo.html']);
  } finally {await browser.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});


test('presentation preview rejects malformed URLs and continues serving requests', async () => {
  const running = await startSitePreview();
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const call = request(running.url, { path: '//[' }, response => { response.resume(); resolve(response.statusCode); });
      call.on('error', reject);call.setTimeout(2000, () => call.destroy(new Error('Preview timed out')));call.end();
    });
    assert.equal(status, 400);
    assert.equal((await fetch(running.url + 'unknown')).status, 404);
  } finally { await running.close(); }
});
