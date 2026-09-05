import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { renderWebShell } from '../dist/web.js';

const root = new URL('../', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('site/fixture.json', root), 'utf8'));
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
await mkdir(new URL('_site/media/', root), { recursive: true });
await writeFile(new URL('_site/demo.html', root), renderWebShell('', version, false, false, fixture));
await copyFile(new URL('site/index.html', root), new URL('_site/index.html', root));
for (const name of ['hero.png', 'workspace.png', 'workflow.gif']) {
  await copyFile(new URL(`docs/media/${name}`, root), new URL(`_site/media/${name}`, root));
}
console.log('Built _site/ from the application UI and fictional fixtures. No deployment performed.');
