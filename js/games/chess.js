/**
 * Chinese Chess controller: rules via the shared engine, animations, AI loop, history.
 */
import {
  START_FEN,
  RED,
  BLACK,
  parseFen,
  toFen,
  legalMoves,
  makeMove,
  isKingAttacked,
  opposite,
  colorOf,
  labelOfIndex,
} from '../ai/chess-ai.js';
import { ChessRenderer, PIECE_NAMES } from './chess-renderer.js';
import { BoardEffects } from '../core/fx.js';

const VALUES = { K: 0, R: 9, N: 4, C: 4.5, B: 2, A: 2, P: 1 };

export class ChessGame {
  constructor({ canvas, fxCanvas, audio, engineClient, hooks }) {
    this.canvas = canvas;
    this.renderer = new ChessRenderer(canvas);
    this.fx = new BoardEffects(fxCanvas);
    this.audio = audio;
    this.engineClient = engineClient;
    this.hooks = hooks || {};
    this.fen = START_FEN;
    this.board = parseFen(START_FEN).board;
    this.side = RED;
    this.human = RED;
    this.ai = BLACK;
    this.selected = -1;
    this.legalForSelected = [];
    this.lastMove = null;
    this.anim = null;
    this.history = [];
    this.record = [];
    this.captured = [];
    this.status = 'idle';
    this.check = false;
    this.thinking = false;
    this.session = 0;
    this.startedAt = 0;
    this.aiTimes = [];
    this.level = 'normal';
    this.engine = 'local';
    this.room = null;
    this.evalText = '均势';
    this.halfmove = 0;
    this.fullmove = 1;
    this.running = true;
    this.raf = 0;
    this.lastFrame = 0;
    this.bindEvents();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  bindEvents() {
    this.onPointerDown = (e) => {
      e.preventDefault();
      this.audio.unlock();
      this.handleClick(e.clientX, e.clientY);
    };
    this.onPointerMove = (e) => {
      const idx = this.renderer.hitTest(e.clientX, e.clientY);
      this.canvas.style.cursor =
        idx >= 0 && this.board[idx] && colorOf(this.board[idx]) === this.human && this.canPlay()
          ? 'pointer'
          : 'default';
    };
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
  }

  resize() {
    this.renderer.resize();
    this.fx.resize();
  }

  canPlay() {
    return this.status === 'playing' && !this.thinking && this.side === this.human;
  }

  newGame(options = {}) {
    this.session++;
    this.level = options.level || this.level;
    this.engine = options.engine || this.engine;
    this.room = options.roomClient || null;
    const roomState = options.roomState || (this.room && this.room.room) || null;
    this.human = options.mySide || (roomState ? roomState.humanSide : options.side === 'second' ? BLACK : RED);
    this.ai = opposite(this.human);
    this.fen = START_FEN;
    this.board = parseFen(this.fen).board;
    this.side = roomState ? roomState.turn : RED;
    this.selected = -1;
    this.legalForSelected = [];
    this.lastMove = null;
    this.anim = null;
    this.history = [];
    this.record = [];
    this.captured = [];
    this.check = false;
    this.thinking = false;
    this.status = roomState ? roomState.status : 'playing';
    this.halfmove = 0;
    this.fullmove = 1;
    this.startedAt = performance.now();
    this.aiTimes = [];
    this.evalText = '均势';
    this.fx.clear();
    this.emitState();
    if (roomState) {
      if (roomState.moves.length) this.syncRoom(roomState, false);
    } else if (!this.room && this.side === this.ai) {
      this.aiTurn();
    }
  }

  /** Apply the authoritative room state, appending only unseen moves. */
  syncRoom(room, animate = true) {
    if (!room || room.game !== 'chess') return;
    if (room.moves.length < this.record.length) {
      this.fen = START_FEN;
      this.board = parseFen(START_FEN).board;
      this.side = RED;
      this.history = [];
      this.record = [];
      this.captured = [];
      this.lastMove = null;
      this.anim = null;
      this.check = false;
      if (this.status === 'over') this.status = 'playing';
    }
    for (let i = this.record.length; i < room.moves.length; i += 1) {
      const mv = room.moves[i];
      const fromLabel = typeof mv.from === 'string' ? mv.from : labelOfIndex(mv.from);
      const toLabel = typeof mv.to === 'string' ? mv.to : labelOfIndex(mv.to);
      const legal = legalMoves(this.board, this.side).find(
        (m) => labelOfIndex(m.from) === fromLabel && labelOfIndex(m.to) === toLabel,
      );
      if (!legal) continue;
      this.playMove(legal, mv.player === this.human, animate);
    }
    this.side = room.turn;
    if (room.fen) {
      const parsed = parseFen(room.fen);
      this.board = parsed.board;
      this.fen = room.fen;
      this.halfmove = parsed.halfmove;
      this.fullmove = parsed.fullmove;
      this.check = isKingAttacked(this.board, this.side);
    }
    if (room.status === 'over' && this.status !== 'over') {
      this.finish(room.winner || opposite(this.side), room.reason || 'room');
    }
    this.emitState();
  }

  async submitRoomMove(mv) {
    this.thinking = true;
    this.emitState();
    try {
      const room = await this.room.move({ from: labelOfIndex(mv.from), to: labelOfIndex(mv.to) });
      this.thinking = false;
      this.syncRoom(room);
    } catch (err) {
      this.thinking = false;
      this.emitState();
      this.hooks.toast && this.hooks.toast(err.message || '走子失败');
    }
  }

  emitState() {
    if (this.hooks.onState) {
      this.hooks.onState({
        game: 'chess',
        status: this.status,
        turn: this.side,
        human: this.human,
        ai: this.ai,
        thinking: this.thinking,
        moveCount: this.record.length,
        aiTime: this.aiTimes.length ? this.aiTimes[this.aiTimes.length - 1] : null,
        evalText: this.evalText,
        record: this.record.slice(),
        captured: this.captured.slice(),
        check: this.check,
        roomMode: !!this.room,
        roomCode: this.room ? this.room.code : '',
      });
    }
  }

  handleClick(clientX, clientY) {
    if (!this.canPlay()) {
      if (this.status === 'playing' && this.side !== this.human) this.hooks.toast && this.hooks.toast('等 AI 走完这一手');
      return;
    }
    const idx = this.renderer.hitTest(clientX, clientY);
    if (idx < 0) {
      this.clearSelection();
      return;
    }
    const piece = this.board[idx];
    if (piece && colorOf(piece) === this.human) {
      if (idx === this.selected) {
        this.clearSelection();
      } else {
        this.selected = idx;
        this.legalForSelected = legalMoves(this.board, this.side).filter((m) => m.from === idx);
        this.audio.play('select');
      }
      return;
    }
    if (this.selected >= 0) {
      const mv = this.legalForSelected.find((m) => m.to === idx);
      if (mv) {
        if (this.room) this.submitRoomMove(mv);
        else this.playMove(mv, true);
        return;
      }
      this.audio.play('error');
      this.clearSelection();
      return;
    }
    if (piece) this.audio.play('error');
  }

  clearSelection() {
    this.selected = -1;
    this.legalForSelected = [];
  }

  snapshot() {
    return {
      fen: this.fen,
      side: this.side,
      lastMove: this.lastMove,
      recordLen: this.record.length,
      capturedLen: this.captured.length,
      halfmove: this.halfmove,
      fullmove: this.fullmove,
    };
  }

  playMove(mv, byHuman) {
    this.history.push(this.snapshot());
    const captured = makeMove(this.board, mv);
    if (captured) this.captured.push(captured);
    const nextSide = opposite(this.side);
    this.halfmove = captured ? 0 : this.halfmove + 1;
    if (this.side === BLACK) this.fullmove++;
    this.side = nextSide;
    this.fen = toFen(this.board, this.side, this.halfmove, this.fullmove);
    this.lastMove = { from: mv.from, to: mv.to };
    this.anim = {
      from: mv.from,
      to: mv.to,
      piece: mv.piece,
      start: performance.now(),
      duration: 320,
    };
    this.record.push({
      player: byHuman ? this.human : this.ai,
      piece: mv.piece,
      from: labelOfIndex(mv.from),
      to: labelOfIndex(mv.to),
      capture: captured || null,
    });
    this.clearSelection();
    if (captured) this.audio.play('capture');
    else this.audio.play('place');

    const target = this.renderer.pos(Math.floor(mv.to / 9), mv.to % 9);
    this.fx.ring(target.x, target.y, captured ? 'rgba(192,57,43,0.7)' : 'rgba(217,164,65,0.7)', this.renderer.cell * 1.1);
    this.fx.burst(target.x, target.y, captured ? '#ff7a63' : '#f4d491', captured ? 26 : 14, captured ? 1.05 : 0.6);

    const inCheck = isKingAttacked(this.board, this.side);
    const responses = legalMoves(this.board, this.side);
    this.check = inCheck;
    this.evalText = this.materialText();

    if (responses.length === 0) {
      this.finish(opposite(this.side), inCheck ? 'checkmate' : 'stalemate');
      this.emitState();
      return;
    }
    if (inCheck) {
      this.audio.play('check');
      this.hooks.toast && this.hooks.toast('将军！');
    }
    this.emitState();
    if (this.status === 'playing' && !this.room) this.aiTurn();
  }

  materialText() {
    let red = 0;
    let black = 0;
    for (const p of this.board) {
      if (!p) continue;
      const v = VALUES[p.toUpperCase()] || 0;
      if (colorOf(p) === RED) red += v;
      else black += v;
    }
    const diff = Math.round((red - black) * 10) / 10;
    if (diff === 0) return '均势';
    const abs = Math.abs(diff).toFixed(1);
    return diff > 0 ? `红 +${abs}` : `黑 +${abs}`;
  }

  async aiTurn() {
    if (this.status !== 'playing') return;
    const token = this.session;
    this.thinking = true;
    this.emitState();
    const started = performance.now();
    let res = null;
    let error = null;
    try {
      res = await this.engineClient.chess({
        fen: this.fen,
        level: this.level,
        engine: this.engine,
      });
    } catch (err) {
      error = err;
    }
    if (token !== this.session || this.status !== 'playing') return;
    this.thinking = false;
    if (error || !res || !Number.isInteger(res.from) || !Number.isInteger(res.to) || !res.fen) {
      this.hooks.toast && this.hooks.toast('AI 思考失败，请重试');
      this.emitState();
      return;
    }
    if (res.fallback) this.hooks.toast && this.hooks.toast('边缘 AI 不可用，已回退本地引擎');
    this.aiTimes.push(performance.now() - started);

    this.history.push(this.snapshot());
    const parsed = parseFen(res.fen);
    this.board = parsed.board;
    this.side = parsed.side;
    this.fen = res.fen;
    this.halfmove = parsed.halfmove;
    this.fullmove = parsed.fullmove;
    const piece = res.piece || this.board[res.from];
    this.lastMove = { from: res.from, to: res.to };
    this.anim = {
      from: res.from,
      to: res.to,
      piece,
      start: performance.now(),
      duration: 340,
    };
    if (res.capture) this.captured.push(res.capture);
    this.record.push({
      player: this.ai,
      piece,
      from: res.fromLabel || labelOfIndex(res.from),
      to: res.toLabel || labelOfIndex(res.to),
      capture: res.capture || null,
    });
    this.clearSelection();
    if (res.capture) this.audio.play('capture');
    else this.audio.play('place');

    const target = this.renderer.pos(Math.floor(res.to / 9), res.to % 9);
    this.fx.ring(target.x, target.y, res.capture ? 'rgba(192,57,43,0.7)' : 'rgba(55,201,169,0.7)', this.renderer.cell * 1.1);
    this.fx.burst(target.x, target.y, res.capture ? '#ff7a63' : '#37c9a9', 18, 0.7);

    this.check = !!res.check;
    this.evalText = this.materialText();
    if (res.check && !res.checkmate) {
      this.audio.play('check');
      this.hooks.toast && this.hooks.toast('将军！');
    }
    if (res.checkmate || res.stalemate) {
      this.finish(opposite(this.side), res.checkmate ? 'checkmate' : 'stalemate');
    }
    this.emitState();
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
    if (!this.history.length) {
      this.hooks.toast && this.hooks.toast('还没有可悔的棋');
      return;
    }
    if (this.status === 'over') this.status = 'playing';
    // Rewind to the last snapshot taken before a human move.
    let snap = null;
    while (this.history.length) {
      const candidate = this.history.pop();
      if (candidate.side === this.human) {
        snap = candidate;
        break;
      }
      if (!this.history.length) {
        snap = candidate;
        break;
      }
    }
    if (!snap) {
      this.hooks.toast && this.hooks.toast('还没有可悔的棋');
      return;
    }
    const parsed = parseFen(snap.fen);
    this.fen = snap.fen;
    this.board = parsed.board;
    this.side = snap.side;
    this.lastMove = snap.lastMove;
    this.record.length = snap.recordLen;
    this.captured.length = snap.capturedLen;
    this.halfmove = snap.halfmove;
    this.fullmove = snap.fullmove;
    this.check = isKingAttacked(this.board, this.side);
    this.anim = null;
    this.clearSelection();
    this.evalText = this.materialText();
    this.fx.clear();
    this.audio.play('select');
    this.emitState();
  }

  resign() {
    if (this.status !== 'playing') return;
    this.finish(this.ai, 'resign');
  }

  finish(winner, reason) {
    if (this.status === 'over') return;
    this.status = 'over';
    this.thinking = false;
    const humanWon = winner === this.human;
    if (humanWon) {
      this.audio.play('win');
      this.hooks.confetti && this.hooks.confetti();
    } else {
      this.audio.play('lose');
    }
    if (winner && this.fx) {
      this.fx.burst(this.renderer.w / 2, this.renderer.h / 2, '#f4d491', 46, 1.6);
    }
    this.emitState();
    if (this.hooks.onEnd) {
      this.hooks.onEnd({
        game: 'chess',
        winner,
        human: this.human,
        reason,
        moveCount: this.record.length,
        durationMs: performance.now() - this.startedAt,
        level: this.level,
      });
    }
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.fx.destroy();
  }

  loop(ts) {
    if (!this.running) return;
    if (this.anim && ts - this.anim.start > this.anim.duration) {
      this.anim = null;
      if (this.hooks.onAnimEnd) this.hooks.onAnimEnd();
    }
    this.renderer.draw(
      {
        board: this.board,
        selected: this.selected,
        legal: this.legalForSelected.map((m) => m.to),
        lastMove: this.lastMove,
        anim: this.anim,
        checkSide: this.check ? this.side : null,
      },
      ts,
    );
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Exported for the help panel. */
  static pieceNames = PIECE_NAMES;
}