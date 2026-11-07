/**
 * Rule + AI checks for the three board games.
 * Run: node scripts/test-board-games.mjs
 */
import * as ttt from '../js/ai/tictactoe-ai.js';
import * as c4 from '../js/ai/connect4-ai.js';
import * as oth from '../js/ai/othello-ai.js';

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

/* ---------------- tic-tac-toe ---------------- */
{
  const board = ttt.createBoard();
  ok('ttt: empty board has 9 moves', ttt.legalMoves(board).length === 9);

  // black wins on top row
  let b = board.slice();
  b[0] = 1; b[1] = 1;
  const res = ttt.applyMove(b, 2, 1);
  ok('ttt: top row win detected', res.win && res.winner === 1);

  // draw
  const draw = [1, 2, 1, 1, 2, 2, 2, 1, 1];
  ok('ttt: full board draw', ttt.statusOf(draw).reason === 'draw');

  // AI takes the winning move
  const winNow = [1, 1, 0, 2, 2, 0, 0, 0, 0];
  const move = ttt.findBestMove({ board: winNow, player: 1, level: 'hard' });
  ok('ttt AI: takes immediate win', move === 2, `move ${move}`);

  // AI blocks
  const block = [2, 2, 0, 1, 0, 0, 0, 0, 0];
  const blockMove = ttt.findBestMove({ board: block, player: 1, level: 'hard' });
  ok('ttt AI: blocks opponent', blockMove === 2, `move ${blockMove}`);

  // never loses as first player (perfect play): play out vs AI
  let sim = ttt.createBoard();
  let player = 1;
  while (ttt.statusOf(sim).status === 'playing') {
    const m = ttt.findBestMove({ board: sim, player, level: 'hard' });
    const r = ttt.applyMove(sim, m, player);
    sim = r.board;
    if (r.winner === 2) break;
    player = r.nextPlayer;
  }
  ok('ttt AI: first player never loses', ttt.statusOf(sim).winner !== 2);

  // 4×4 variant
  const b4 = ttt.createBoard({ size: 4 });
  ok('ttt: 4x4 board size', b4.length === 16);
  const r4 = ttt.applyMove([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3, 1);
  ok('ttt: 4x4 four-in-row wins', r4.win && r4.winner === 1);
}

/* ---------------- connect four ---------------- */
{
  const board = c4.createBoard();
  ok('c4: 7 legal columns', c4.legalMoves(board).length === 7);

  // stacking: same column fills upward
  let b = board.slice();
  let r = c4.applyMove(b, 3, 1);
  b = r.board;
  ok('c4: first disc lands bottom row', r.row === 5);
  r = c4.applyMove(b, 3, 2);
  b = r.board;
  ok('c4: second disc stacks above', r.row === 4);

  // horizontal win
  let h = c4.createBoard();
  for (let c = 0; c < 3; c += 1) h = c4.applyMove(h, c, 1).board;
  const hw = c4.applyMove(h, 3, 1);
  ok('c4: horizontal four wins', hw.win && hw.winner === 1);

  // vertical win
  let v = c4.createBoard();
  for (let i = 0; i < 3; i += 1) v = c4.applyMove(v, 0, 1).board;
  const vw = c4.applyMove(v, 0, 1);
  ok('c4: vertical four wins', vw.win && vw.winner === 1);

  // diagonal win
  let d = c4.createBoard();
  d = c4.applyMove(d, 0, 1).board; d = c4.applyMove(d, 1, 2).board;
  d = c4.applyMove(d, 1, 1).board; d = c4.applyMove(d, 2, 2).board;
  d = c4.applyMove(d, 2, 2).board; d = c4.applyMove(d, 2, 1).board;
  d = c4.applyMove(d, 3, 2).board; d = c4.applyMove(d, 3, 2).board;
  d = c4.applyMove(d, 3, 2).board;
  const dw = c4.applyMove(d, 3, 1);
  ok('c4: diagonal four wins', dw.win && dw.winner === 1);

  // AI takes the win
  let w = c4.createBoard();
  for (let c = 0; c < 3; c += 1) w = c4.applyMove(w, c, 1).board;
  w = c4.applyMove(w, 6, 2).board;
  const winMove = c4.findBestMove({ board: w, player: 1, level: 'hard' });
  ok('c4 AI: takes winning column', winMove === 3, `move ${winMove}`);

  // AI blocks
  let bl = c4.createBoard();
  for (let c = 0; c < 3; c += 1) bl = c4.applyMove(bl, c, 2).board;
  bl = c4.applyMove(bl, 6, 1).board;
  const blockMove = c4.findBestMove({ board: bl, player: 1, level: 'hard' });
  ok('c4 AI: blocks opponent four', blockMove === 3, `move ${blockMove}`);
}

/* ---------------- othello ---------------- */
{
  const board = oth.createBoard();
  ok('othello: starts with 4 discs', board.filter((v) => v).length === 4);
  ok('othello: black has 4 legal moves', oth.legalMoves(board, 1).length === 4);

  const first = oth.applyMove(board, 19, 1); // d3
  ok('othello: first move flips one disc', first && first.flipped.length === 1, `flipped ${first && first.flipped.length}`);
  ok('othello: turn passes to white', first && first.nextPlayer === 2);

  // corner move flips along two directions later in the game
  let b = board.slice();
  b[1] = 2;
  b[2] = 1;
  const corner = oth.applyMove(b, 0, 1);
  ok('othello: corner capture flips discs', corner && corner.flipped.length >= 1, `flipped ${corner && corner.flipped.length}`);

  // full random playout terminates with a winner
  let sim = oth.createBoard();
  let player = 1;
  let guard = 0;
  while (guard < 200) {
    guard += 1;
    const moves = oth.legalMoves(sim, player);
    if (!moves.length) {
      if (!oth.legalMoves(sim, 3 - player).length) break;
      player = 3 - player;
      continue;
    }
    const r = oth.applyMove(sim, moves[0], player);
    if (!r) break;
    sim = r.board;
    if (r.nextPlayer === 0) break;
    player = r.nextPlayer;
  }
  const score = oth.scoreOf(sim);
  ok('othello: playout reaches a final position', score.black + score.white >= 4, `${score.black}/${score.white}`);

  // AI prefers a corner when available
  let c = oth.createBoard();
  c[1] = 2;
  c[2] = 1;
  const best = oth.findBestMove({ board: c, player: 1, level: 'hard' });
  ok('othello AI: prefers corner', best === 0, `move ${best}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;