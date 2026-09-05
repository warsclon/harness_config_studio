import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const files = new Set(['index.html', 'demo.html', 'media/hero.png', 'media/workspace.png', 'media/workflow.gif']);
export async function startSitePreview(prefix = '/', port = 0) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const name = path.startsWith(prefix) ? path.slice(prefix.length) || 'index.html' : '';
    if (!files.has(name)) { response.writeHead(404); response.end(); return; }
    try {
      const body = await readFile(new URL(`../_site/${name}`, import.meta.url));
      const type = name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.gif') ? 'image/gif' : 'image/png';
      response.writeHead(200, { 'content-type': type }); response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}${prefix}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const running = await startSitePreview();
  console.log(`Presentation preview: ${running.url}`);
}
