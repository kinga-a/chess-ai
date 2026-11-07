/**
 * Tic-tac-toe engine (3×3 classic, 4×4 variant).
 * Players: 1 / 2. Board: flat array, 0 = empty.
 * Shared by the browser, the edge functions and MCP.
 */

export function createBoard(options = {}) {
  const size = options.size === 4 ? 4 : 3;
  return new Array(size * size).fill(0);
}

export function boardSize(board) {
  return Math.round(Math.sqrt(board.length));
}

function winLines(size) {
  const lines = [];
  for (let r = 0; r < size; r += 1) lines.push(Array.from({ length: size }, (_, c) => r * size + c));
  for (let c = 0; c < size; c += 1) lines.push(Array.from({ length: size }, (_, r) => r * size + c));
  lines.push(Array.from({ length: size }, (_, i) => i * size + i));
  lines.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)));
  return lines;
}

export function winnerOf(board) {
  const size = boardSize(board);
  for (const line of winLines(size)) {
    const v = board[line[0]];
    if (v && line.every((idx) => board[idx] === v)) return v;
  }
  return 0;
}

export function isFull(board) {
  return board.every((v) => v !== 0);
}

export function legalMoves(board) {
  const out = [];
  for (let i = 0; i < board.length; i += 1) if (board[i] === 0) out.push(i);
  return out;
}

export function applyMove(board, move, player) {
  if (!Number.isInteger(move) || move < 0 || move >= board.length || board[move] !== 0) return null;
  const next = board.slice();
  next[move] = player;
  const winner = winnerOf(next);
  const full = isFull(next);
  return {
    board: next,
    win: !!winner,
    winner,
    draw: !winner && full,
    nextPlayer: winner || full ? 0 : 3 - player,
  };
}

export function describeMove(move, size = 3) {
  const col = move % size;
  const row = Math.floor(move / size);
  return `${'ABCDEFGH'[col] || '?'}${row + 1}`;
}

function heuristic(board, player) {
  const size = boardSize(board);
  const opp = 3 - player;
  let score = 0;
  for (const line of winLines(size)) {
    let mine = 0;
    let theirs = 0;
    for (const idx of line) {
      if (board[idx] === player) mine += 1;
      else if (board[idx] === opp) theirs += 1;
    }
    if (mine && !theirs) score += mine * mine;
    if (theirs && !mine) score -= theirs * theirs;
  }
  return score;
}

function negamax(board, player, depth, alpha, beta, budget) {
  const w = winnerOf(board);
  if (w) return w === player ? 1000 + depth : -1000 - depth;
  if (isFull(board)) return 0;
  if (depth === 0 || budget.nodes > budget.limit) return heuristic(board, player);

  let best = -Infinity;
  for (const move of legalMoves(board)) {
    budget.nodes += 1;
    const next = board.slice();
    next[move] = player;
    const score = -negamax(next, 3 - player, depth - 1, -beta, -alpha, budget);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function findBestMove({ board, player, level = 'normal', avoid = null }) {
  const moves = legalMoves(board);
  if (!moves.length) return -1;
  if (moves.length === board.length) {
    const size = boardSize(board);
    const center = Math.floor(size / 2) * size + Math.floor(size / 2);
    return center;
  }

  const size = boardSize(board);
  const depth = level === 'easy' ? 2 : level === 'hard' ? (size === 3 ? 9 : 5) : size === 3 ? 9 : 4;
  const budget = { nodes: 0, limit: level === 'hard' ? 120000 : 30000 };

  if (level === 'easy' && Math.random() < 0.35) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  let bestScore = -Infinity;
  let bestMove = moves[0];
  let order = moves.slice().sort((a, b) => {
    const ca = Math.abs(a % size - (size - 1) / 2) + Math.abs(Math.floor(a / size) - (size - 1) / 2);
    const cb = Math.abs(b % size - (size - 1) / 2) + Math.abs(Math.floor(b / size) - (size - 1) / 2);
    return ca - cb;
  });
  if (avoid !== null && order.length > 1) order = order.filter((m) => m !== avoid);

  let alpha = -Infinity;
  for (const move of order) {
    const next = board.slice();
    next[move] = player;
    const score = -negamax(next, 3 - player, depth - 1, -Infinity, -alpha, budget);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
  }
  return bestMove;
}

export function evaluate(board, player) {
  return heuristic(board, player);
}

export function statusOf(board) {
  const winner = winnerOf(board);
  if (winner) return { status: 'over', winner, reason: 'line' };
  if (isFull(board)) return { status: 'over', winner: 0, reason: 'draw' };
  return { status: 'playing', winner: 0, reason: null };
}