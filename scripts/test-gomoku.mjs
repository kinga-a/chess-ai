import assert from 'node:assert/strict';
import {
  BLACK,
  WHITE,
  DEFAULT_SIZE,
  newBoard,
  encodeBoard,
  decodeBoard,
  checkWinAt,
  scanWinner,
  findBestMove,
  playMove,
  coordToLabel,
  labelToCoord,
  getCandidates,
  evaluateBoard,
} from '../js/ai/gomoku-ai.js';

const S = DEFAULT_SIZE;
const P = (x, y) => y * S + x;
let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log(`✓ ${name}`);
}

test('board encode/decode round-trip', () => {
  const b = newBoard();
  b[P(7, 7)] = BLACK;
  b[P(8, 8)] = WHITE;
  const str = encodeBoard(b);
  assert.equal(str.length, S * S);
  const d = decodeBoard(str);
  assert.equal(d[P(7, 7)], BLACK);
  assert.equal(d[P(8, 8)], WHITE);
  assert.throws(() => decodeBoard('123'));
});

test('coordinate labels', () => {
  assert.equal(coordToLabel(P(7, 7)), 'H8');
  assert.equal(labelToCoord('H8').idx, P(7, 7));
  assert.equal(labelToCoord('A1').idx, 0);
  assert.equal(labelToCoord('O15').idx, S * S - 1);
  assert.equal(labelToCoord('Z9'), null);
});

test('horizontal / vertical / diagonal wins', () => {
  const h = newBoard();
  for (let i = 0; i < 5; i++) h[P(3 + i, 6)] = BLACK;
  assert.equal(checkWinAt(h, S, P(5, 6), BLACK).win, true);
  assert.equal(checkWinAt(h, S, P(5, 6), BLACK).line.length, 5);

  const v = newBoard();
  for (let i = 0; i < 5; i++) v[P(9, 2 + i)] = WHITE;
  assert.equal(scanWinner(v).player, WHITE);

  const d = newBoard();
  for (let i = 0; i < 5; i++) d[P(2 + i, 10 - i)] = BLACK;
  assert.equal(scanWinner(d).win, true);
});

test('playMove rejects occupied cells', () => {
  const b = newBoard();
  playMove(b, S, P(7, 7), BLACK);
  assert.throws(() => playMove(b, S, P(7, 7), WHITE));
});

test('AI takes an immediate win', () => {
  const b = newBoard();
  // white has four in a row: A1..D1
  for (let x = 0; x < 4; x++) b[P(x, 14)] = WHITE;
  b[P(0, 13)] = BLACK;
  const res = findBestMove(b, WHITE, { level: 'easy' });
  const label = coordToLabel(res.move);
  assert.equal(label, 'E15', `expected E15, got ${label}`);
});

test('AI blocks an immediate loss', () => {
  const b = newBoard();
  for (let x = 0; x < 4; x++) b[P(4 + x, 7)] = BLACK;
  b[P(7, 6)] = WHITE;
  const res = findBestMove(b, WHITE, { level: 'normal' });
  const label = coordToLabel(res.move);
  assert.ok(label === 'I8' || label === 'D8', `should block at D8/I8, got ${label}`);
});

test('AI returns a legal empty move within time budget', () => {
  const b = newBoard();
  b[P(7, 7)] = BLACK;
  b[P(7, 8)] = WHITE;
  b[P(8, 8)] = BLACK;
  const started = Date.now();
  const res = findBestMove(b, WHITE, { level: 'hard' });
  const elapsed = Date.now() - started;
  assert.equal(b[res.move], 0);
  assert.ok(elapsed < 2500, `hard AI took ${elapsed}ms`);
  console.log(`  hard AI: ${coordToLabel(res.move)} depth=${res.depth} nodes=${res.nodes} ${elapsed}ms`);
});

test('evaluation prefers stronger shape', () => {
  const a = newBoard();
  for (let x = 5; x < 8; x++) a[P(x, 7)] = BLACK; // open three
  const c = newBoard();
  for (let x = 5; x < 7; x++) c[P(x, 7)] = BLACK; // open two
  assert.ok(evaluateBoard(a, BLACK) > evaluateBoard(c, BLACK));
});

test('candidates only near existing stones', () => {
  const b = newBoard();
  b[P(7, 7)] = BLACK;
  const cands = getCandidates(b, S, WHITE, 20);
  assert.ok(cands.length > 0);
  for (const { idx } of cands) {
    const x = idx % S;
    const y = Math.floor(idx / S);
    assert.ok(Math.abs(x - 7) <= 2 && Math.abs(y - 7) <= 2);
  }
});

console.log(`\n${passed} tests passed`);