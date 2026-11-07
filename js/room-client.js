/**
 * Room client: create/join a live match and poll for the opponent's moves.
 */
import { apiFetch } from './core/api.js';

const POLL_MS = 1200;
const MISS_LIMIT = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function otherSide(room) {
  if (room.game === 'gomoku') return room.humanSide === 1 ? 2 : 1;
  return room.humanSide === 'w' ? 'b' : 'w';
}

async function readRoom(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `房间请求失败（${res.status}）`);
    error.status = res.status;
    throw error;
  }
  return data.room;
}

export class RoomClient {
  constructor() {
    this.code = '';
    this.version = -1;
    this.room = null;
    this.mySide = null;
    this.running = false;
    this.timer = 0;
    this.onRoom = null;
    this.onError = null;
    this.onGone = null;
    this.missCount = 0;
  }

  async post(action, body) {
    const res = await apiFetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    return readRoom(res);
  }

  async fetch(code) {
    const res = await apiFetch(`/api/room?code=${encodeURIComponent(code)}`);
    return readRoom(res);
  }

  attach(room) {
    this.missCount = 0;
    this.room = room;
    this.code = room.code;
    this.version = room.version;
    if (this.onRoom) this.onRoom(room);
  }

  async create(game, humanSide) {
    const room = await this.post('create', { game, humanSide });
    this.mySide = room.humanSide;
    this.attach(room);
    return room;
  }

  async join(code) {
    const normalized = String(code).trim().toUpperCase();
    let room = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        room = await this.fetch(normalized);
        break;
      } catch (err) {
        if (err.status !== 404 || attempt === 4) throw err;
        await sleep(500);
      }
    }
    if (!room.guest) room = await this.post('join', { code: room.code });
    this.mySide = otherSide(room);
    this.attach(room);
    return room;
  }

  /** Re-enter a saved room without announcing a new guest (host keeps their side). */
  async rejoin(code, role) {
    const normalized = String(code).trim().toUpperCase();
    let room = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        room = await this.fetch(normalized);
        break;
      } catch (err) {
        if (err.status !== 404 || attempt === 4) throw err;
        await sleep(500);
      }
    }
    this.mySide = role === 'host' ? room.humanSide : otherSide(room);
    this.attach(room);
    return room;
  }

  start(onRoom, onError, onGone) {
    this.onRoom = onRoom;
    this.onError = onError || null;
    this.onGone = onGone || null;
    this.running = true;
    this.tick();
  }

  async tick() {
    if (!this.running) return;
    const started = Date.now();
    try {
      const room = await this.fetch(this.code);
      if (room && room.version !== this.version) this.attach(room);
    } catch (err) {
      if (err && err.status === 404) {
        this.missCount += 1;
        if (this.missCount >= MISS_LIMIT) {
          this.running = false;
          clearTimeout(this.timer);
          this.timer = 0;
          if (this.onGone) this.onGone(this.code);
          return;
        }
      } else if (this.onError) {
        this.onError(err);
      }
    }
    const wait = Math.max(300, POLL_MS - (Date.now() - started));
    this.timer = setTimeout(() => this.tick(), wait);
  }

  async move(payload) {
    const room = await this.post('move', { code: this.code, ...payload });
    this.attach(room);
    return room;
  }

  async aiMove(options = {}) {
    const room = await this.post('ai_move', { code: this.code, ...options });
    this.attach(room);
    return room;
  }

  async remove(code) {
    const res = await apiFetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '删除房间失败');
    return data;
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = 0;
  }

  reset() {
    this.stop();
    this.room = null;
    this.mySide = null;
    this.code = '';
    this.version = -1;
  }
}