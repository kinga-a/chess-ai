/**
 * Two independent keys:
 *   ACCESS_KEY  → MCP endpoint only (/api/mcp); unset = MCP is open
 *   ADMIN_PASS  → web UI, login check, AI endpoints and rooms; unset = web is open
 *
 * A missing variable disables protection for that surface only. The two keys
 * never substitute for each other.
 *
 * Clients may present a key as:
 *   Authorization: Bearer <key>
 *   X-Access-Key: <key>
 *   X-MCP-Key: <key>
 *   ?key=<key>            (fallback, less safe: may leak in logs)
 */
import { json } from './http.js';

const FAIL_WINDOW_MS = 60_000;
const FAIL_LIMIT = 8;
const attempts = new Map();

export function authConfig(env = {}) {
  const mcpKey = String(env.ACCESS_KEY || '').trim();
  const siteKey = String(env.ADMIN_PASS || '').trim();
  return {
    mcpKey,
    siteKey,
    mcpEnabled: mcpKey.length > 0,
    siteEnabled: siteKey.length > 0,
  };
}

export function requestKey(request) {
  const auth = request.headers.get('Authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (bearer) return bearer[1].trim();

  const direct = request.headers.get('X-Access-Key') || request.headers.get('X-MCP-Key');
  if (direct && direct.trim()) return direct.trim();

  try {
    const q = new URL(request.url).searchParams.get('key');
    if (q && q.trim()) return q.trim();
  } catch (_) {
    /* malformed url */
  }
  return '';
}

async function digest(text) {
  const bytes = new TextEncoder().encode(String(text));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(hash);
}

/** Constant-time comparison: hash both sides, then XOR every byte. */
export async function verifyKey(candidate, expected) {
  if (!candidate || !expected) return false;
  const [a, b] = await Promise.all([digest(candidate), digest(expected)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || 'local';
}

function bucketId(request, scope) {
  return `${scope}:${clientIp(request)}`;
}

function bucket(request, scope) {
  const id = bucketId(request, scope);
  const now = Date.now();
  const entry = attempts.get(id);
  if (!entry || entry.resetAt <= now) return { count: 0, resetAt: now + FAIL_WINDOW_MS };
  return entry;
}

export function isRateLimited(request, scope = 'site') {
  const entry = attempts.get(bucketId(request, scope));
  if (!entry || entry.resetAt <= Date.now()) return false;
  return entry.count >= FAIL_LIMIT;
}

function recordFailure(request, scope) {
  const id = bucketId(request, scope);
  const entry = bucket(request, scope);
  attempts.set(id, { count: entry.count + 1, resetAt: entry.resetAt });
  if (attempts.size > 500) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.resetAt <= now) attempts.delete(key);
  }
}

export function clearFailures(request, scope = 'site') {
  attempts.delete(bucketId(request, scope));
}

export function unauthorized(message = 'access key required') {
  return json(
    { error: message, code: 'ACCESS_DENIED' },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Bearer realm="edgeone-chess-ai", charset="UTF-8"',
      },
    }
  );
}

export function rateLimited() {
  return json(
    { error: 'too many invalid attempts, retry in a minute', code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': '60' } }
  );
}

async function guard(request, env, key, enabled, scope, forbiddenHint) {
  if (!enabled) return null;
  if (isRateLimited(request, scope)) return rateLimited();
  const candidate = requestKey(request);
  if (await verifyKey(candidate, key)) {
    clearFailures(request, scope);
    return null;
  }
  recordFailure(request, scope);
  return forbiddenHint ? json({ error: forbiddenHint, code: 'WRONG_KEY_SCOPE' }, { status: 401 }) : unauthorized();
}

/** Guard web-facing endpoints (AI, rooms, login check) with ADMIN_PASS. */
export async function requireAccess(request, env) {
  const cfg = authConfig(env);
  const hint = cfg.mcpEnabled && !cfg.siteEnabled ? 'ADMIN_PASS is not set, so the web API is open; ACCESS_KEY is MCP-only' : '';
  return guard(request, env, cfg.siteKey, cfg.siteEnabled, 'site', hint);
}

/** Guard the MCP endpoint with ACCESS_KEY. */
export async function requireMcpAccess(request, env) {
  const cfg = authConfig(env);
  const hint = cfg.siteEnabled && !cfg.mcpEnabled ? 'ACCESS_KEY is not set, so MCP is open; ADMIN_PASS is web-only' : '';
  return guard(request, env, cfg.mcpKey, cfg.mcpEnabled, 'mcp', hint);
}