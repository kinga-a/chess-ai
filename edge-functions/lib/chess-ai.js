/**
 * Chinese Chess (Xiangqi) engine — isomorphic.
 * Runs in the browser (Web Worker), in Node.js tests and inside EdgeOne Edge Functions.
 *
 * Board: Array(90) indexed by row * 9 + col.
 *   row 0 = black back rank (top), row 9 = red back rank (bottom)
 *   red pieces are upper-case: K A B N R C P
 *   black pieces are lower-case: k a b n r c p
 *
 * FEN: standard Xiangqi FEN, e.g.
 *   rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1
 *   side to move: w = red, b = black
 *
 * ICCS square label: files a-i left→right, ranks 0-9 from red's back rank up.
 *   e.g. red left rook at row 9 col 0 → "a0"
 */

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
export const RED = 'w';
export const BLACK = 'b';
export const ROWS = 10;
export const COLS = 9;

const TIMEOUT = Symbol('timeout');
const MATE = 1000000;
const FILES = 'abcdefghi';

const VALUE = { K: 10000, R: 900, C: 450, N: 400, B: 200, A: 200, P: 100 };

export const LEVELS = {
  easy: { depth: 2, timeMs: 260, label: '入门' },
  normal: { depth: 3, timeMs: 720, label: '进阶' },
  hard: { depth: 4, timeMs: 1400, label: '大师' },
};

function now() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

export function colorOf(piece) {
  if (!piece) return null;
  return piece >= 'A' && piece <= 'Z' ? RED : BLACK;
}

export function opposite(color) {
  return color === RED ? BLACK : RED;
}

export function inBoard(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

export function inPalace(color, r, c) {
  if (c < 3 || c > 5) return false;
  return color === RED ? r >= 7 && r <= 9 : r >= 0 && r <= 2;
}

export function onOwnHalf(color, r) {
  return color === RED ? r >= 5 : r <= 4;
}

export function idx(r, c) {
  return r * COLS + c;
}

export function rowOf(i) {
  return Math.floor(i / COLS);
}

export function colOf(i) {
  return i % COLS;
}

export function squareLabel(r, c) {
  if (!inBoard(r, c)) return null;
  return `${FILES[c]}${9 - r}`;
}

export function labelOfIndex(i) {
  return squareLabel(rowOf(i), colOf(i));
}

export function parseSquare(input) {
  if (Array.isArray(input) && input.length === 2) {
    const r = Number(input[0]);
    const c = Number(input[1]);
    return inBoard(r, c) ? { r, c, idx: idx(r, c) } : null;
  }
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let m = /^([a-iA-I])([0-9])$/.exec(s);
  if (m) {
    const c = m[1].toLowerCase().charCodeAt(0) - 97;
    const r = 9 - Number(m[2]);
    return inBoard(r, c) ? { r, c, idx: idx(r, c) } : null;
  }
  m = /^([0-9])\s*,\s*([0-9])$/.exec(s);
  if (m) {
    const r = Number(m[1]);
    const c = Number(m[2]);
    return inBoard(r, c) ? { r, c, idx: idx(r, c) } : null;
  }
  return null;
}

export function parseFen(fen) {
  if (typeof fen !== 'string') throw new Error('FEN must be a string');
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) throw new Error('FEN must contain placement and side to move');
  const placement = parts[0];
  const rows = placement.split('/');
  if (rows.length !== ROWS) throw new Error(`FEN must contain ${ROWS} ranks`);
  const board = new Array(ROWS * COLS).fill(null);
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= '0' && ch <= '9') {
        c += Number(ch);
      } else {
        if (!'KABNRCPkabnrcp'.includes(ch)) throw new Error(`unknown piece "${ch}"`);
        if (c > 8) throw new Error('rank overflow in FEN');
        board[idx(r, c)] = ch;
        c++;
      }
    }
    if (c !== 9) throw new Error(`rank ${r + 1} does not contain 9 files`);
  }
  let side = parts[1].toLowerCase();
  if (side === 'r') side = RED;
  if (side !== RED && side !== BLACK) throw new Error('side to move must be w or b');
  const halfmove = Number(parts[4]) || 0;
  const fullmove = Number(parts[5]) || 1;
  return { board, side, halfmove, fullmove };
}

