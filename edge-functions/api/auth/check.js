/**
 * POST /api/auth/check — verify an access key before the UI unlocks.
 * GET  /api/auth/check — same check using the Authorization header.
 */
import { json, corsPreflight, readJson } from '../../lib/http.js';
import {
  authConfig,
  requestKey,
  verifyKey,
  clearFailures,
  isRateLimited,
  rateLimited,
  unauthorized,
} from '../../lib/auth.js';

async function check(request, env, key) {
  const cfg = authConfig(env);
  if (!cfg.siteEnabled) return json({ ok: true, enabled: false, mode: 'open' });
  if (isRateLimited(request, 'site')) return rateLimited();
  if (await verifyKey(key, cfg.siteKey)) {
    clearFailures(request, 'site');
    return json({ ok: true, enabled: true, mode: 'admin' });
  }
  return unauthorized('invalid ADMIN_PASS');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let key = requestKey(request);
  if (!key) {
    try {
      const body = await readJson(request, 4096);
      key = String(body.key || '').trim();
    } catch (_) {
      /* empty body is fine: key may come from headers */
    }
  }
  return check(request, env, key);
}

export function onRequestGet(context) {
  const { request, env } = context;
  return check(request, env, requestKey(request));
}

export function onRequestOptions() {
  return corsPreflight();
}