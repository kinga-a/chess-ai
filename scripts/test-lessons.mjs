/**
 * Failure-memory checks: a lost game must make the AI vary next time.
 * Run: node scripts/test-lessons.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8788';
let passed = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed += 1; console.log(`✓ ${name}${extra ? ` (${extra})` : ''}`); }
  else { failed += 1; console.log(`✗ ${name}${extra ? ` (${extra})` : ''}`); }
};

async function post(payload) {
  const res = await fetch(`${BASE}/api/room`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function get(code) {
  const res = await fetch(`${BASE}/api/room?code=${code}`);
  return (await res.json()).room;
}

// 1. replay the losing game (AI loses as black)
const first = await post({ action: 'create', game: 'chess', humanSide: 'red' });
const code1 = first.data.room.code;
const seq = [['h2', 'e2'], ['b7', 'c7'], ['b2', 'b4'], ['c7', 'c3'], ['e2', 'e6'], ['c3', 'g3'], ['b4', 'e4']];
for (const [from, to] of seq) await post({ action: 'move', code: code1, from, to });
const lost = await get(code1);
ok('losing game recorded as over', lost.status === 'over' && lost.winner === 'w', `winner ${lost.winner}`);

// 2. same opening again -> AI must avoid the previous reply (b7-c7)
const second = await post({ action: 'create', game: 'chess', humanSide: 'red' });
const code2 = second.data.room.code;
await post({ action: 'move', code: code2, from: 'h2', to: 'e2' });
const ai = await post({ action: 'ai_move', code: code2 });
const reply = ai.data.room.moves[1];
ok('AI answers', ai.status === 200 && !!reply, `${reply && reply.fromLabel}→${reply && reply.toLabel}`);
ok('AI varies instead of repeating b7-c7', reply.fromLabel !== 'b7' || reply.toLabel !== 'c7');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
