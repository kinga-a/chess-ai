/**
 * Multi-room consistency probe.
 *
 * Creates N rooms, then probes each one ROUNDS times. On a single instance
 * every room should be visible 100% of the time. On a multi-instance
 * deployment without KV you will typically see some rooms intermittently 404.
 *
 *   node scripts/test-rooms-multi.mjs
 *   BASE=https://your-domain ADMIN_PASS=xxx ROOMS=20 ROUNDS=30 node scripts/test-rooms-multi.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
const KEY = process.env.ADMIN_PASS || process.env.ACCESS_KEY || '';
const ROOMS = Number(process.env.ROOMS || 10);
const ROUNDS = Number(process.env.ROUNDS || 20);

const headers = { 'Content-Type': 'application/json' };
if (KEY) headers.Authorization = `Bearer ${KEY}`;

async function post(payload) {
  const res = await fetch(`${BASE}/api/room`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function probe(code) {
  const res = await fetch(`${BASE}/api/room?code=${code}`, { headers });
  return res.status;
}

async function create(code = 0) {
  const data = await post({ action: 'create', game: 'gomoku', humanSide: 'first' });
  return data.room.code;
}

const codes = [];
for (let i = 0; i < ROOMS; i += 1) codes.push(await create(i));

const stats = new Map(codes.map((code) => [code, { ok: 0, lost: 0 }]));
for (let round = 0; round < ROUNDS; round += 1) {
  for (const code of codes) {
    const status = await probe(code);
    const entry = stats.get(code);
    if (status === 200) entry.ok += 1;
    else entry.lost += 1;
  }
}

console.log(`endpoint : ${BASE}`);
console.log(`rooms    : ${ROOMS}   rounds: ${ROUNDS}\n`);
console.log('code     ok/total   404');
let totalLost = 0;
for (const code of codes) {
  const entry = stats.get(code);
  totalLost += entry.lost;
  console.log(`${code}   ${String(entry.ok).padStart(2)}/${ROUNDS}      ${entry.lost}`);
}

const rate = ((totalLost / (ROOMS * ROUNDS)) * 100).toFixed(1);
console.log(`\n丢房率: ${rate}%  (${totalLost}/${ROOMS * ROUNDS})`);
if (totalLost === 0) {
  console.log('结果稳定：当前实例共享同一份存储（单实例或已绑定 KV）。');
} else {
  console.log('出现丢失：很可能是多实例 + 未绑定 KV，请绑定变量名为 KV 的命名空间。');
}

// best-effort cleanup
await Promise.allSettled(codes.map((code) => post({ action: 'delete', code })));