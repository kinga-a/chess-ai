import assert from 'node:assert/strict';
import {
  START_FEN,
  RED,
  BLACK,
  parseFen,
  toFen,
  legalMoves,
  pseudoMoves,
  parseSquare,
  squareLabel,
  applyMoveByLabel,
  findBestMove,
  describe,
  isKingAttacked,
  isSquareAttacked,
  idx,
} from '../js/ai/chess-ai.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`✓ ${name}`);
}

function emptyBoard() {
  return new Array(90).fill(null);
}

test('FEN round-trip', () => {
  const parsed = parseFen(START_FEN);
  assert.equal(parsed.side, RED);
  assert.equal(parsed.board[idx(9, 0)], 'R');
  assert.equal(parsed.board[idx(0, 4)], 'k');
  assert.equal(toFen(parsed.board, RED), START_FEN.split(' ').slice(0, 4).join(' ') + ' 0 1');
});

test('initial position has 44 red legal moves', () => {
  const parsed = parseFen(START_FEN);
  const moves = legalMoves(parsed.board, RED);
  assert.equal(moves.length, 44, `got ${moves.length}`);
});

test('ICCS square labels', () => {
  assert.deepEqual(parseSquare('a0'), { r: 9, c: 0, idx: idx(9, 0) });
  assert.deepEqual(parseSquare('i9'), { r: 0, c: 8, idx: idx(0, 8) });
  assert.equal(squareLabel(4, 4), 'e5');
  assert.equal(parseSquare([4, 4]).idx, idx(4, 4));
  assert.equal(parseSquare('z9'), null);
});

test('horse is blocked by its leg', () => {
  const b = emptyBoard();
  b[idx(9, 1)] = 'N';
  b[idx(9, 4)] = 'K';
  b[idx(0, 4)] = 'k';
  b[idx(8, 1)] = 'p'; // leg blocker
  const targets = pseudoMoves(b, RED)
    .filter((m) => m.from === idx(9, 1))
    .map((m) => squareLabel(Math.floor(m.to / 9), m.to % 9));
  assert.ok(!targets.includes('a7') && !targets.includes('c7'), JSON.stringify(targets));
});

test('elephant cannot cross the river or jump a blocked eye', () => {
  const b = emptyBoard();
  b[idx(9, 2)] = 'B';
  b[idx(9, 4)] = 'K';
  b[idx(0, 4)] = 'k';
  b[idx(8, 1)] = 'P'; // blocks the elephant eye toward (7,0)
  let targets = pseudoMoves(b, RED)
    .filter((m) => m.from === idx(9, 2))
    .map((m) => squareLabel(Math.floor(m.to / 9), m.to % 9));
  assert.ok(!targets.includes('a2'), 'blocked eye');
  assert.ok(targets.includes('e2'), `expected e2 in ${targets}`);
  // piece on the river bank cannot fly over
  const c = emptyBoard();
  c[idx(5, 2)] = 'B';
  c[idx(9, 4)] = 'K';
  c[idx(0, 4)] = 'k';
  targets = pseudoMoves(c, RED)
    .filter((m) => m.from === idx(5, 2))
    .map((m) => squareLabel(Math.floor(m.to / 9), m.to % 9));
  assert.ok(!targets.includes('a6'), 'elephant cannot cross river');
});

test('cannon needs exactly one screen to capture', () => {
  const b = emptyBoard();
  b[idx(5, 4)] = 'C';
  b[idx(3, 4)] = 'r';
  b[idx(9, 4)] = 'K';
  b[idx(0, 0)] = 'k';
  let moves = pseudoMoves(b, RED).filter((m) => m.from === idx(5, 4));
  assert.ok(!moves.some((m) => m.to === idx(3, 4)), 'no screen → cannot capture');
  b[idx(4, 4)] = 'P'; // screen
  moves = pseudoMoves(b, RED).filter((m) => m.from === idx(5, 4));
  assert.ok(moves.some((m) => m.to === idx(3, 4)), 'with one screen → can capture');
});