export function toFen(board, side = RED, halfmove = 0, fullmove = 1) {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    let row = '';
    let empty = 0;
    for (let c = 0; c < COLS; c++) {
      const p = board[idx(r, c)];
      if (p) {
        if (empty) {
          row += empty;
          empty = 0;
        }
        row += p;
      } else {
        empty++;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${side} - - ${halfmove} ${fullmove}`;
}

export function findKing(board, color) {
  const target = color === RED ? 'K' : 'k';
  for (let i = 0; i < board.length; i++) if (board[i] === target) return i;
  return -1;
}

/** Can the piece at `from` attack the square `target`? (pseudo-legal) */
function canAttack(board, from, target, piece) {
  if (!piece) return false;
  const fr = rowOf(from);
  const fc = colOf(from);
  const tr = rowOf(target);
  const tc = colOf(target);
  const dr = tr - fr;
  const dc = tc - fc;
  const color = colorOf(piece);
  const type = piece.toUpperCase();
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);

  switch (type) {
    case 'K': {
      if (adr + adc === 1) return true;
      // Flying general: same file, nothing in between.
      if (fc === tc && board[target] && board[target].toUpperCase() === 'K') {
        const step = dr > 0 ? 1 : -1;
        for (let r = fr + step; r !== tr; r += step) {
          if (board[idx(r, fc)]) return false;
        }
        return true;
      }
      return false;
    }
    case 'A':
      return adr === 1 && adc === 1 && inPalace(color, tr, tc);
    case 'B': {
      if (adr !== 2 || adc !== 2) return false;
      if (!onOwnHalf(color, tr)) return false;
      const eye = idx(fr + dr / 2, fc + dc / 2);
      return !board[eye];
    }
    case 'N': {
      if (!((adr === 2 && adc === 1) || (adr === 1 && adc === 2))) return false;
      const legR = adr === 2 ? fr + dr / 2 : fr;
      const legC = adc === 2 ? fc + dc / 2 : fc;
      return !board[idx(legR, legC)];
    }
    case 'R': {
      if (fr !== tr && fc !== tc) return false;
      return clearPath(board, fr, fc, tr, tc);
    }
    case 'C': {
      if (fr !== tr && fc !== tc) return false;
      let screens = 0;
      if (fr === tr) {
        const step = tc > fc ? 1 : -1;
        for (let c = fc + step; c !== tc; c += step) if (board[idx(fr, c)]) screens++;
      } else {
        const step = tr > fr ? 1 : -1;
        for (let r = fr + step; r !== tr; r += step) if (board[idx(r, fc)]) screens++;
      }
      return screens === 1;
    }
    case 'P': {
      const forward = color === RED ? -1 : 1;
      if (dr === forward && dc === 0) return true;
      const crossed = color === RED ? fr <= 4 : fr >= 5;
      return crossed && dr === 0 && adc === 1;
    }
    default:
      return false;
  }
}

function clearPath(board, fr, fc, tr, tc) {
  if (fr === tr) {
    const step = tc > fc ? 1 : -1;
    for (let c = fc + step; c !== tc; c += step) if (board[idx(fr, c)]) return false;
    return true;
  }
  if (fc === tc) {
    const step = tr > fr ? 1 : -1;
    for (let r = fr + step; r !== tr; r += step) if (board[idx(r, fc)]) return false;
    return true;
  }
  return false;
}

/**
 * Fast attack detection: inspect the squares that could attack `target`
 * instead of enumerating every piece. Used by legality checks on every node.
 */
export function isSquareAttacked(board, target, byColor) {
  if (!Number.isInteger(target) || target < 0 || target >= board.length) return true;
  const tr = rowOf(target);
  const tc = colOf(target);
  const enemy = byColor === RED ? 'w' : 'b';
  const R = enemy === 'w' ? 'R' : 'r';
  const C = enemy === 'w' ? 'C' : 'c';
  const N = enemy === 'w' ? 'N' : 'n';
  const B = enemy === 'w' ? 'B' : 'b';
  const A = enemy === 'w' ? 'A' : 'a';
  const P = enemy === 'w' ? 'P' : 'p';
  const K = enemy === 'w' ? 'K' : 'k';
  const isKingTarget = board[target] && board[target].toUpperCase() === 'K';

  // Rooks, cannons, flying general along the four orthogonal rays.
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let r = tr + dr;
    let c = tc + dc;
    let first = null;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      const p = board[idx(r, c)];
      if (p) {
        if (!first) {
          if (p === R) return true;
          if (p === K && isKingTarget && (dr === 0 || dc === 0)) return true;
          first = p;
        } else if (p === C) {
          return true;
        } else {
          break;
        }
      }
      r += dr;
      c += dc;
    }
  }

  // Horses.
  for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
    const mr = tr - dr;
    const mc = tc - dc;
    if (!inBoard(mr, mc) || board[idx(mr, mc)] !== N) continue;
    const legR = Math.abs(dr) === 2 ? mr + dr / 2 : mr;
    const legC = Math.abs(dc) === 2 ? mc + dc / 2 : mc;
    if (!board[idx(legR, legC)]) return true;
  }

  // Elephants (only on their own half).
  if (onOwnHalf(byColor, tr)) {
    for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      const br = tr - dr;
      const bc = tc - dc;
      if (!inBoard(br, bc) || board[idx(br, bc)] !== B) continue;
      if (!board[idx(br + dr / 2, bc + dc / 2)]) return true;
    }
  }

  // Advisors.
  if (inPalace(byColor, tr, tc)) {
    for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ar = tr - dr;
      const ac = tc - dc;
      if (inBoard(ar, ac) && board[idx(ar, ac)] === A) return true;
    }
  }

  // Soldiers.
  const forward = byColor === RED ? -1 : 1;
  const pr = tr - forward;
  if (inBoard(pr, tc) && board[idx(pr, tc)] === P) return true;
  for (const dc of [-1, 1]) {
    const pc = tc + dc;
    if (!inBoard(tr, pc) || board[idx(tr, pc)] !== P) continue;
    const crossed = byColor === RED ? tr <= 4 : tr >= 5;
    if (crossed) return true;
  }

  // Adjacent king.
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const kr = tr + dr;
    const kc = tc + dc;
    if (inBoard(kr, kc) && board[idx(kr, kc)] === K) return true;
  }

  return false;
}

export function isKingAttacked(board, color) {
  const k = findKing(board, color);
  if (k < 0) return true;
  return isSquareAttacked(board, k, opposite(color));
}

/** Generate pseudo-legal moves (king safety not checked). */
export function pseudoMoves(board, color) {
  const moves = [];
  for (let from = 0; from < board.length; from++) {
    const piece = board[from];
    if (!piece || colorOf(piece) !== color) continue;
    const r = rowOf(from);
    const c = colOf(from);
    const type = piece.toUpperCase();
    const push = (tr, tc) => {
      if (!inBoard(tr, tc)) return;
      const to = idx(tr, tc);
      const target = board[to];
      if (target && colorOf(target) === color) return;
      moves.push({ from, to, piece, capture: target || null });
    };

    switch (type) {
      case 'K': {
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const tr = r + dr;
          const tc = c + dc;
          if (inPalace(color, tr, tc)) push(tr, tc);
        }
        // Flying general capture (rare, keeps search honest).
        const enemyKing = color === RED ? 'k' : 'K';
        for (const dr of [-1, 1]) {
          for (let tr = r + dr; tr >= 0 && tr < ROWS; tr += dr) {
            const p = board[idx(tr, c)];
            if (!p) continue;
            if (p === enemyKing) push(tr, c);
            break;
          }
        }
        break;
      }
      case 'A':
        for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          if (inPalace(color, r + dr, c + dc)) push(r + dr, c + dc);
        }
        break;
      case 'B':
        for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
          const tr = r + dr;
          const tc = c + dc;
          if (!inBoard(tr, tc) || !onOwnHalf(color, tr)) continue;
          if (board[idx(r + dr / 2, c + dc / 2)]) continue;
          push(tr, tc);
        }
        break;
      case 'N':
        for (const [dr, dc] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]]) {
          const tr = r + dr;
          const tc = c + dc;
          if (!inBoard(tr, tc)) continue;
          const legR = Math.abs(dr) === 2 ? r + dr / 2 : r;
          const legC = Math.abs(dc) === 2 ? c + dc / 2 : c;
          if (board[idx(legR, legC)]) continue;
          push(tr, tc);
        }
        break;
      case 'R':
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let tr = r + dr;
          let tc = c + dc;
          while (inBoard(tr, tc)) {
            const target = board[idx(tr, tc)];
            if (target) {
              if (colorOf(target) !== color) push(tr, tc);
              break;
            }
            push(tr, tc);
            tr += dr;
            tc += dc;
          }
        }
        break;
      case 'C':
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let tr = r + dr;
          let tc = c + dc;
          let screened = false;
          while (inBoard(tr, tc)) {
            const target = board[idx(tr, tc)];
            if (!screened) {
              if (target) {
                screened = true;
              } else {
                push(tr, tc);
              }
            } else if (target) {
              if (colorOf(target) !== color) push(tr, tc);
              break;
            }
            tr += dr;
            tc += dc;
          }
        }
        break;
      case 'P': {
        const forward = color === RED ? -1 : 1;
        push(r + forward, c);
        if (color === RED ? r <= 4 : r >= 5) {
          push(r, c - 1);
          push(r, c + 1);
        }
        break;
      }
      default:
        break;
    }
  }
  return moves;
}

export function makeMove(board, mv) {
  const captured = board[mv.to];
  board[mv.to] = board[mv.from];
  board[mv.from] = null;
  return captured;
}

export function unmakeMove(board, mv, captured) {
  board[mv.from] = board[mv.to];
  board[mv.to] = captured || null;
}

/** Legal moves: pseudo-legal moves that do not leave the own king in check. */
export function legalMoves(board, color) {
  const out = [];
  const king = findKing(board, color);
  const moves = pseudoMoves(board, color);
  for (const mv of moves) {
    const captured = makeMove(board, mv);
    const kingAfter = mv.from === king ? mv.to : king;
    const illegal = isSquareAttacked(board, kingAfter, opposite(color));
    unmakeMove(board, mv, captured);
    if (!illegal) out.push(mv);
  }
  return out;
}

export function legalMovesFrom(board, color, fromIdx) {
  return legalMoves(board, color).filter((m) => m.from === fromIdx);
}

export function moveLabel(mv) {
  return {
    from: labelOfIndex(mv.from),
    to: labelOfIndex(mv.to),
    capture: mv.capture || null,
    piece: mv.piece,
  };
}

function positionalBonus(type, color, r, c) {
  const centre = 4 - Math.abs(c - 4);
  switch (type) {
    case 'P': {
      const crossed = color === RED ? r <= 4 : r >= 5;
      if (!crossed) return 0;
      const advance = color === RED ? 4 - r : r - 5;
      return 40 + advance * 28 + centre * 4;
    }
    case 'N':
      return centre * 9 + (color === RED ? (9 - r) * 2 : r * 2);
    case 'C':
      return centre * 6 + (color === RED ? (9 - r) * 2 : r * 2);
    case 'R':
      return centre * 3 + (color === RED ? (9 - r) : r);
    case 'A':
    case 'B':
      return 0;
    case 'K':
      return 0;
    default:
      return 0;
  }
}

/** Static evaluation from `color`'s point of view. */
export function evaluate(board, color) {
  let score = 0;
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (!p) continue;
    const pc = colorOf(p);
    const type = p.toUpperCase();
    const value = VALUE[type] + positionalBonus(type, pc, rowOf(i), colOf(i));
    score += pc === color ? value : -value;
  }
  return score;
}

function legalCaptures(board, color) {
  const out = [];
  const king = findKing(board, color);
  for (const mv of pseudoMoves(board, color)) {
    if (!mv.capture) continue;
    const captured = makeMove(board, mv);
    const kingAfter = mv.from === king ? mv.to : king;
    const illegal = isSquareAttacked(board, kingAfter, opposite(color));
    unmakeMove(board, mv, captured);
    if (!illegal) out.push(mv);
  }
  return out;
}

function orderMoves(board, moves) {
  for (const mv of moves) {
    let order = 0;
    if (mv.capture) {
      const victim = VALUE[mv.capture.toUpperCase()] || 0;
      const attacker = VALUE[mv.piece.toUpperCase()] || 0;
      order = 10000 + victim * 10 - attacker;
      if (mv.capture.toUpperCase() === 'K') order += 100000;
    }
    mv.order = order;
  }
  moves.sort((a, b) => b.order - a.order);
  return moves;
}

function checkTime(ctx) {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && now() > ctx.deadline) throw TIMEOUT;
}

function quiesce(board, color, alpha, beta, ctx, qdepth) {
  checkTime(ctx);
  const stand = evaluate(board, color);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (qdepth >= 3) return alpha;

  const captures = legalCaptures(board, color);
  if (!captures.length) return alpha;
  orderMoves(board, captures);
  for (const mv of captures) {
    const captured = makeMove(board, mv);
    let score;
    try {
      score = -quiesce(board, opposite(color), -beta, -alpha, ctx, qdepth + 1);
    } finally {
      unmakeMove(board, mv, captured);
    }
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(board, color, depth, alpha, beta, ctx, ply) {
  checkTime(ctx);
  if (depth <= 0) return quiesce(board, color, alpha, beta, ctx, 0);
  const moves = legalMoves(board, color);
  if (!moves.length) return -MATE + ply;
  orderMoves(board, moves);

  let best = -Infinity;
  let localAlpha = alpha;
  for (const mv of moves) {
    const captured = makeMove(board, mv);
    let score;
    try {
      score = -negamax(board, opposite(color), depth - 1, -beta, -localAlpha, ctx, ply + 1);
    } finally {
      unmakeMove(board, mv, captured);
    }
    if (score > best) best = score;
    if (best > localAlpha) localAlpha = best;
    if (localAlpha >= beta) break;
  }
  return best;
}

function rootSearch(board, color, depth, ctx, avoid) {
  const moves = legalMoves(board, color);
  if (!moves.length) return { move: null, score: -MATE };
  orderMoves(board, moves);
  let bestMove = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;
  for (const mv of moves) {
    if (avoid && mv.from === avoid.from && mv.to === avoid.to) continue;
    const captured = makeMove(board, mv);
    let score;
    try {
      score = -negamax(board, opposite(color), depth - 1, -beta, -alpha, ctx, 1);
    } finally {
      unmakeMove(board, mv, captured);
    }
    if (score > bestScore) {
      bestScore = score;
      bestMove = mv;
    }
    if (score > alpha) alpha = score;
  }
  return { move: bestMove, score: bestScore };
}

/**
 * Find the best move.
 * @param {string|Array} position FEN string or board array
 * @param {object} options { level, side, timeMs, depth, maxTimeMs }
 */
export function findBestMove(position, options = {}) {
  const started = now();
  let board;
  let color;
  let halfmove = 0;
  let fullmove = 1;
  if (typeof position === 'string') {
    const parsed = parseFen(position);
    board = parsed.board;
    color = options.side || parsed.side;
    halfmove = parsed.halfmove;
    fullmove = parsed.fullmove;
  } else {
    board = position.slice();
    color = options.side || RED;
  }

  const level = LEVELS[options.level] ? options.level : 'normal';
  const cfg = LEVELS[level];
  const timeLimit = Math.min(options.timeMs ?? cfg.timeMs, options.maxTimeMs ?? 5000);
  const deadline = started + timeLimit;
  const ctx = { nodes: 0, deadline };
  const maxDepth = Math.min(options.depth ?? cfg.depth, options.maxDepth ?? 6);

  const rootMoves = legalMoves(board, color);
  if (!rootMoves.length) {
    return {
      from: -1,
      to: -1,
      fromLabel: null,
      toLabel: null,
      fen: toFen(board, color, halfmove, fullmove),
      score: -MATE,
      depth: 0,
      nodes: 0,
      timeMs: 0,
      level,
      checkmate: true,
    };
  }

  const avoid = options.avoid && Number.isInteger(options.avoid.from) ? options.avoid : null;
  let best = rootMoves[0];
  let bestScore = 0;
  let reachedDepth = 0;
  try {
    for (let depth = 1; depth <= maxDepth; depth++) {
      const res = rootSearch(board, color, depth, ctx, avoid);
      if (res.move) {
        best = res.move;
        bestScore = res.score;
        reachedDepth = depth;
      }
      if (Math.abs(res.score) > MATE - 100) break;
      if (now() > deadline) break;
    }
  } catch (err) {
    if (err !== TIMEOUT) throw err;
  }

  makeMove(board, best);
  const nextSide = opposite(color);
  const nextMoves = legalMoves(board, nextSide);
  const nextCheck = isKingAttacked(board, nextSide);
  return {
    from: best.from,
    to: best.to,
    fromLabel: labelOfIndex(best.from),
    toLabel: labelOfIndex(best.to),
    piece: best.piece,
    capture: best.capture,
    fen: toFen(board, nextSide, best.capture ? 0 : halfmove + 1, color === BLACK ? fullmove + 1 : fullmove),
    score: bestScore,
    depth: reachedDepth,
    nodes: ctx.nodes,
    timeMs: Math.round(now() - started),
    level,
    check: nextCheck,
    checkmate: nextCheck && nextMoves.length === 0,
    stalemate: !nextCheck && nextMoves.length === 0,
    legalMoves: nextMoves.length,
  };
}

/** Apply a move given ICCS labels or [r,c] pairs. */
export function applyMoveByLabel(fen, fromInput, toInput) {
  const parsed = parseFen(fen);
  const from = parseSquare(fromInput);
  const to = parseSquare(toInput);
  if (!from || !to) throw new Error('invalid square (use labels like "b0" or [row,col])');
  const piece = parsed.board[from.idx];
  if (!piece) throw new Error(`no piece on ${squareLabel(from.r, from.c)}`);
  if (colorOf(piece) !== parsed.side) throw new Error('it is not that side\'s turn');
  const legal = legalMoves(parsed.board, parsed.side).filter(
    (m) => m.from === from.idx && m.to === to.idx,
  );
  if (!legal.length) throw new Error('illegal move');
  const mv = legal[0];
  const captured = makeMove(parsed.board, mv);
  const nextSide = opposite(parsed.side);
  const inCheck = isKingAttacked(parsed.board, nextSide);
  const responses = legalMoves(parsed.board, nextSide);
  const halfmove = captured ? 0 : parsed.halfmove + 1;
  return {
    fen: toFen(parsed.board, nextSide, halfmove, parsed.side === BLACK ? parsed.fullmove + 1 : parsed.fullmove),
    from: fromInput,
    to: toInput,
    fromLabel: squareLabel(from.r, from.c),
    toLabel: squareLabel(to.r, to.c),
    piece,
    capture: captured || null,
    check: inCheck,
    checkmate: inCheck && responses.length === 0,
    stalemate: !inCheck && responses.length === 0,
    legalMoves: responses.length,
    halfmove,
    winner: responses.length === 0 ? (inCheck ? (nextSide === RED ? BLACK : RED) : (nextSide === RED ? BLACK : RED)) : null,
  };
}

/** Describe a position: side, check status, legal moves, material. */
export function describe(fen) {
  const parsed = parseFen(fen);
  const moves = legalMoves(parsed.board, parsed.side);
  const check = isKingAttacked(parsed.board, parsed.side);
  let redMaterial = 0;
  let blackMaterial = 0;
  const pieces = [];
  for (let i = 0; i < parsed.board.length; i++) {
    const p = parsed.board[i];
    if (!p) continue;
    const value = VALUE[p.toUpperCase()] || 0;
    if (colorOf(p) === RED) redMaterial += value;
    else blackMaterial += value;
    pieces.push({ square: labelOfIndex(i), piece: p, value });
  }
  return {
    fen,
    side: parsed.side,
    sideLabel: parsed.side === RED ? 'red' : 'black',
    check,
    legalMoves: moves.length,
    checkmate: moves.length === 0 && check,
    stalemate: moves.length === 0 && !check,
    halfmove: parsed.halfmove,
    redMaterial,
    blackMaterial,
    pieces,
    moves: moves.map((m) => ({
      from: labelOfIndex(m.from),
      to: labelOfIndex(m.to),
      fromIdx: m.from,
      toIdx: m.to,
      capture: m.capture || null,
    })),
  };
}