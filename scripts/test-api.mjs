import assert from 'node:assert/strict';
import { parseFen, START_FEN, legalMoves } from '../js/ai/chess-ai.js';

const base = process.env.BASE || 'http://localhost:8788';

async function post(path, body, timeout = 15000) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const health = await (await fetch(base + '/api/health')).json();
assert.equal(health.ok, true);
console.log('✓ /api/health');

for (let i = 0; i < 3; i++) {
  const g = await post('/api/ai/gomoku', { board: '0'.repeat(225), player: 1, level: 'normal' });
  assert.ok(Number.isInteger(g.move) && g.move >= 0 && g.move < 225, 'gomoku move out of range');
  assert.equal(typeof g.label, 'string');
  console.log(`✓ /api/ai/gomoku #${i + 1}: ${g.label} (${g.engine}, ${g.timeMs}ms, depth ${g.depth})`);
}

const legal = legalMoves(parseFen(START_FEN).board, 'w');
for (let i = 0; i < 3; i++) {
  const c = await post('/api/ai/chess', { fen: START_FEN, level: 'hard' });
  const parsed = parseFen(c.fen);
  assert.equal(parsed.board.filter(Boolean).length, 32, `corrupted chess board:\n${c.fen}`);
  assert.equal(parsed.board[c.to], c.piece);
  assert.ok(legal.some((m) => m.from === c.from && m.to === c.to), 'AI returned an illegal move');
  console.log(`✓ /api/ai/chess #${i + 1}: ${c.fromLabel}->${c.toLabel} (${c.engine}, ${c.timeMs}ms, depth ${c.depth})`);
}

const res = await fetch(base + '/api/ai/chess', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fen: 'garbage' }),
});
assert.equal(res.status, 400);
console.log('✓ invalid fen rejected with HTTP 400');

console.log('\nAll HTTP API checks passed.');