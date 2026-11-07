/**
 * Room storage for live matches.
 *
 * Uses EdgeOne KV when bound (`env.KV`), otherwise an in-process Map so the
 * local dev server and single-instance previews keep working. Rooms expire
 * after three hours.
 */
const TTL = 3 * 60 * 60 * 1000;
const PREFIX = 'room:';
const memory = new Map();

function kvOf(env) {
  const kv = env && env.KV;
  if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') return kv;
  return null;
}

async function readKv(kv, key) {
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

export function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export async function readRoom(env, code) {
  const key = `${PREFIX}${code}`;
  const kv = kvOf(env);
  if (kv) {
    const data = await readKv(kv, key);
    if (data) {
      const age = Date.now() - (data.updated || 0);
      if (age <= TTL) return data;
      try {
        await kv.delete(key);
      } catch (_) {
        /* best effort expiry */
      }
    }
  }
  const local = memory.get(code);
  if (!local) return null;
  if (Date.now() - local.updated > TTL) {
    memory.delete(code);
    return null;
  }
  return local;
}

export async function saveRoom(env, room) {
  room.updated = Date.now();
  room.version = (room.version || 0) + 1;
  memory.set(room.code, room);
  if (memory.size > 500) {
    const now = Date.now();
    for (const [code, value] of memory) if (now - value.updated > TTL) memory.delete(code);
  }
  const kv = kvOf(env);
  if (kv) {
    try {
      await kv.put(`${PREFIX}${room.code}`, JSON.stringify(room));
    } catch (_) {
      /* KV unavailable: memory copy still serves this instance */
    }
  }
  return room;
}

export async function removeRoom(env, code) {
  memory.delete(code);
  const kv = kvOf(env);
  if (kv && typeof kv.delete === 'function') {
    try {
      await kv.delete(`${PREFIX}${code}`);
    } catch (_) {
      /* KV unavailable */
    }
  }
}