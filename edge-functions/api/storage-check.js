/**
 * GET /api/storage-check — write/read/delete a probe key in KV.
 * Lets you confirm the CHESS_KV binding before opening a real room.
 */
import { json, corsPreflight } from '../lib/http.js';
import { requireAccess } from '../lib/auth.js';
import { getKv, storageInfo } from '../lib/room-store.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = await requireAccess(request, env);
  if (denied) return denied;

  const info = storageInfo(env);
  const kv = getKv(env);
  if (!kv) {
    return json({
      ok: false,
      ...info,
      error: 'no usable KV binding: bind a namespace to CHESS_KV',
    });
  }

  const key = `selftest_${Date.now()}`;
  try {
    await kv.put(key, 'ok');
    const value = await kv.get(key);
    await kv.delete(key);
    return json({ ok: value === 'ok', ...info, value: value ?? null });
  } catch (err) {
    return json(
      { ok: false, ...info, error: String((err && err.message) || err) },
      { status: 500 }
    );
  }
}

export function onRequestOptions() {
  return corsPreflight();
}
