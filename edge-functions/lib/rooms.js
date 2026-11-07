/**
 * Live room logic: create a room, submit a move, let the server AI answer.
 * Shared by the HTTP API and the MCP tools.
 */
import { readRoom, saveRoom, removeRoom, newCode } from './room-store.js';
import { decodeBoard, encodeBoard, playMove, coordToLabel } from './gomoku-ai.js';
import { START_FEN, applyMoveByLabel, labelOfIndex } from './chess-ai.js';
import { chooseGomoku, chooseChess } from './ai-service.js';

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
  const kind = game === 'chess' ? 'chess' : 'gomoku';
  const human = kind === 'gomoku' ? (humanSide === 'second' ? 2 : 1) : humanSide === 'black' ? 'b' : 'w';
  const room = {
    code: newCode(),
    game: kind,
    humanSide: human,
    turn: kind === 'gomoku' ? 1 : 'w',
    status: 'playing',
    winner: null,
    reason: null,
    moves: [],
    version: 0,
    created: Date.now(),
    updated: Date.now(),
    board: kind === 'gomoku' ? '0'.repeat(SIZE * SIZE) : null,
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

export async function playInRoom(env, code, payload = {}) {
  const room = await getRoom(env, code);
  if (room.status !== 'playing') throw new RoomError('game is already over', 409);

  const player = payload.player !== undefined ? payload.player : room.turn;
  if (String(player) !== String(room.turn)) throw new RoomError('not your turn', 409);

  if (room.game === 'gomoku') {
    return applyGomoku(env, room, payload.move !== undefined ? payload.move : payload.index, room.turn);
  }
  if (!payload.from || !payload.to) throw new RoomError('from and to are required', 400);
  return applyChess(env, room, payload.from, payload.to);
}

export async function aiMoveInRoom(env, code, { level = 'normal', engine = 'local' } = {}) {
  const room = await getRoom(env, code);
  if (room.status !== 'playing') throw new RoomError('game is already over', 409);

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