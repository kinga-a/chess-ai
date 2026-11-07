/**
 * POST /api/ai/chess
 * { fen: string, level, engine }
 */
import { parseFen } from '../../lib/chess-ai.js';
import { json, badRequest, corsPreflight, readJson } from '../../lib/http.js';
import { chooseChess } from '../../lib/ai-service.js';
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
  if (typeof body.fen !== 'string') return badRequest('fen is required');
  try {
    parseFen(body.fen);
  } catch (err) {
    return badRequest(`invalid fen: ${err.message}`);
  }

  const level = LEVELS.has(body.level) ? body.level : 'normal';
  const engine = body.engine === 'llm' ? 'llm' : 'local';
  try {
    const res = await chooseChess({ fen: body.fen, level, engine, env });
    return json(res);
  } catch (err) {
    return badRequest(err.message || 'failed to compute a move', 500);
  }
}

export function onRequestOptions() {
  return corsPreflight();
}