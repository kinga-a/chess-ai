/**
 * Othello / Reversi engine.
 * 8×8, players 1 (black) / 2 (white), move = cell index.
 * Handles pass turns when a player has no legal move.
 */

const SIZE = 8;
const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

export function createBoard() {
  const board = new Array(SIZE * SIZE).fill(0);
  board[27] = 2; // d4 white
  board[28] = 1; // e4 black
  board[35] = 1; // d5 black
  board[36] = 2; // e5 white
  return board;
}

function flips(board, idx, player) {
  if (board[idx] !== 0) return [];
  const row0 = Math.floor(idx / SIZE);
  const col0 = idx % SIZE;
  const out = [];
  for (const [dr, dc] of DIRS) {
    let r = row0 + dr;
    let c = col0 + dc;
    const line = [];
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
      const v = board[r * SIZE + c];
      if (v === 0) break;
      if (v === player) {
        if (line.length) out.push(...line);
        break;
      }
      line.push(r * SIZE + c);
      r += dr;
      c += dc;
    }
  }
  return out;
}

export function legalMoves(board, player) {
  const out = [];
  for (let i = 0; i < board.length; i += 1) {
    if (board[i] === 0 && flips(board, i, player).length) out.push(i);
  }
  return out;
}

export function applyMove(board, move, player) {
  if (!Number.isInteger(move) || move < 0 || move >= board.length) return null;
  const flipped = flips(board, move, player);
  if (!flipped.length) return null;
  const next = board.slice();
  next[move] = player;
  for (const idx of flipped) next[idx] = player;

  const opp = 3 - player;
  let nextPlayer = opp;
  if (!legalMoves(next, opp).length) {
    nextPlayer = legalMoves(next, player).length ? player : 0;
  }

  const black = next.filter((v) => v === 1).length;
  const white = next.filter((v) => v === 2).length;
  const over = nextPlayer === 0;
  return {
    board: next,
    flipped,
    win: over && black !== white,
    winner: over ? (black > white ? 1 : white > black ? 2 : 0) : 0,
    draw: over && black === white,
    nextPlayer,
    black,
    white,
  };
}

export function describeMove(move) {
  return `${'ABCDEFGH'[move % SIZE]}${Math.floor(move / SIZE) + 1}`;
}

export function scoreOf(board) {
  const black = board.filter((v) => v === 1).length;
  const white = board.filter((v) => v === 2).length;
  return { black, white };
}

export function evaluate(board, player) {
  const opp = 3 - player;
  let score = 0;
  for (let i = 0; i < board.length; i += 1) {
    if (board[i] === player) score += WEIGHTS[i];
    else if (board[i] === opp) score -= WEIGHTS[i];
  }
  const mobility = legalMoves(board, player).length - legalMoves(board, opp).length;
  score += mobility * 8;
  return score;
}

function finalScore(board, player) {
  const { black, white } = scoreOf(board);
  const diff = player === 1 ? black - white : white - black;
  return diff * 100;
}

function negamax(board, player, depth, alpha, beta, budget) {
  if (budget.nodes > budget.limit) return evaluate(board, player);
  const moves = legalMoves(board, player);
  if (!moves.length) {
    if (!legalMoves(board, 3 - player).length) return finalScore(board, player);
    return -negamax(board, 3 - player, depth - 1, -beta, -alpha, budget);
  }
  if (depth === 0) return evaluate(board, player);

  let best = -Infinity;
  for (const move of moves) {
    budget.nodes += 1;
    const res = applyMove(board, move, player);
    if (!res) continue;
    const score = -negamax(res.board, 3 - player, depth - 1, -beta, -alpha, budget);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function findBestMove({ board, player, level = 'normal' }) {
  const moves = legalMoves(board, player);
  if (!moves.length) return -1;
  if (moves.length === 1) return moves[0];

  if (level === 'easy' && Math.random() < 0.35) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const depth = level === 'easy' ? 1 : level === 'hard' ? 5 : 3;
  const budget = { nodes: 0, limit: level === 'hard' ? 30000 : 12000 };

  const order = moves.slice().sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);
  let best = -Infinity;
  let bestMove = order[0];
  let alpha = -Infinity;
  for (const move of order) {
    budget.nodes += 1;
    const res = applyMove(board, move, player);
    if (!res) continue;
    const score = -negamax(res.board, 3 - player, depth - 1, -Infinity, -alpha, budget);
    if (score > best) {
      best = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
  }
  return bestMove;
}

export function statusOf(board, nextPlayer) {
  if (nextPlayer === 0) {
    const { black, white } = scoreOf(board);
    return {
      status: 'over',
      winner: black > white ? 1 : white > black ? 2 : 0,
      reason: black === white ? 'draw' : 'count',
    };
  }
  return { status: 'playing', winner: 0, reason: null };
}

export function size() {
  return SIZE;
}