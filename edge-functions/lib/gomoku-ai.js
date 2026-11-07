/**
 * Gomoku (Five in a Row) engine — isomorphic.
 * Runs in the browser (Web Worker), in Node.js tests and inside EdgeOne Edge Functions.
 * No DOM / Node APIs are used.
 *
 * Board encoding:
 *   - Uint8Array of size*size, 0 = empty, 1 = black, 2 = white
 *   - Wire format: string of '0' | '1' | '2' (row-major, top row first)
 *   - Labels: columns A..O (left to right), rows 1..15 (top to bottom), e.g. "H8"
 */

export const DEFAULT_SIZE = 15;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

const WIN_SCORE = 100000000;
const TIMEOUT = Symbol('timeout');

export const LEVELS = {
  easy: { depth: 1, width: 18, timeMs: 160, label: '入门' },
  normal: { depth: 3, width: 12, timeMs: 520, label: '进阶' },
  hard: { depth: 4, width: 10, timeMs: 950, label: '大师' },
};

function now() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

export function newBoard(size = DEFAULT_SIZE) {
  return new Uint8Array(size * size);
}

export function cloneBoard(board) {
  return Uint8Array.from(board);
}

export function boardSize(board) {
  const n = Math.sqrt(board.length);
  return Number.isInteger(n) ? n : DEFAULT_SIZE;
}

export function encodeBoard(board) {
  let out = '';
  for (let i = 0; i < board.length; i++) out += board[i] === 1 ? '1' : board[i] === 2 ? '2' : '0';
  return out;
}

export function decodeBoard(str, size = DEFAULT_SIZE) {
  if (typeof str !== 'string') throw new Error('board must be a string');
  if (str.length !== size * size) {
    throw new Error(`board must contain ${size * size} cells, got ${str.length}`);
  }
  const board = new Uint8Array(size * size);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch !== '0' && ch !== '1' && ch !== '2') {
      throw new Error(`invalid cell "${ch}" at index ${i}`);
    }
    board[i] = ch === '1' ? BLACK : ch === '2' ? WHITE : EMPTY;
  }
  return board;
}

export function idxToXY(idx, size = DEFAULT_SIZE) {
  return { x: idx % size, y: Math.floor(idx / size) };
}

export function xyToIdx(x, y, size = DEFAULT_SIZE) {
  return y * size + x;
}

export function inBounds(x, y, size) {
  return x >= 0 && x < size && y >= 0 && y < size;
}

/** Human friendly coordinate label, e.g. "H8". */
export function coordToLabel(idx, size = DEFAULT_SIZE) {
  const { x, y } = idxToXY(idx, size);
  if (x < 0 || x >= size) return null;
  const letters = 'ABCDEFGHIJKLMNO';
  return `${letters[x]}${y + 1}`;
}

export function labelToCoord(label, size = DEFAULT_SIZE) {
  if (typeof label !== 'string') return null;
  const m = /^([A-Oa-o])(\d{1,2})$/.exec(label.trim());
  if (!m) return null;
  const x = m[1].toUpperCase().charCodeAt(0) - 65;
  const y = Number(m[2]) - 1;
  if (!inBounds(x, y, size)) return null;
  return { x, y, idx: xyToIdx(x, y, size) };
}

export function countStones(board) {
  let black = 0;
  let white = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] === BLACK) black++;
    else if (board[i] === WHITE) white++;
  }
  return { black, white, total: black + white };
}

/** Whose turn it is derived from stone counts (black moves first). */
export function turnOf(board) {
  const { black, white } = countStones(board);
  return black === white ? BLACK : WHITE;
}

/**
 * Check a five-in-a-row through the last placed stone.
 * @returns {{win:boolean, player:number, line:number[]}}
 */
export function checkWinAt(board, size, idx, player = board[idx]) {
  if (!player) return { win: false, player: EMPTY, line: [] };
  const { x, y } = idxToXY(idx, size);
  for (const [dx, dy] of DIRS) {
    const line = [idx];
    for (let s = 1; s < 5; s++) {
      const nx = x + dx * s;
      const ny = y + dy * s;
      if (!inBounds(nx, ny, size) || board[ny * size + nx] !== player) break;
      line.push(ny * size + nx);
    }
    for (let s = 1; s < 5; s++) {
      const nx = x - dx * s;
      const ny = y - dy * s;
      if (!inBounds(nx, ny, size) || board[ny * size + nx] !== player) break;
      line.unshift(ny * size + nx);
    }
    if (line.length >= 5) return { win: true, player, line };
  }
  return { win: false, player: EMPTY, line: [] };
}

