// Stand-in for the production nginx (nginx/default.conf) for machines without a container runtime.
// Static files + directory index + SPA fallback + /api proxy, with the add_header lines read from the real config.
// Env: DIST (default ../../frontend/dist), PORT (8475), API_URL (http://127.0.0.1:5000).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.env.DIST ?? path.join(here, '../../frontend/dist'));
const PORT = Number(process.env.PORT ?? 8475);
const api = new URL(process.env.API_URL ?? 'http://127.0.0.1:5000');
const conf = fs.readFileSync(path.join(here, '../../nginx/default.conf'), 'utf8');

const headers = {};
for (const m of conf.matchAll(/^\s*add_header\s+(\S+)\s+"([^"]*)"/gm)) headers[m[1]] = m[2];
if (!headers['Content-Security-Policy']) throw new Error('no Content-Security-Policy found in nginx/default.conf');

const types = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

function resolveFile(urlPath) {
  let f = path.resolve(path.join(DIST, decodeURIComponent(urlPath)));
  if (!f.startsWith(DIST)) return path.join(DIST, 'index.html');
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  return fs.existsSync(f) ? f : path.join(DIST, 'index.html');
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const p = http.request(
      { host: api.hostname, port: api.port, path: req.url, method: req.method, headers: req.headers },
      r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
    );
    p.on('error', e => { res.writeHead(502); res.end(String(e)); });
    req.pipe(p);
    return;
  }
  const f = resolveFile(req.url.split('?')[0]);
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] ?? 'application/octet-stream', ...headers });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${DIST} on ${PORT}, /api -> ${api.origin}`));
