/**
 * EdgeOne Blob adapter (strong consistency).
 * The SDK is optional: if `@edgeone/pages-blob` is not installed the caller
 * falls back to KV or in-memory storage.
 */
let attemptedAt = 0;
let store = null;
let error = null;
const RETRY_MS = 60_000;

export async function getBlobStore() {
  if (store) return store;
  const now = Date.now();
  if (attemptedAt && now - attemptedAt < RETRY_MS) return null;
  attemptedAt = now;
  try {
    const mod = await import('@edgeone/pages-blob');
    const getStore = mod.getStore || (mod.default && mod.default.getStore);
    if (typeof getStore !== 'function') {
      error = 'getStore export missing';
      return null;
    }
    store = getStore({ name: 'qijing-rooms', consistency: 'strong' });
    return store;
  } catch (err) {
    error = String((err && err.message) || err);
    return null;
  }
}

export function blobError() {
  return error;
}