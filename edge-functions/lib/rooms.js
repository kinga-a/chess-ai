/**
 * Live room logic: create a room, submit a move, let the server AI answer.
 * Shared by the HTTP API and the MCP tools.
 */
import { readRoom, saveRoom, removeRoom, newCode } from './room-store.js';
import { decodeBoard, encodeBoard, playMove, coordToLabel } from './gomoku-ai.js';
import { START_FEN, applyMoveByLabel, labelOfIndex } from './chess-ai.js';
import { chooseGomoku, chooseChess } from './ai-service.js';
import * as ttt from './tictactoe-ai.js';
import * as c4 from './connect4-ai.js';
import * as oth from './othello-ai.js';

const GRID = {
  tictactoe: {
    create: () => ttt.createBoard(),
    apply: (board, move, player) => ttt.applyMove(board, move, player),
    ai: (board, player, level) => ttt.findBestMove({ board, player, level }),
    label: (move, board) => ttt.describeMove(move, ttt.boardSize(board)),
    reason: 'three',
  },
  connect4: {
    create: () => c4.createBoard(),
    apply: (board, move, player) => c4.applyMove(board, move, player),
    ai: (board, player, level) => c4.findBestMove({ board, player, level }),
    label: (move) => c4.describeMove(move),
    reason: 'four',
  },
  othello: {
    create: () => oth.createBoard(),
    apply: (board, move, player) => oth.applyMove(board, move, player),
    ai: (board, player, level) => oth.findBestMove({ board, player, level }),
    label: (move) => oth.describeMove(move),
    reason: 'count',
  },
};

const SIZE = 15;

export class RoomError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function normalizeCode(code) {
  const value = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(value)) throw new RoomError('invalid room code', 400);
  return value;
}

export function parseGomokuMove(input) {
  if (Number.isInteger(input)) return input;
  if (Array.isArray(input) && input.length === 2 && input.every(Number.isInteger)) {
    return input[1] * SIZE + input[0];
  }
  if (typeof input === 'string') {
    const raw = input.trim();
    if (/^\d{1,3}$/.test(raw)) return Number(raw);
    const label = /^([A-Oa-o])(1[0-5]|[1-9])$/.exec(raw);
    if (label) return (Number(label[2]) - 1) * SIZE + (label[1].toUpperCase().charCodeAt(0) - 65);
    const pair = /^(\d{1,2})\s*,\s*(\d{1,2})$/.exec(raw);
    if (pair) return Number(pair[2]) * SIZE + Number(pair[1]);
  }
  throw new RoomError('invalid move, use H8 / [col,row] / "7,7"', 400);
}

export async function createRoom(env, { game = 'gomoku', humanSide } = {}) {
  const kind = GRID[game] ? game : game === 'chess' ? 'chess' : 'gomoku';
  const human = kind === 'chess'
    ? (humanSide === 'black' ? 'b' : 'w')
    : humanSide === 'second' ? 2 : 1;
  const room = {
    code: newCode(),
    game: kind,
    humanSide: human,
    guest: false,
    guestAt: null,
    turn: kind === 'chess' ? 'w' : 1,
    status: 'playing',
    winner: null,
    reason: null,
    moves: [],
    version: 0,
    created: Date.now(),
    updated: Date.now(),
    board: kind === 'gomoku' ? '0'.repeat(SIZE * SIZE) : GRID[kind] ? GRID[kind].create() : null,
    fen: kind === 'chess' ? START_FEN : null,
    lastEngine: null,
    lastTimeMs: null,
  };
  return saveRoom(env, room);
}

export async function getRoom(env, code) {
  const room = await readRoom(env, normalizeCode(code));
  if (!room) throw new RoomError('room not found or expired', 404);
  return room;
}

/** Permanently close a room (host action). Unknown rooms are a no-op. */
export async function closeRoom(env, code) {
  const normalized = normalizeCode(code);
  const room = await readRoom(env, normalized);
  await removeRoom(env, normalized);
  return { code: normalized, closed: !!room };
}

/** Mark that an opponent has entered the room (idempotent). */
export async function joinRoom(env, code) {
  const room = await getRoom(env, code);
  if (!room.guest) {
    room.guest = true;
    room.guestAt = Date.now();
    await saveRoom(env, room);
  }
  return room;
}

async function applyGomoku(env, room, move, player) {
  const board = decodeBoard(room.board, SIZE);
  const idx = parseGomokuMove(move);
  if (!Number.isInteger(idx) || idx < 0 || idx >= SIZE * SIZE) throw new RoomError('move out of board', 400);
  if (board[idx] !== 0) throw new RoomError('square already occupied', 409);
  const res = playMove(board, SIZE, idx, player);
  room.board = encodeBoard(board);
  room.moves.push({ index: idx, player, label: coordToLabel(idx, SIZE) });
  room.turn = res.turn;
  if (res.win) {
    room.status = 'over';
    room.winner = res.winner;
    room.reason = 'five';
  } else if (room.moves.length >= SIZE * SIZE) {
    room.status = 'over';
    room.winner = 0;
    room.reason = 'full';
  }
  return saveRoom(env, room);
}

