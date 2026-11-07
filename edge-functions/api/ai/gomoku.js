/**
 * POST /api/ai/gomoku
 * { board: 225-char string, player: 1|2, level, engine }
 */
import { decodeBoard, turnOf, scanWinner } from '../../lib/gomoku-ai.js';
import { json, badRequest, corsPreflight, readJson } from '../../lib/http.js';
import { chooseGomoku } from '../../lib/ai-service.js';
import { requireAccess } from '../../lib/auth.js';

const LEVELS = new Set(['easy', 'normal', 'hard']);

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = await requireAccess(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await readJson(request);
  } catch (err) {
    return badRequest(err.message);
  }

  let board;
  let player;
  try {
    board = decodeBoard(body.board);
    player = body.player === 1 || body.player === 2 ? body.player : turnOf(board);
  } catch (err) {
    return badRequest(err.message);
  }
  if (scanWinner(board).win) return badRequest('the game is already over');

  const level = LEVELS.has(body.level) ? body.level : 'normal';
  const engine = body.engine === 'llm' ? 'llm' : 'local';
  try {
    const res = await chooseGomoku({ board, player, level, engine, env });
    return json({ ...res, player });
  } catch (err) {
    return badRequest(err.message || 'failed to compute a move', 500);
  }
}

export function onRequestOptions() {
  return corsPreflight();
}