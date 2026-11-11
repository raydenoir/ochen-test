import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { semanticMiddleware } from './semantic-plugin.mjs';
import { createInterpretProvider } from './providers.mjs';

try { process.loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const provider = createInterpretProvider();
const interpret = semanticMiddleware(provider.interpret, { trustedProxyIps: process.env.TRUSTED_PROXY_IPS });
const server = http.createServer((req, res) => {
  interpret(req, res, async () => {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(resolve(root) + sep)) { res.writeHead(403); res.end(); return; }
      let data;
      try { data = await readFile(path); }
      catch {
        if (pathname.startsWith('/assets/') || pathname.startsWith('/api/') || extname(pathname)) { res.writeHead(404); res.end(); return; }
        path = resolve(root, 'index.html'); data = await readFile(path);
      }
      res.writeHead(200, { 'Content-Type': (mime[extname(path)] ?? 'application/octet-stream') + (['.html','.js','.css','.svg','.json'].includes(extname(path)) ? '; charset=utf-8' : ''), 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(400); res.end(); }
  }).catch(() => { if (!res.writableEnded) { res.writeHead(500); res.end(); } });
});
const port = Number(process.env.PORT || 3000), host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => console.log(`Illustration studio: http://${host}:${server.address().port}`));
