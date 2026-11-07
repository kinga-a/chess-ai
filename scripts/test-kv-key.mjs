/**
 * KV adapter checks with a mocked EdgeOne namespace.
 * Verifies key format (only letters/digits/underscores), read/write round-trip
 * and binding detection (env.CHESS_KV and globalThis.CHESS_KV).
 *
 * Run: node scripts/test-kv-key.mjs
 */
import { createRoom, getRoom, closeRoom } from '../edge-functions/lib/rooms.js';
import { storageInfo } from '../edge-functions/lib/room-store.js';

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    passed += 1;
    console.log(`✓ ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${extra ? ` (${extra})` : ''}`);
  }
};

const store = new Map();
const keys = [];
const mockKv = {
  async put(key, value) {
    keys.push(key);
    store.set(key, value);
  },
  async get(key) {
    return store.has(key) ? store.get(key) : null;
  },
  async delete(key) {
    store.delete(key);
  },
  async list() {
    return { complete: true, cursor: null, keys: [...store.keys()].map((key) => ({ key })) };
  },
};

const env = { CHESS_KV: mockKv };
ok('storageInfo detects env.CHESS_KV', storageInfo(env).kind === 'kv', storageInfo(env).binding);

const room = await createRoom(env, { game: 'gomoku', humanSide: 'first' });
ok('room created', !!room.code, room.code);

const key = [...store.keys()][0];
ok('KV key only uses letters/digits/underscores', /^[A-Za-z0-9_]+$/.test(key), key);
ok('KV key is not the old colon form', !key.includes(':'), key);
ok('value is JSON with the room code', JSON.parse(store.get(key)).code === room.code);

const loaded = await getRoom(env, room.code);
ok('read back through KV', loaded.code === room.code && loaded.version === room.version);

await closeRoom(env, room.code);
ok('delete removes the KV entry', !store.has(key));

const globalEnv = { CHESS_KV: mockKv };
globalThis.CHESS_KV = mockKv;
ok('storageInfo detects globalThis.CHESS_KV', storageInfo({}).kind === 'kv', storageInfo({}).binding);
delete globalThis.CHESS_KV;

ok('no binding → memory', storageInfo({}).kind === 'memory');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;