async function applyChess(env, room, from, to) {
  const mover = room.turn;
  const res = applyMoveByLabel(room.fen, from, to);
  room.fen = res.fen;
  room.moves.push({
    from: res.from,
    to: res.to,
    fromLabel: res.fromLabel,
    toLabel: res.toLabel,
    piece: res.piece,
    capture: res.capture || null,
    player: mover,
  });
  room.turn = res.fen.split(' ')[1];
  if (res.checkmate || res.stalemate) {
    room.status = 'over';
    room.winner = room.turn === 'w' ? 'b' : 'w';
    room.reason = res.checkmate ? 'checkmate' : 'stalemate';
  }
  return saveRoom(env, room);
}

async function applyGridGame(env, room, move, player) {
  const engine = GRID[room.game];
  if (!engine) throw new RoomError('unknown game', 400);
  const res = engine.apply(room.board, move, player);
  if (!res) throw new RoomError('illegal move', 409);
  room.board = res.board;
  room.moves.push({ move, player, label: engine.label(move, res.board) });
  room.turn = res.nextPlayer;
  if (res.win) {
    room.status = 'over';
    room.winner = res.winner;
    room.reason = engine.reason;
  } else if (res.draw) {
    room.status = 'over';
    room.winner = 0;
    room.reason = 'draw';
  }
  return saveRoom(env, room);
}

export async function playInRoom(env, code, payload = {}) {
  const room = await getRoom(env, code);
  if (room.status !== 'playing') throw new RoomError('game is already over', 409);
  if (!room.guest) {
    room.guest = true;
    room.guestAt = Date.now();
  }

  const player = payload.player !== undefined ? payload.player : room.turn;
  if (String(player) !== String(room.turn)) throw new RoomError('not your turn', 409);

  if (room.game === 'gomoku') {
    return applyGomoku(env, room, payload.move !== undefined ? payload.move : payload.index, room.turn);
  }
  if (GRID[room.game]) {
    if (!Number.isInteger(payload.move)) throw new RoomError('move (cell index or column) is required', 400);
    return applyGridGame(env, room, payload.move, room.turn);
  }
  if (!payload.from || !payload.to) throw new RoomError('from and to are required', 400);
  return applyChess(env, room, payload.from, payload.to);
}

export function aiSideOf(room) {
  return room.game === 'chess'
    ? room.humanSide === 'w' ? 'b' : 'w'
    : room.humanSide === 1 ? 2 : 1;
}

export async function aiMoveInRoom(env, code, { level = 'normal', engine = 'local' } = {}) {
  const room = await getRoom(env, code);
  if (room.status !== 'playing') throw new RoomError('game is already over', 409);
  if (String(room.turn) !== String(aiSideOf(room))) {
    throw new RoomError('not the AI turn: human side is to move', 409);
  }
  if (!room.guest) {
    room.guest = true;
    room.guestAt = Date.now();
  }

  if (GRID[room.game]) {
    const started = Date.now();
    const move = GRID[room.game].ai(room.board, room.turn, level);
    if (move < 0) throw new RoomError('no legal move', 409);
    room.lastEngine = 'minimax';
    room.lastTimeMs = Date.now() - started;
    return applyGridGame(env, room, move, room.turn);
  }

  if (room.game === 'gomoku') {
    const board = decodeBoard(room.board, SIZE);
    const ai = await chooseGomoku({ board, player: room.turn, level, engine, env });
    room.lastEngine = ai.engine;
    room.lastTimeMs = ai.timeMs;
    return applyGomoku(env, room, ai.move, room.turn);
  }

  const ai = await chooseChess({ fen: room.fen, level, engine, env });
  room.lastEngine = ai.engine;
  room.lastTimeMs = ai.timeMs;
  return applyChess(env, room, ai.fromLabel || labelOfIndex(ai.from), ai.toLabel || labelOfIndex(ai.to));
}
/** Restart the same room: fresh board, same code and sides. */
export async function resetRoom(env, code) {
  const room = await getRoom(env, code);
  if (room.game === 'gomoku') {
    room.board = '0'.repeat(SIZE * SIZE);
    room.fen = null;
    room.turn = 1;
  } else if (room.game === 'chess') {
    room.board = null;
    room.fen = START_FEN;
    room.turn = 'w';
  } else {
    room.board = GRID[room.game].create();
    room.fen = null;
    room.turn = 1;
  }
  room.status = 'playing';
  room.winner = 0;
  room.reason = null;
  room.moves = [];
  room.lastEngine = null;
  room.lastTimeMs = null;
  return saveRoom(env, room);
}

/** Read the room and answer in the same call when it is the AI's turn. */
export async function tickRoom(env, code, { level = 'normal', engine = 'minimax' } = {}) {
  const room = await getRoom(env, code);
  if (room.status !== 'playing') return { room, moved: false };
  if (String(room.turn) !== String(aiSideOf(room))) return { room, moved: false };
  const next = await aiMoveInRoom(env, code, { level, engine });
  return { room: next, moved: true };
}
