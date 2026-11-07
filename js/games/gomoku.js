/**
 * Gomoku game controller: rendering, interaction, AI turn loop, undo, records.
 */
import {
  BLACK,
  WHITE,
  DEFAULT_SIZE,
  newBoard,
  coordToLabel,
  checkWinAt,
  playMove,
  countStones,
} from '../ai/gomoku-ai.js';
import { BoardEffects, fitCanvas, easeOutBack, easeOutCubic } from '../core/fx.js';

const STAR_POINTS = [
  [3, 3], [3, 11], [7, 7], [11, 3], [11, 11],
];

export class GomokuGame {
  constructor({ canvas, fxCanvas, audio, engineClient, hooks }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fx = new BoardEffects(fxCanvas);
    this.audio = audio;
    this.engineClient = engineClient;
    this.hooks = hooks || {};
    this.size = DEFAULT_SIZE;
    this.board = newBoard(this.size);
    this.moves = [];
    this.stones = new Map();
    this.status = 'idle';
    this.human = BLACK;
    this.ai = WHITE;
    this.turn = BLACK;
    this.lastMove = -1;
    this.winLine = [];
    this.hover = -1;
    this.level = 'normal';
    this.engine = 'local';
    this.room = null;
    this.session = 0;
    this.thinking = false;
    this.startedAt = 0;
    this.aiTimes = [];
    this.record = [];
    this.evalText = '—';
    this.w = 0;
    this.h = 0;
    this.texture = null;
    this.raf = 0;
    this.running = true;
    this.lastFrame = 0;
    this.bindEvents();
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  bindEvents() {
    this.onPointerDown = (e) => {
      e.preventDefault();
      this.audio.unlock();
      const idx = this.hitTest(e.clientX, e.clientY);
      if (idx >= 0) this.humanPlay(idx);
    };
    this.onPointerMove = (e) => {
      const idx = this.hitTest(e.clientX, e.clientY);
      if (idx !== this.hover) {
        this.hover = idx;
        this.canvas.style.cursor = idx >= 0 && this.canPlay() ? 'pointer' : 'default';
      }
    };
    this.onPointerLeave = () => {
      this.hover = -1;
      this.canvas.style.cursor = 'default';
    };
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
  }

  layout() {
    const pad = this.w * 0.082;
    const grid = (this.w - pad * 2) / (this.size - 1);
    return { pad, grid };
  }

  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    const x = ((clientX - rect.left) / rect.width) * this.w;
    const y = ((clientY - rect.top) / rect.height) * this.h;
    const { pad, grid } = this.layout();
    const gx = Math.round((x - pad) / grid);
    const gy = Math.round((y - pad) / grid);
    if (gx < 0 || gx >= this.size || gy < 0 || gy >= this.size) return -1;
    const cx = pad + gx * grid;
    const cy = pad + gy * grid;
    if (Math.hypot(x - cx, y - cy) > grid * 0.62) return -1;
    return gy * this.size + gx;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const out = fitCanvas(this.canvas, Math.max(1, rect.width), Math.max(1, rect.height));
    this.ctx = out.ctx;
    this.w = out.w;
    this.h = out.h;
    this.fx.resize();
    this.buildTexture();
  }