test('soldier moves sideways only after crossing the river', () => {
  const b = emptyBoard();
  b[idx(4, 4)] = 'P';
  b[idx(9, 4)] = 'K';
  b[idx(0, 0)] = 'k';
  let moves = pseudoMoves(b, RED).filter((m) => m.from === idx(4, 4));
  assert.deepEqual(moves.map((m) => squareLabel(Math.floor(m.to / 9), m.to % 9)).sort(), ['d5', 'e6', 'f5']);
  const c = emptyBoard();
  c[idx(6, 4)] = 'P';
  c[idx(9, 4)] = 'K';
  c[idx(0, 0)] = 'k';
  moves = pseudoMoves(c, RED).filter((m) => m.from === idx(6, 4));
  assert.deepEqual(moves.map((m) => squareLabel(Math.floor(m.to / 9), m.to % 9)).sort(), ['e4']);
});

test('flying generals are treated as check', () => {
  const b = emptyBoard();
  b[idx(9, 4)] = 'K';
  b[idx(0, 4)] = 'k';
  b[idx(0, 8)] = 'r';
  assert.equal(isKingAttacked(b, RED), true);
  b[idx(5, 4)] = 'P';
  assert.equal(isKingAttacked(b, RED), false);
});

test('a move exposing the king is filtered out', () => {
  const b = emptyBoard();
  b[idx(0, 4)] = 'k';
  b[idx(9, 4)] = 'K';
  b[idx(7, 4)] = 'P';
  // The soldier is the only blocker on the e-file.
  assert.equal(isKingAttacked(b, RED), false);
  b[idx(7, 4)] = null;
  assert.equal(isKingAttacked(b, RED), true);
  b[idx(7, 4)] = 'P';
  const moves = legalMoves(b, RED).filter((m) => m.from === idx(7, 4));
  assert.ok(moves.length > 0);
  for (const mv of moves) assert.equal(mv.to % 9, 4);
});

test('checkmate detection', () => {
  // Red rooks on e9, a10 and i9 deliver mate to the black king on e10.
  const fen = 'R3k4/4R3R/9/9/9/9/9/9/9/4K4 b - - 0 1';
  const status = describe(fen);
  assert.equal(status.check, true);
  assert.equal(status.checkmate, true);
  assert.equal(status.legalMoves, 0);
});

test('applyMoveByLabel rejects illegal moves', () => {
  assert.throws(() => applyMoveByLabel(START_FEN, 'a0', 'a3'));
  assert.throws(() => applyMoveByLabel(START_FEN, 'e9', 'e8'));
  const res = applyMoveByLabel(START_FEN, 'b2', 'e2');
  assert.equal(res.fen.split(' ')[1], 'b');
});

test('AI returns a legal move quickly', () => {
  const started = Date.now();
  const res = findBestMove(START_FEN, { level: 'normal' });
  const elapsed = Date.now() - started;
  assert.ok(res.from >= 0 && res.to >= 0);
  assert.ok(elapsed < 2500, `took ${elapsed}ms`);
  console.log(`  normal AI: ${res.fromLabel}->${res.toLabel} depth=${res.depth} nodes=${res.nodes} ${elapsed}ms`);
  const parsed = parseFen(START_FEN);
  const legal = legalMoves(parsed.board, RED);
  assert.ok(legal.some((m) => m.from === res.from && m.to === res.to));
});

test('AI wins material when a rook hangs', () => {
  const fen = '4k4/9/9/9/9/5R2r/9/9/9/3K5 w - - 0 1';
  const res = findBestMove(fen, { level: 'normal' });
  assert.equal(res.fromLabel, 'f4', `expected rook lift from f4, got ${res.fromLabel}`);
  assert.equal(res.toLabel, 'i4', `expected capture on i4, got ${res.toLabel}`);
  assert.equal(res.capture, 'r');
});

console.log(`\n${passed} tests passed`);