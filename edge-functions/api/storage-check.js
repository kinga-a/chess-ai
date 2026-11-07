/**
 * GET /api/storage-check — write/read/delete a probe key in KV.
 * Lets you confirm the CHESS_KV binding before opening a real room.
 */
import { json, corsPreflight } from '../lib/http.js';
import { requireAccess } from '../lib/auth.js';
import { getKv, storageInfo } from '../lib/room-store.js';
import { getBlobStore } from '../lib/blob-store.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = await requireAccess(request, env);
  if (denied) return denied;

  const info = await storageInfo(env);
  const blob = await getBlobStore();
  if (blob) {
    const blobKey = `selftest_${Date.now()}.txt`;
    try {
      await blob.set(blobKey, 'ok');
      const value = await blob.get(blobKey, { consistency: 'strong' });
      await blob.delete(blobKey);
      return json({ ok: value === 'ok', ...info, value: value ?? null });
    } catch (err) {
      return json({ ok: false, ...info, error: String((err && err.message) || err) }, { status: 500 });
    }
  }
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
