/**
 * AI Web Worker: keeps the search off the main thread so the board stays at 60fps.
 * Message: { id, game: 'gomoku'|'chess', payload }
 */
import { decodeBoard, findBestMove as gomokuBest } from './gomoku-ai.js';
import { findBestMove as chessBest } from './chess-ai.js';

self.onmessage = (event) => {
  const { id, game, payload } = event.data || {};
  try {
    if (game === 'gomoku') {
      const board = decodeBoard(payload.board);
      const res = gomokuBest(board, payload.player, { level: payload.level });
      self.postMessage({ id, ok: true, game, result: res });
    } else if (game === 'chess') {
      const res = chessBest(payload.fen, { level: payload.level });
      self.postMessage({ id, ok: true, game, result: res });
    } else {
      throw new Error(`unknown game: ${game}`);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, game, error: err && err.message ? err.message : String(err) });
  }
};