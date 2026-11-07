/**
 * POST /api/room  { action: 'create' | 'move' | 'ai_move', ... }
 * GET  /api/room?code=ABC123
 */
import { json, corsPreflight, readJson } from '../lib/http.js';
import { requireAccess } from '../lib/auth.js';
import { createRoom, getRoom, playInRoom, aiMoveInRoom, closeRoom, joinRoom, RoomError } from '../lib/rooms.js';

function fail(err) {
  const status = err instanceof RoomError ? err.status : 500;
  return json({ error: err.message || 'room error', code: 'ROOM_ERROR' }, { status });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = await requireAccess(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  try {
    const room = await getRoom(env, url.searchParams.get('code'));
    return json({ ok: true, room });
  } catch (err) {
    return fail(err);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = await requireAccess(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await readJson(request, 16384);
  } catch (_) {
    return json({ error: 'invalid json body' }, { status: 400 });
  }

  const action = body.action || 'move';
  try {
    if (action === 'create') {
      const room = await createRoom(env, { game: body.game, humanSide: body.humanSide });
      return json({ ok: true, room });
    }
    if (action === 'join') {
      const room = await joinRoom(env, body.code);
      return json({ ok: true, room });
    }
    if (action === 'move') {
      const room = await playInRoom(env, body.code, body);
      return json({ ok: true, room });
    }
    if (action === 'ai_move') {
      const room = await aiMoveInRoom(env, body.code, { level: body.level, engine: body.engine });
      return json({ ok: true, room });
    }
    if (action === 'delete') {
      const result = await closeRoom(env, body.code);
      return json({ ok: true, ...result });
    }
    return json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return fail(err);
  }
}

export function onRequestOptions() {
  return corsPreflight();
}