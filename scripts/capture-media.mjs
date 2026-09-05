import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { startSitePreview } from './serve-site.mjs';

// ffmpeg is a maintainer-only tool; it is never installed as a package dependency.
execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
const output = fileURLToPath(new URL('../docs/media/', import.meta.url));
await mkdir(output, { recursive: true });
const frames = await mkdtemp(join(tmpdir(), 'hcs-media-'));
let running, browser;
try {
  running = await startSitePreview();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  await page.goto(running.url + 'demo.html');
  await page.locator('#app[data-state="ready"]').waitFor();
  await page.getByTestId('toggle-sections').click();
  const scenes = [
    { source: /\.codex.*Global Root/i, path: '/demo/home/.codex/AGENTS.md', image: 'hero.png' },
    { source: /atlas-web.*Project Root/i, path: '/demo/projects/atlas-web/AGENTS.md', image: 'workspace.png' },
    { source: /\.codex.*Global Root/i, path: '/demo/home/.codex/config.toml' },
    { source: /\.agents.*Global Root/i, path: '/demo/home/.agents/skills/code-review/SKILL.md' },
  ];
  for (const [index, scene] of scenes.entries()) {
    await page.getByRole('button', { name: scene.source }).click();
    await page.getByRole('button', { name: 'Expand all artifact directories', exact: true }).click();
    await page.locator(`[data-tree-path="${scene.path}"] .artifact-button`).click();
    await page.getByLabel('Artifact content').waitFor();
    await page.locator('[data-testid="management-detail"] .metadata').getByText(scene.path, { exact: true }).waitFor();
    if (scene.image) await page.screenshot({ path: join(output, scene.image) });
    await page.screenshot({ path: join(frames, `frame-${index}.png`) });
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1/3', '-i', join(frames, 'frame-%d.png'), '-filter_complex', 'scale=1080:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer', '-loop', '0', join(output, 'workflow.gif')]);
  console.log('Captured hero.png, workspace.png and a 12-second workflow.gif from the real demo.');
} finally { await browser?.close(); await running?.close(); await rm(frames, { recursive: true, force: true }); }
