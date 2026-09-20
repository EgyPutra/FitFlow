import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const PUBLIC_DIR = resolve(process.cwd(), 'public');
const MAX_BODY = 12 * 1024 * 1024; // 12 MB — room for a camera frame

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

/* ---------- rate limiting (in-memory, per IP) ---------- */

const buckets = new Map();
function rateLimited(ip, limit = 120, windowMs = 60_000) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.reset) {
    buckets.set(ip, { count: 1, reset: now + windowMs });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) if (now > b.reset) buckets.delete(ip);
}, 60_000).unref();

/* ---------- helpers ---------- */

function send(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/* ---------- static files ---------- */

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(PUBLIC_DIR, normalize(rel).replace(/^(\.\.[/\\])+/, ''));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, { error: 'Forbidden' });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const ext = extname(filePath);
    const content = await readFile(filePath);
    // App code has no content hash in its filename, so it must be revalidated
    // on refresh. Images can remain cached indefinitely.
    const cache = ['.html', '.js', '.css'].includes(ext)
      ? 'no-cache'
      : 'public, max-age=31536000, immutable';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': cache,
    });
    res.end(content);
  } catch {
    // SPA fallback: unknown non-asset paths render the app shell.
    if (!extname(pathname)) {
      try {
        const html = await readFile(join(PUBLIC_DIR, 'index.html'));
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        return res.end(html);
      } catch {}
    }
    send(res, 404, { error: 'Not found' });
  }
}

/* ---------- router ---------- */

function matchRoute(method, pathname, routes) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = pathname.match(route.pattern);
    if (m) return { handler: route.handler, params: m.groups || {} };
  }
  return null;
}

export async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (process.env.CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
  }

  if (!pathname.startsWith('/api/')) {
    return serveStatic(req, res, pathname);
  }

  // Keep static pages independent from the database. This lets the app shell
  // load even if a serverless database connection has a separate problem.
  const { routes } = await import('./src/routes.js');

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return send(res, 429, { error: 'Too many requests. Wait a minute and try again.' });
  }

  const match = matchRoute(req.method, pathname, routes);
  if (!match) return send(res, 404, { error: `No route for ${req.method} ${pathname}` });

  try {
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
    const result = await match.handler({ req, body, params: match.params, query: url.searchParams });
    send(res, result.status || 200, result.body ?? {});
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[error] ${req.method} ${pathname}`, err);
    send(res, status, { error: status >= 500 ? 'Something broke on our end. Try again.' : err.message });
  }
}

// Vercel detects `server.js` as the entrypoint and requires a default export.
export default handler;