  buildTexture() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(this.w));
    c.height = Math.max(1, Math.round(this.h));
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, this.w, this.h);
    grad.addColorStop(0, '#241a10');
    grad.addColorStop(0.45, '#1d150d');
    grad.addColorStop(1, '#120d08');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);

    // Wood grain
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * this.h;
      g.beginPath();
      g.strokeStyle = `rgba(${190 + Math.random() * 40}, ${140 + Math.random() * 30}, 80, ${0.012 + Math.random() * 0.03})`;
      g.lineWidth = 0.6 + Math.random() * 1.6;
      g.moveTo(-10, y);
      g.bezierCurveTo(this.w * 0.3, y + (Math.random() - 0.5) * 30, this.w * 0.7, y + (Math.random() - 0.5) * 30, this.w + 10, y + (Math.random() - 0.5) * 18);
      g.stroke();
    }
    // Vignette
    const v = g.createRadialGradient(this.w / 2, this.h / 2, this.w * 0.2, this.w / 2, this.h / 2, this.w * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = v;
    g.fillRect(0, 0, c.width, c.height);
    this.texture = c;
  }

  canPlay() {
    return this.status === 'playing' && !this.thinking && this.turn === this.human;
  }

  newGame(options = {}) {
    this.session++;
    this.level = options.level || this.level;
    this.engine = options.engine || this.engine;
    this.room = options.roomClient || null;
    const roomState = options.roomState || (this.room && this.room.room) || null;
    this.human = options.mySide || (roomState ? roomState.humanSide : options.side === 'second' ? WHITE : BLACK);
    this.ai = 3 - this.human;
    this.size = options.size || DEFAULT_SIZE;
    this.board = newBoard(this.size);
    this.moves = [];
    this.stones.clear();
    this.record = [];
    this.aiTimes = [];
    this.winLine = [];
    this.lastMove = -1;
    this.hover = -1;
    this.turn = roomState ? roomState.turn : BLACK;
    this.status = roomState ? roomState.status : 'playing';
    this.thinking = false;
    this.startedAt = performance.now();
    this.evalText = '均势';
    this.fx.clear();
    this.emitState();
    if (roomState) {
      if (roomState.moves.length) this.syncRoom(roomState, false);
    } else if (!this.room && this.turn === this.ai) {
      this.aiTurn();
    }
  }

  /** Apply the authoritative room state, appending only unseen moves. */
  syncRoom(room, animate = true) {
    if (!room || room.game !== 'gomoku') return;
    if (room.moves.length < this.moves.length) {
      this.moves = [];
      this.record = [];
      this.stones.clear();
      this.board = newBoard(this.size);
      this.winLine = [];
      this.lastMove = -1;
      if (this.status === 'over') this.status = 'playing';
    }
    for (let i = this.moves.length; i < room.moves.length; i += 1) {
      const mv = room.moves[i];
      if (this.board[mv.index] !== 0) continue;
      this.applyMove(mv.index, mv.player, animate);
    }
    this.turn = room.turn;
    if (room.status === 'over' && this.status !== 'over') {
      this.finish(room.winner || 0, room.reason || 'room');
    }
    this.emitState();
  }

  emitState() {
    const counts = countStones(this.board);
    if (this.hooks.onState) {
      this.hooks.onState({
        game: 'gomoku',
        status: this.status,
        turn: this.turn,
        human: this.human,
        ai: this.ai,
        thinking: this.thinking,
        moveCount: this.moves.length,
        aiTime: this.aiTimes.length ? this.aiTimes[this.aiTimes.length - 1] : null,
        evalText: this.evalText,
        record: this.record,
        stones: counts,
        roomMode: !!this.room,
        roomCode: this.room ? this.room.code : '',
      });
    }
  }

  applyMove(idx, player, animate = true) {
    const res = playMove(this.board, this.size, idx, player);
    this.stones.set(idx, { color: player, born: animate ? performance.now() : 0 });
    this.moves.push({ idx, player });
    this.record.push({ player, label: coordToLabel(idx, this.size) });
    this.lastMove = idx;
    this.turn = res.turn;

    const { pad, grid } = this.layout();
    const x = pad + (idx % this.size) * grid;
    const y = pad + Math.floor(idx / this.size) * grid;
    if (animate) {
      this.audio.play(player === this.human ? 'place' : 'stone');
      this.fx.ring(x, y, player === this.human ? 'rgba(55,201,169,0.65)' : 'rgba(217,164,65,0.65)', grid * 1.15);
      this.fx.burst(x, y, player === this.human ? '#37c9a9' : '#d9a441', 16, 0.65);
    }

    if (res.win) {
      this.winLine = res.line;
      this.finish(res.winner, 'five');
    } else if (this.moves.length >= this.size * this.size) {
      this.finish(0, 'full');
    }
    this.emitState();
    return res;
  }

  finish(winner, reason) {
    if (this.status === 'over') return;
    this.status = 'over';
    this.thinking = false;
    const humanWon = winner === this.human;
    if (winner === 0) this.audio.play('draw');
    else if (humanWon) this.audio.play('win');
    else this.audio.play('lose');
    if (humanWon) this.hooks.confetti && this.hooks.confetti();
    if (this.winLine.length) {
      const { pad, grid } = this.layout();
      const mid = this.winLine[Math.floor(this.winLine.length / 2)];
      const x = pad + (mid % this.size) * grid;
      const y = pad + Math.floor(mid / this.size) * grid;
      this.fx.burst(x, y, '#f4d491', 40, 1.4);
    }
    this.emitState();
    if (this.hooks.onEnd) {
      this.hooks.onEnd({
        game: 'gomoku',
        winner,
        human: this.human,
        reason,
        moveCount: this.moves.length,
        durationMs: performance.now() - this.startedAt,
        level: this.level,
      });
    }
  }

  humanPlay(idx) {
    if (this.status !== 'playing') return;
    if (this.thinking) return;
    if (this.turn !== this.human) {
      if (this.room) this.hooks.toast && this.hooks.toast('还没轮到你');
      return;
    }
    if (this.board[idx] !== 0) {
      this.hooks.toast && this.hooks.toast('这里已经有棋子了');
      return;
    }
    if (this.room) {
      this.submitRoomMove(idx);
      return;
    }
    this.applyMove(idx, this.human, true);
    if (this.status === 'playing') this.aiTurn();
  }

  async submitRoomMove(idx) {
    this.thinking = true;
    this.emitState();
    try {
      const room = await this.room.move({ move: idx, player: this.human });
      this.thinking = false;
      this.syncRoom(room);
    } catch (err) {
      this.thinking = false;
      this.emitState();
      this.hooks.toast && this.hooks.toast(err.message || '落子失败');
    }
  }

  async aiTurn() {
    if (this.room) return;
    if (this.status !== 'playing') return;
    const token = this.session;
    this.thinking = true;
    this.emitState();
    const started = performance.now();
    let res = null;
    let error = null;
    try {
      res = await this.engineClient.gomoku({
        board: this.board,
        player: this.ai,
        level: this.level,
        engine: this.engine,
      });
    } catch (err) {
      error = err;
    }
    if (token !== this.session || this.status !== 'playing') return;
    this.thinking = false;
    if (error || !res || !Number.isInteger(res.move)) {
      this.hooks.toast && this.hooks.toast('AI 思考失败，请重试');
      this.emitState();
      return;
    }
    const elapsed = performance.now() - started;
    this.aiTimes.push(elapsed);
    if (res.fallback) {
      this.hooks.toast && this.hooks.toast('边缘 AI 不可用，已回退本地引擎');
    }
    // Convert the score (AI perspective) into a short human-readable verdict.
    if (res.score > 900000) this.evalText = 'AI 必胜';
    else if (res.score > 30000) this.evalText = 'AI 占优';
    else if (res.score < -900000) this.evalText = '你必胜';
    else if (res.score < -30000) this.evalText = '你占优';
    else this.evalText = '均势';
    this.applyMove(res.move, this.ai, true);
    this.emitState();
  }

  rebuild() {
    this.board = newBoard(this.size);
    this.stones.clear();
    for (const mv of this.moves) {
      playMove(this.board, this.size, mv.idx, mv.player);
      this.stones.set(mv.idx, { color: mv.player, born: 0 });
    }
    this.lastMove = this.moves.length ? this.moves[this.moves.length - 1].idx : -1;
    this.winLine = [];
    this.status = 'playing';
    this.thinking = false;
    const counts = countStones(this.board);
    this.turn = counts.black === counts.white ? BLACK : WHITE;
  }

  undo() {
    if (this.room) {
      this.hooks.toast && this.hooks.toast('联机对局不能悔棋');
      return;
    }
    if (this.thinking) {
      this.session++;
      this.thinking = false;
    }
    if (!this.moves.length) {
      this.hooks.toast && this.hooks.toast('还没有落子');
      return;
    }
    if (this.status === 'over') {
      this.status = 'playing';
      this.winLine = [];
    }
    // Step back to the human's turn: remove the AI reply plus one human move.
    const last = this.moves.pop();
    if (last && last.player === this.ai && this.moves.length) this.moves.pop();
    this.record.length = this.moves.length;
    this.rebuild();
    this.turn = this.human;
    this.fx.clear();
    this.audio.play('select');
    this.emitState();
    if (this.hooks.onUndo) this.hooks.onUndo();
  }

  resign() {
    if (this.status !== 'playing') return;
    this.finish(this.ai, 'resign');
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.fx.destroy();
  }

  loop(ts) {
    if (!this.running) return;
    const dt = this.lastFrame ? Math.min(0.05, (ts - this.lastFrame) / 1000) : 0.016;
    this.lastFrame = ts;
    this.draw(ts, dt);
    this.raf = requestAnimationFrame(this.loop);
  }

  draw(ts, dt) {
    const ctx = this.ctx;
    if (!this.w || !this.h) return;
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.texture) ctx.drawImage(this.texture, 0, 0, this.w, this.h);

    const { pad, grid } = this.layout();
    const r = grid * 0.4;
    const boardEdge = pad + (this.size - 1) * grid;

    // Grid
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.32)';
    ctx.lineWidth = Math.max(0.7, grid * 0.028);
    ctx.beginPath();
    for (let i = 0; i < this.size; i++) {
      const p = pad + i * grid;
      ctx.moveTo(pad, p);
      ctx.lineTo(boardEdge, p);
      ctx.moveTo(p, pad);
      ctx.lineTo(p, boardEdge);
    }
    ctx.stroke();

    // Outer border
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.55)';
    ctx.lineWidth = Math.max(1.4, grid * 0.06);
    ctx.strokeRect(pad, pad, boardEdge - pad, boardEdge - pad);

    // Star points
    ctx.fillStyle = 'rgba(217, 164, 65, 0.55)';
    for (const [sx, sy] of STAR_POINTS) {
      if (sx >= this.size || sy >= this.size) continue;
      ctx.beginPath();
      ctx.arc(pad + sx * grid, pad + sy * grid, Math.max(1.6, grid * 0.055), 0, Math.PI * 2);
      ctx.fill();
    }

    // Coordinates
    const letters = 'ABCDEFGHIJKLMNO';
    ctx.fillStyle = 'rgba(217, 164, 65, 0.46)';
    ctx.font = `${Math.max(8, grid * 0.34)}px "SFMono-Regular", Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.size; i++) {
      const p = pad + i * grid;
      ctx.fillText(letters[i], p, pad * 0.46);
      ctx.fillText(String(i + 1), pad * 0.42, p);
    }

    // Hover ghost
    if (this.hover >= 0 && this.canPlay() && this.board[this.hover] === 0) {
      const hx = pad + (this.hover % this.size) * grid;
      const hy = pad + Math.floor(this.hover / this.size) * grid;
      ctx.globalAlpha = 0.34;
      this.drawStone(ctx, hx, hy, r, this.human, ts);
      ctx.globalAlpha = 1;
    }

    // Stones
    for (const [idx, stone] of this.stones) {
      const x = pad + (idx % this.size) * grid;
      const y = pad + Math.floor(idx / this.size) * grid;
      const age = stone.born ? (ts - stone.born) / 260 : 1;
      const scale = stone.born ? easeOutBack(Math.min(1, age)) : 1;
      this.drawStone(ctx, x, y, r * Math.max(0.001, scale), stone.color, ts);
      if (idx === this.lastMove && scale > 0.85) {
        ctx.fillStyle = '#d9a441';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.6, grid * 0.07), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Winning line
    if (this.winLine.length >= 5) {
      const first = this.winLine[0];
      const last = this.winLine[this.winLine.length - 1];
      const x1 = pad + (first % this.size) * grid;
      const y1 = pad + Math.floor(first / this.size) * grid;
      const x2 = pad + (last % this.size) * grid;
      const y2 = pad + Math.floor(last / this.size) * grid;
      const pulse = 0.62 + Math.sin(ts / 240) * 0.28;
      ctx.strokeStyle = `rgba(244, 212, 145, ${pulse})`;
      ctx.lineWidth = Math.max(3, grid * 0.1);
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(217, 164, 65, 0.8)';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  drawStone(ctx, x, y, r, color, ts) {
    if (r <= 0.01) return;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = r * 0.55;
    ctx.shadowOffsetY = r * 0.18;
    const grad = ctx.createRadialGradient(x - r * 0.33, y - r * 0.36, r * 0.1, x, y, r);
    if (color === BLACK) {
      grad.addColorStop(0, '#6d6f6c');
      grad.addColorStop(0.32, '#31332f');
      grad.addColorStop(0.78, '#111311');
      grad.addColorStop(1, '#050605');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.4, '#f5efe0');
      grad.addColorStop(0.82, '#d6cdb9');
      grad.addColorStop(1, '#b3a98f');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = color === BLACK ? 'rgba(255,255,255,0.12)' : 'rgba(90,76,48,0.28)';
    ctx.lineWidth = Math.max(0.6, r * 0.05);
    ctx.stroke();
    // Specular highlight
    ctx.globalAlpha = color === BLACK ? 0.22 : 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.36, r * 0.26, r * 0.17, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}