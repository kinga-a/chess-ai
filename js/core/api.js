/**
 * Fetch wrapper that attaches the site access key.
 * The key lives in memory first, then sessionStorage (default) or localStorage
 * when the visitor asks to be remembered on this device.
 */
const STORE = 'qijing.accessKey';
let memoryKey = '';

function readStored() {
  try {
    const local = localStorage.getItem(STORE);
    if (local) return local;
    const session = sessionStorage.getItem(STORE);
    if (session) return session;
  } catch (_) {
    /* storage disabled */
  }
  return '';
}

export function getAccessKey() {
  if (memoryKey) return memoryKey;
  memoryKey = readStored();
  return memoryKey;
}

export function hasAccessKey() {
  return getAccessKey().length > 0;
}

export function saveAccessKey(key, remember = false) {
  memoryKey = key;
  try {
    if (remember) {
      localStorage.setItem(STORE, key);
      sessionStorage.removeItem(STORE);
    } else {
      sessionStorage.setItem(STORE, key);
      localStorage.removeItem(STORE);
    }
  } catch (_) {
    /* storage disabled: keep it in memory for this tab */
  }
}

export function forgetAccessKey() {
  memoryKey = '';
  try {
    localStorage.removeItem(STORE);
    sessionStorage.removeItem(STORE);
  } catch (_) {
    /* storage disabled */
  }
}

export function authHeaders(extra) {
  const headers = { ...(extra || {}) };
  const key = getAccessKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export async function apiFetch(input, init = {}) {
  const res = await fetch(input, {
    ...init,
    cache: 'no-store',
    headers: authHeaders(init.headers),
  });
  if (res.status === 401) {
    try {
      window.dispatchEvent(new CustomEvent('qijing:access-denied'));
    } catch (_) {
      /* no window */
    }
  }
  return res;
}