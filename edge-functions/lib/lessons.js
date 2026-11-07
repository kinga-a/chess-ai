/**
 * Failure memory ("lessons"): store recent lost games in Blob and let the AI
 * vary its move when the same opening prefix appears again.
 */
import { getBlobStore } from './blob-store.js';

const memory = new Map();
const keyOf = (game) => `lessons/${game}.json`;
const MAX_LESSONS = 30;

export async function loadLessons(env, game) {
  const store = await getBlobStore();
  if (!store) return memory.get(game) || [];
  try {
    const data = await store.get(keyOf(game), { type: 'json', consistency: 'strong' });
    if (Array.isArray(data)) return data;
  } catch (_) {
    /* fall back to memory */
  }
  return memory.get(game) || [];
}

export async function addLesson(env, game, entry) {
  const list = await loadLessons(env, game);
  list.unshift({ ...entry, at: Date.now() });
  const trimmed = list.slice(0, MAX_LESSONS);
  memory.set(game, trimmed);
  const store = await getBlobStore();
  if (store) {
    try {
      await store.setJSON(keyOf(game), trimmed);
    } catch (_) {
      /* memory copy still works in this instance */
    }
  }
  return trimmed;
}

/** Normalize a room move to a stable string used for prefix matching. */
export function moveKey(game, move) {
  if (game === 'chess') return `${move.fromLabel}-${move.toLabel}`;
  return String(move.move !== undefined ? move.move : move.index);
}

/** Find the move the AI chose last time in the same position (if it lost). */
export async function findAvoidKey(env, room, aiSide, moveKeyFn = moveKey) {
  const lessons = await loadLessons(env, room.game);
  const history = room.moves.map((m) => moveKeyFn(room.game, m));
  for (const lesson of lessons) {
    if (String(lesson.winner) === String(aiSide)) continue;
    const seq = lesson.moves || [];
    if (seq.length <= history.length) continue;
    let match = true;
    for (let i = 0; i < history.length; i += 1) {
      if (history[i] !== seq[i]) {
        match = false;
        break;
      }
    }
    if (match) return seq[history.length];
  }
  return null;
}