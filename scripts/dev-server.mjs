/**
 * Local preview server that emulates EdgeOne Makers static hosting + Edge Functions.
 * Usage: npm run dev  →  http://localhost:8788
 * Not part of the deployed site.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const PORT = Number(process.env.PORT) || 8788;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const modCache = new Map();

function loadModule(file) {
  if (!modCache.has(file)) modCache.set(file, import(pathToFileURL(file).href));
  return modCache.get(file);
}

async function findFunction(pathname) {
  const clean = pathname.replace(/^\/+|\/+$/g, '');
  const candidates = [
    join(ROOT, 'edge-functions', `${clean}.js`),
    join(ROOT, 'edge-functions', clean, 'index.js'),
  ];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch (_) {
      /* next */
    }
  }
  return null;
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendResponse(res, response) {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(body);
}

async function serveStatic(pathname, res) {
  let path = decodeURIComponent(pathname);
  if (path === '/') path = '/index.html';
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(join(ROOT, path));
  if (!file.startsWith(ROOT + sep)) return send(res, 403, 'Forbidden');
  try {
    const info = await stat(file);
    if (!info.isFile()) return send(res, 404, 'Not found');
    const data = await readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  } catch (_) {
    send(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const file = await findFunction(url.pathname);
      if (!file) return send(res, 404, JSON.stringify({ error: 'function not found' }), 'application/json');
      const mod = await loadModule(file);
      const method = req.method || 'GET';
      const handler =
        (method === 'GET' && mod.onRequestGet) ||
        (method === 'POST' && mod.onRequestPost) ||
        (method === 'OPTIONS' && mod.onRequestOptions) ||
        mod.onRequest;
      if (!handler) return send(res, 405, JSON.stringify({ error: 'method not allowed' }), 'application/json');
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const body = hasBody ? await readBody(req) : undefined;
      const request = new Request(`http://localhost:${PORT}${req.url}`, {
        method,
        headers: req.headers,
        body: body && body.length ? body : undefined,
      });
      const response = await handler({
        request,
        env: process.env,
        params: {},
        waitUntil: () => {},
      });
      if (response) await sendResponse(res, response);
      else send(res, 204, '');
      return;
    }
    await serveStatic(url.pathname, res);
  } catch (err) {
    console.error('[dev-server]', err);
    send(res, 500, JSON.stringify({ error: err && err.message ? err.message : String(err) }), 'application/json');
  }
});

server.listen(PORT, () => {
  console.log(`棋境 dev server → http://localhost:${PORT}`);
  console.log(`MCP endpoint     → http://localhost:${PORT}/api/mcp`);
});