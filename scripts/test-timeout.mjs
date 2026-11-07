import assert from 'node:assert/strict';
import { findBestMove as chessBest, parseFen, START_FEN, toFen } from '../js/ai/chess-ai.js';
import { findBestMove as gomokuBest, newBoard, encodeBoard } from '../js/ai/gomoku-ai.js';

let pass = 0;
for (let i = 0; i < 12; i++) {
  const res = chessBest(START_FEN, { level: 'hard', timeMs: 20 });
  const parsed = parseFen(res.fen);
  const stones = parsed.board.filter(Boolean).length;
  assert.equal(stones, 32, `chess timeout left a corrupted board: ${stones} stones\n${res.fen}`);
  assert.equal(parsed.board[res.to], res.piece, 'moved piece is not on the target square');
  assert.ok(res.fromLabel && res.toLabel);
  pass++;
}
console.log(`✓ chess: ${pass} timeout runs kept the board intact`);

const b = newBoard();
b[112] = 1;
b[113] = 2;
const before = encodeBoard(b);
for (let i = 0; i < 12; i++) {
  gomokuBest(b, 1, { level: 'hard', timeMs: 15 });
  assert.equal(encodeBoard(b), before, 'gomoku timeout left a corrupted board');
}
console.log('✓ gomoku: 12 timeout runs kept the board intact');