/** Scan the whole board for an existing five-in-a-row (used to resume games). */
export function scanWinner(board, size = boardSize(board)) {
  for (let i = 0; i < board.length; i++) {
    const v = board[i];
    if (!v) continue;
    const res = checkWinAt(board, size, i, v);
    if (res.win) return res;
  }
  return { win: false, player: EMPTY, line: [] };
}

function lineShapeScore(count, openEnds) {
  if (count >= 5) return WIN_SCORE;
  if (openEnds === 0) return 0;
  if (count === 4) return openEnds === 2 ? 1200000 : 150000;
  if (count === 3) return openEnds === 2 ? 60000 : 6000;
  if (count === 2) return openEnds === 2 ? 900 : 130;
  return openEnds === 2 ? 18 : 6;
}

/**
 * Score all four lines formed by `player` on `idx` (assumes the stone is placed).
 */
function shapeScoreAt(board, size, idx, player) {
  const prev = board[idx];
  board[idx] = player;
  const { x, y } = idxToXY(idx, size);
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let count = 1;
    let openA = 0;
    let openB = 0;
    let nx = x + dx;
    let ny = y + dy;
    while (inBounds(nx, ny, size) && board[ny * size + nx] === player) {
      count++;
      nx += dx;
      ny += dy;
    }
    if (inBounds(nx, ny, size) && board[ny * size + nx] === EMPTY) openA = 1;
    nx = x - dx;
    ny = y - dy;
    while (inBounds(nx, ny, size) && board[ny * size + nx] === player) {
      count++;
      nx -= dx;
      ny -= dy;
    }
    if (inBounds(nx, ny, size) && board[ny * size + nx] === EMPTY) openB = 1;
    total += lineShapeScore(count, openA + openB);
  }
  board[idx] = prev;
  return total;
}

/** Static evaluation from `player`'s point of view. */
export function evaluateBoard(board, player, size = boardSize(board)) {
  const opponent = 3 - player;
  let score = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = board[y * size + x];
      if (!v) continue;
      for (const [dx, dy] of DIRS) {
        // Count each line segment exactly once: skip when the previous cell is same color.
        const px = x - dx;
        const py = y - dy;
        if (inBounds(px, py, size) && board[py * size + px] === v) continue;
        let count = 0;
        let cx = x;
        let cy = y;
        while (inBounds(cx, cy, size) && board[cy * size + cx] === v) {
          count++;
          cx += dx;
          cy += dy;
        }
        let open = 0;
        if (inBounds(px, py, size) && board[py * size + px] === EMPTY) open++;
        if (inBounds(cx, cy, size) && board[cy * size + cx] === EMPTY) open++;
        const s = lineShapeScore(count, open);
        if (v === player) score += s;
        else if (v === opponent) score -= s;
      }
    }
  }
  return score;
}

function hasNeighbor(board, size, x, y, radius) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(nx, ny, size) && board[ny * size + nx] !== EMPTY) return true;
    }
  }
  return false;
}

/**
 * Candidate moves ordered by an attack + defence heuristic.
 * Returns [{ idx, heuristic }]
 */
export function getCandidates(board, size, player, limit = 12, radius = 2) {
  const opponent = 3 - player;
  const centre = (size - 1) / 2;
  const out = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (board[idx] !== EMPTY) continue;
      if (!hasNeighbor(board, size, x, y, radius)) continue;
      const attack = shapeScoreAt(board, size, idx, player);
      const defence = shapeScoreAt(board, size, idx, opponent);
      const central = size - (Math.abs(x - centre) + Math.abs(y - centre));
      out.push({ idx, heuristic: attack + defence * 1.08 + central * 0.6 });
    }
  }
  if (out.length === 0) {
    const c = Math.floor(size / 2);
    return [{ idx: c * size + c, heuristic: 0 }];
  }
  out.sort((a, b) => b.heuristic - a.heuristic);
  return out.slice(0, limit);
}

function findImmediate(board, size, player, candidates) {
  for (const { idx } of candidates) {
    if (board[idx] !== EMPTY) continue;
    board[idx] = player;
    const win = checkWinAt(board, size, idx, player).win;
    board[idx] = EMPTY;
    if (win) return idx;
  }
  return -1;
}

function negamax(board, size, player, depth, alpha, beta, ctx, ply) {
  ctx.nodes++;
  if ((ctx.nodes & 511) === 0 && now() > ctx.deadline) throw TIMEOUT;
  if (depth <= 0) return evaluateBoard(board, player, size);

  const width = depth >= 3 ? ctx.width : Math.max(6, ctx.width - 4);
  const candidates = getCandidates(board, size, player, width);
  if (candidates.length === 0) return evaluateBoard(board, player, size);

  let best = -Infinity;
  let localAlpha = alpha;
  for (const { idx } of candidates) {
    if (board[idx] !== EMPTY) continue;
    board[idx] = player;
    let score;
    try {
      if (checkWinAt(board, size, idx, player).win) {
        score = WIN_SCORE - ply;
      } else {
        score = -negamax(board, size, 3 - player, depth - 1, -beta, -localAlpha, ctx, ply + 1);
      }
    } finally {
      board[idx] = EMPTY;
    }
    if (score > best) best = score;
    if (best > localAlpha) localAlpha = best;
    if (localAlpha >= beta) break;
  }
  if (best === -Infinity) return evaluateBoard(board, player, size);
  return best;
}

