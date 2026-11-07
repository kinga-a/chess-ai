/**
 * Engine client: prefers the local Web Worker (zero latency, works offline),
 * can route to the EdgeOne edge function or an LLM-backed engine, and degrades
 * gracefully on network / model failures.
 */
import { encodeBoard, coordToLabel, findBestMove as gomokuLocal } from './ai/gomoku-ai.js';
import { findBestMove as chessLocal } from './ai/chess-ai.js';
import { apiFetch } from './core/api.js';

const EDGE_TIMEOUT = 20000;

function postJSON(url, body, timeout = EDGE_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        /* non json */
      }
      if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
      return data;
    })
    .finally(() => clearTimeout(timer));
}

export class EngineClient {
  constructor() {
    this.worker = null;
    this.seq = 0;
    this.pending = new Map();
    this.edgeAvailable = null;
    this.initWorker();
  }

  initWorker() {
    try {
      this.worker = new Worker(new URL('./ai/worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event) => {
        const { id, ok, result, error } = event.data || {};
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        if (ok) entry.resolve(result);
        else entry.reject(new Error(error || 'worker error'));
      };
      this.worker.onerror = () => {
        for (const [, entry] of this.pending) entry.reject(new Error('worker crashed'));
        this.pending.clear();
        this.worker = null;
      };
    } catch (_) {
      this.worker = null;
    }
  }

  workerRequest(game, payload) {
    if (!this.worker) return Promise.reject(new Error('worker unavailable'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, game, payload });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('worker timeout'));
        }
      }, 6000);
    });
  }

  async checkEdge() {
    if (this.edgeAvailable !== null) return this.edgeAvailable;
    try {
      const res = await apiFetch('/api/health');
      this.edgeAvailable = res.ok;
      return this.edgeAvailable;
    } catch (_) {
      this.edgeAvailable = false;
      return false;
    }
  }

  async gomoku({ board, player, level, engine = 'local' }) {
    const local = async () => {
      try {
        const res = await this.workerRequest('gomoku', {
          board: encodeBoard(board),
          player,
          level,
        });
        return { ...res, engine: 'local', fallback: false };
      } catch (_) {
        const res = gomokuLocal(board, player, { level });
        return { ...res, engine: 'local', fallback: false };
      }
    };

    if (engine === 'local') return local();

    try {
      const data = await postJSON('/api/ai/gomoku', {
        board: encodeBoard(board),
        player,
        level,
        engine,
      });
      if (!Number.isInteger(data.move)) throw new Error('invalid move');
      return {
        ...data,
        label: coordToLabel(data.move),
        engine: data.engine || engine,
        fallback: false,
      };
    } catch (err) {
      const res = await local();
      return { ...res, fallback: true, error: err.message };
    }
  }

  async chess({ fen, level, engine = 'local' }) {
    const local = async () => {
      try {
        const res = await this.workerRequest('chess', { fen, level });
        return { ...res, engine: 'local', fallback: false };
      } catch (_) {
        const res = chessLocal(fen, { level });
        return { ...res, engine: 'local', fallback: false };
      }
    };

    if (engine === 'local') return local();

    try {
      const data = await postJSON('/api/ai/chess', { fen, level, engine });
      if (!Number.isInteger(data.from) || !Number.isInteger(data.to)) {
        throw new Error('invalid move');
      }
      return { ...data, engine: data.engine || engine, fallback: false };
    } catch (err) {
      const res = await local();
      return { ...res, fallback: true, error: err.message };
    }
  }
}