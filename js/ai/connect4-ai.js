/**
 * Connect Four engine.
 * 7 columns × 6 rows, players 1 / 2, move = column index (0-6).
 */

export const COLS = 7;
export const ROWS = 6;

export function createBoard() {
  return new Array(COLS * ROWS).fill(0);
}

export function legalMoves(board) {
  const out = [];
  for (let c = 0; c < COLS; c += 1) if (board[c] === 0) out.push(c);
  return out;
}

function dropRow(board, col) {
  for (let r = ROWS - 1; r >= 0; r -= 1) if (board[r * COLS + col] === 0) return r;
  return -1;
}

function checkWin(board, row, col, player) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of dirs) {
    let count = 1;
    const cells = [row * COLS + col];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === player) {
        count += 1;
        cells.push(r * COLS + c);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (count >= 4) return cells;
  }
  return null;
}

export function applyMove(board, move, player) {
  if (!Number.isInteger(move) || move < 0 || move >= COLS) return null;
  const row = dropRow(board, move);
  if (row < 0) return null;
  const next = board.slice();
  next[row * COLS + move] = player;
  const line = checkWin(next, row, move, player);
  const full = next.every((v) => v !== 0);
  return {
    board: next,
    row,
    col: move,
    index: row * COLS + move,
    line: line || [],
    win: !!line,
    winner: line ? player : 0,
    draw: !line && full,
    nextPlayer: line || full ? 0 : 3 - player,
  };
}

export function describeMove(move) {
  return `第 ${move + 1} 列`;
}

function windowScore(cells, player) {
  const opp = 3 - player;
  let mine = 0;
  let theirs = 0;
  let empty = 0;
  for (const v of cells) {
    if (v === player) mine += 1;
    else if (v === opp) theirs += 1;
    else empty += 1;
  }
  if (mine && theirs) return 0;
  if (mine === 3 && empty === 1) return 50;
  if (mine === 2 && empty === 2) return 10;
  if (mine === 4) return 100000;
  if (theirs === 3 && empty === 1) return -80;
  if (theirs === 2 && empty === 2) return -12;
  if (theirs === 4) return -100000;
  return 0;
}

export function evaluate(board, player) {
  let score = 0;
  // horizontal
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c <= COLS - 4; c += 1) {
      score += windowScore([0, 1, 2, 3].map((i) => board[r * COLS + c + i]), player);
    }
  }
  // vertical
  for (let c = 0; c < COLS; c += 1) {
    for (let r = 0; r <= ROWS - 4; r += 1) {
      score += windowScore([0, 1, 2, 3].map((i) => board[(r + i) * COLS + c]), player);
    }
  }
  // diagonals
  for (let r = 0; r <= ROWS - 4; r += 1) {
    for (let c = 0; c <= COLS - 4; c += 1) {
      score += windowScore([0, 1, 2, 3].map((i) => board[(r + i) * COLS + c + i]), player);
      score += windowScore([0, 1, 2, 3].map((i) => board[(r + 3 - i) * COLS + c + i]), player);
    }
  }
  // center preference
  for (let r = 0; r < ROWS; r += 1) {
    const v = board[r * COLS + 3];
    if (v === player) score += 4;
    else if (v === 3 - player) score -= 4;
  }
  return score;
}

function cloneApply(board, col, player) {
  const row = dropRow(board, col);
  const next = board.slice();
  next[row * COLS + col] = player;
  return { board: next, row };
}

function negamax(board, player, depth, alpha, beta, budget) {
  if (depth === 0 || budget.nodes > budget.limit) return evaluate(board, player);
  let best = -Infinity;
  for (const col of legalMoves(board)) {
    budget.nodes += 1;
    const { board: next, row } = cloneApply(board, col, player);
    if (checkWin(next, row, col, player)) return 100000 + depth;
    const score = -negamax(next, 3 - player, depth - 1, -beta, -alpha, budget);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function findBestMove({ board, player, level = 'normal' }) {
  const moves = legalMoves(board);
  if (!moves.length) return -1;

  if (level === 'easy' && Math.random() < 0.3) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const depth = level === 'easy' ? 2 : level === 'hard' ? 6 : 4;
  const budget = { nodes: 0, limit: level === 'hard' ? 60000 : 20000 };
  const order = moves.slice().sort((a, b) => Math.abs(3 - a) - Math.abs(3 - b));

  let best = -Infinity;
  let bestMove = order[0];
  let alpha = -Infinity;
  for (const col of order) {
    budget.nodes += 1;
    const { board: next, row } = cloneApply(board, col, player);
    const score = checkWin(next, row, col, player)
      ? 100000
      : -negamax(next, 3 - player, depth - 1, -Infinity, -alpha, budget);
    if (score > best) {
      best = score;
      bestMove = col;
    }
    if (score > alpha) alpha = score;
  }
  return bestMove;
}

export function winnerOf(board) {
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const v = board[r * COLS + c];
      if (v && checkWin(board, r, c, v)) return v;
    }
  }
  return 0;
}

export function statusOf(board) {
  const winner = winnerOf(board);
  if (winner) return { status: 'over', winner, reason: 'four' };
  if (board.every((v) => v !== 0)) return { status: 'over', winner: 0, reason: 'draw' };
  return { status: 'playing', winner: 0, reason: null };
}