function rootSearch(board, size, player, depth, ctx) {
  const candidates = getCandidates(board, size, player, ctx.width);
  let bestMove = candidates[0]?.idx ?? -1;
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;
  for (const { idx } of candidates) {
    board[idx] = player;
    let score;
    try {
      if (checkWinAt(board, size, idx, player).win) {
        score = WIN_SCORE;
      } else {
        score = -negamax(board, size, 3 - player, depth - 1, -beta, -alpha, ctx, 1);
      }
    } finally {
      board[idx] = EMPTY;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMove = idx;
    }
    if (score > alpha) alpha = score;
  }
  return { move: bestMove, score: bestScore };
}

/**
 * Find the best move.
 * @param {Uint8Array} board
 * @param {1|2} player
 * @param {{level?:'easy'|'normal'|'hard', size?:number, timeMs?:number}} options
 * @returns {{move:number, score:number, depth:number, nodes:number, timeMs:number, level:string}}
 */
export function findBestMove(board, player, options = {}) {
  const size = options.size ?? boardSize(board);
  const level = LEVELS[options.level] ? options.level : 'normal';
  const cfg = LEVELS[level];
  const started = now();
  const deadline = started + (options.timeMs ?? cfg.timeMs);
  const ctx = { nodes: 0, deadline, width: cfg.width, maxDepth: cfg.depth };

  const { total } = countStones(board);
  if (total === 0) {
    const c = Math.floor(size / 2);
    return {
      move: c * size + c,
      score: 0,
      depth: 0,
      nodes: 0,
      timeMs: now() - started,
      level,
    };
  }

  const tactical = getCandidates(board, size, player, 60);
  const winNow = findImmediate(board, size, player, tactical);
  if (winNow >= 0) {
    return {
      move: winNow,
      score: WIN_SCORE,
      depth: 1,
      nodes: 0,
      timeMs: now() - started,
      level,
      reason: 'win',
    };
  }
  const mustBlock = findImmediate(board, size, 3 - player, tactical);
  if (mustBlock >= 0) {
    return {
      move: mustBlock,
      score: 0,
      depth: 1,
      nodes: 0,
      timeMs: now() - started,
      level,
      reason: 'block',
    };
  }

  let best = { move: tactical[0]?.idx ?? -1, score: 0 };
  let reachedDepth = 0;
  try {
    for (let depth = 2; depth <= ctx.maxDepth; depth++) {
      const res = rootSearch(board, size, player, depth, ctx);
      if (res.move >= 0) {
        best = res;
        reachedDepth = depth;
      }
      if (Math.abs(res.score) >= WIN_SCORE - 100) break;
      if (now() > deadline) break;
    }
  } catch (err) {
    if (err !== TIMEOUT) throw err;
  }

  return {
    move: best.move,
    score: best.score,
    depth: reachedDepth,
    nodes: ctx.nodes,
    timeMs: Math.round(now() - started),
    level,
  };
}

/** Analyse a position: turn, winner, empty cells and best move for both sides. */
export function analyze(board, size = boardSize(board)) {
  const winner = scanWinner(board, size);
  const counts = countStones(board);
  const turn = counts.black === counts.white ? BLACK : WHITE;
  const bestBlack = winner.win ? null : findBestMove(board, BLACK, { size, level: 'easy' });
  const bestWhite = winner.win ? null : findBestMove(board, WHITE, { size, level: 'easy' });
  return {
    size,
    turn,
    turnLabel: turn === BLACK ? 'black' : 'white',
    ...counts,
    winner,
    black: bestBlack ? { move: bestBlack.move, label: coordToLabel(bestBlack.move, size) } : null,
    white: bestWhite ? { move: bestWhite.move, label: coordToLabel(bestWhite.move, size) } : null,
  };
}

/** Apply a move with validation. Returns the new board state (mutates `board`). */
export function playMove(board, size, idx, player) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= size * size) {
    throw new Error('move is out of range');
  }
  if (board[idx] !== EMPTY) throw new Error('that intersection is already occupied');
  board[idx] = player;
  const result = checkWinAt(board, size, idx, player);
  return {
    board,
    move: idx,
    label: coordToLabel(idx, size),
    win: result.win,
    line: result.line,
    winner: result.player,
    turn: 3 - player,
  };
}