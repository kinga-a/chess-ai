/**
 * Shared controller for the grid board games:
 * tictactoe (3×3), connect4 (7×6), othello (8×8).
 * Mirrors the GomokuGame/ChessGame interface so the shell can drive it.
 */
import * as ttt from '../ai/tictactoe-ai.js';
import * as c4 from '../ai/connect4-ai.js';
import * as oth from '../ai/othello-ai.js';

const ENGINES = {
  tictactoe: {
    title: '井字棋',
    reason: 'three',
    create: () => ttt.createBoard(),
    legal: (board) => ttt.legalMoves(board),
    apply: (board, move, player) => ttt.applyMove(board, move, player),
    status: (board) => ttt.statusOf(board),
    ai: (board, player, level) => ttt.findBestMove({ board, player, level }),
    label: (move, board) => ttt.describeMove(move, ttt.boardSize(board)),
    layout: () => ({ kind: 'square', cols: 3, rows: 3 }),
  },
  connect4: {
    title: '四子棋',
    reason: 'four',
    create: () => c4.createBoard(),
    legal: (board) => c4.legalMoves(board),
    apply: (board, move, player) => c4.applyMove(board, move, player),
    status: (board) => c4.statusOf(board),
    ai: (board, player, level) => c4.findBestMove({ board, player, level }),
    label: (move) => c4.describeMove(move),
    layout: () => ({ kind: 'columns', cols: 7, rows: 6 }),
  },
  othello: {
    title: '黑白棋',
    reason: 'count',
    create: () => oth.createBoard(),
    legal: (board, player) => oth.legalMoves(board, player),
    apply: (board, move, player) => oth.applyMove(board, move, player),
    status: (board, next) => oth.statusOf(board, next),
    ai: (board, player, level) => oth.findBestMove({ board, player, level }),
    label: (move) => oth.describeMove(move),
    layout: () => ({ kind: 'square', cols: 8, rows: 8 }),
    score: (board) => oth.scoreOf(board),
    countWinner: (board) => {
      const { black, white } = oth.scoreOf(board);
      return black > white ? 1 : white > black ? 2 : 0;
    },
  },
};

export const BOARD_GAME_IDS = Object.keys(ENGINES);

export function boardGameMeta(id) {
  const e = ENGINES[id];
  return e ? { id, title: e.title } : null;
}

export class BoardGame {
  constructor({ id, mount, hooks, audio }) {
    this.id = id;
    this.engine = ENGINES[id];
    this.mount = mount;
    this.hooks = hooks || {};
    this.audio = audio;
    this.level = 'normal';
    this.human = 1;
    this.ai = 2;
    this.board = this.engine.create();
    this.turn = 1;
    this.status = 'playing';
    this.winner = 0;
    this.moves = [];
    this.record = [];
    this.aiTimes = [];
    this.thinking = false;
    this.room = null;
    this.startedAt = performance.now();
    this.lastAiTime = 0;
    this.evalText = '均势';
    this.winCells = [];
    this.timer = 0;
    if (this.mount) {
      this.mount.addEventListener('click', (event) => {
        const cell = event.target.closest('[data-move], [data-col]');
        if (!cell) return;
        if (cell.dataset.col !== undefined) this.humanMove(Number(cell.dataset.col));
        else this.humanMove(Number(cell.dataset.move));
      });
    }
  }

  label(move) {
    return this.engine.label(move, this.board);
  }

  newGame(options = {}) {
    if (this.timer) clearTimeout(this.timer);
    this.level = options.level || this.level;
    this.room = options.roomClient || null;
    const roomState = options.roomState || (this.room && this.room.room) || null;
    this.human = options.mySide || (roomState ? roomState.humanSide : options.side === 'second' ? 2 : 1);
    this.ai = 3 - this.human;
    this.board = roomState ? roomState.board.slice() : this.engine.create();
    this.turn = roomState ? roomState.turn : 1;
    this.status = roomState ? roomState.status : 'playing';
    this.winner = roomState ? roomState.winner || 0 : 0;
    this.moves = [];
    this.record = [];
    this.aiTimes = [];
    this.thinking = false;
    this.lastAiTime = 0;
    this.evalText = '均势';
    this.winCells = [];
    this.startedAt = performance.now();
    if (roomState) this.syncRoom(roomState, false);
    this.render();
    this.emitState();
    if (!this.room && this.status === 'playing' && this.turn === this.ai) this.aiTurn();
  }

  syncRoom(room, animate = true) {
    if (!room) return;
    const incoming = room.moves || [];
    if (incoming.length < this.moves.length) {
      this.board = this.engine.create();
      this.moves = [];
      this.record = [];
      this.winCells = [];
      if (this.status === 'over') {
        this.status = 'playing';
        this.winner = 0;
      }
    }
    for (let i = this.moves.length; i < incoming.length; i += 1) {
      const mv = incoming[i];
      const res = this.engine.apply(this.board, mv.move, mv.player);
      if (!res) continue;
      this.board = res.board;
      this.moves.push({ move: mv.move, player: mv.player });
      this.record.push({ player: mv.player, label: this.label(mv.move) });
      this.turn = res.nextPlayer;
      if (res.win) {
        this.status = 'over';
        this.winner = res.winner;
      } else if (res.draw) {
        this.status = 'over';
        this.winner = 0;
      }
    }
    this.turn = room.turn;
    if (room.status === 'over' && this.status !== 'over') {
      this.status = 'over';
      this.winner = room.winner || 0;
    }
    this.render();
    this.emitState();
  }

  applyLocal(move, player) {
    const res = this.engine.apply(this.board, move, player);
    if (!res) return false;
    this.board = res.board;
    this.moves.push({ move, player });
    this.record.push({ player, label: this.label(move) });
    this.turn = res.nextPlayer;
    if (res.win) this.finish(res.winner, this.engine.reason);
    else if (res.draw) this.finish(0, 'draw');
    else this.settleTurns();
    this.render();
    this.emitState();
    return true;
  }

  settleTurns() {
    if (this.status !== 'playing') return;
    if (this.room) return;
    if (this.engine.legal(this.board, this.turn).length) return;
    const other = 3 - this.turn;
    if (!this.engine.legal(this.board, other).length) {
      this.finish(this.engine.countWinner ? this.engine.countWinner(this.board) : 0, this.engine.reason);
      return;
    }
    this.turn = other;
    if (this.turn === this.ai) this.aiTurn();
  }

  humanMove(move) {
    if (this.status !== 'playing' || this.thinking) return;
    if (this.turn !== this.human) return;
    if (this.room) {
      this.thinking = true;
      this.emitState();
      this.room
        .move({ move })
        .then((room) => {
          this.thinking = false;
          this.syncRoom(room);
        })
        .catch((err) => {
          this.thinking = false;
          this.emitState();
          this.hooks.toast && this.hooks.toast(err.message || '落子失败');
        });
      return;
    }
    if (!this.applyLocal(move, this.human)) {
      this.hooks.toast && this.hooks.toast('这里不能落子');
      return;
    }
    if (this.status === 'playing' && this.turn === this.ai) this.aiTurn();
  }

  aiTurn() {
    if (this.room || this.status !== 'playing' || this.turn !== this.ai) return;
    this.thinking = true;
    this.emitState();
    this.timer = setTimeout(() => {
      const started = performance.now();
      const move = this.engine.ai(this.board, this.ai, this.level);
      this.lastAiTime = performance.now() - started;
      this.aiTimes.push(this.lastAiTime);
      this.thinking = false;
      if (move < 0) {
        this.turn = this.human;
        if (!this.engine.legal(this.board, this.human).length) {
          this.finish(this.engine.countWinner ? this.engine.countWinner(this.board) : 0, this.engine.reason);
        }
        this.render();
        this.emitState();
        return;
      }
      this.applyLocal(move, this.ai);
    }, 140);
  }

  finish(winner, reason) {
    if (this.status === 'over') return;
    this.status = 'over';
    this.winner = winner || 0;
    this.thinking = false;
    const humanWon = winner === this.human;
    if (this.audio) {
      if (!winner) this.audio.play('draw');
      else if (humanWon) this.audio.play('win');
      else this.audio.play('lose');
    }
    if (humanWon && this.hooks.confetti) this.hooks.confetti();
    this.emitState();
    if (this.hooks.onEnd) {
      this.hooks.onEnd({
        game: this.id,
        winner: this.winner,
        human: this.human,
        reason,
        moveCount: this.moves.length,
        durationMs: performance.now() - this.startedAt,
        level: this.level,
      });
    }
  }

  emitState() {
    const state = {
      game: this.id,
      status: this.status,
      turn: this.turn,
      human: this.human,
      ai: this.ai,
      thinking: this.thinking,
      moveCount: this.moves.length,
      aiTime: this.aiTimes.length ? this.aiTimes[this.aiTimes.length - 1] : null,
      evalText: this.evalText,
      record: this.record.slice(),
      roomMode: !!this.room,
      roomCode: this.room ? this.room.code : '',
      check: false,
      captured: [],
      stones: { black: this.moves.filter((m) => m.player === 1).length, white: this.moves.filter((m) => m.player === 2).length },
      winner: this.winner,
    };
    if (this.hooks.onState) this.hooks.onState(state);
  }

  render() {
    if (!this.mount) return;
    const { kind, cols, rows } = this.engine.layout();
    const legal = this.status === 'playing' && this.turn === this.human && !this.thinking
      ? new Set(this.engine.legal(this.board, this.turn))
      : new Set();
    const last = this.moves.length ? this.moves[this.moves.length - 1] : null;

    if (kind === 'columns') {
      const cells = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const idx = r * cols + c;
          const v = this.board[idx];
          const playable = legal.has(c) ? ' playable' : '';
          cells.push(
            `<div class="gcell${playable}" data-col="${c}" data-idx="${idx}">` +
              `${v ? `<span class="disc p${v}${last && last.move === c && idx === lastCell(this.board, cols, c) ? ' pop' : ''}"></span>` : ''}` +
              `</div>`,
          );
        }
      }
      this.mount.innerHTML = `<div class="grid-board grid-connect4" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>`;
      return;
    }

    const cells = [];
    for (let i = 0; i < this.board.length; i += 1) {
      const v = this.board[i];
      const playable = legal.has(i) ? ' playable' : '';
      const pop = last && last.move === i ? ' pop' : '';
      let inner = '';
      if (this.id === 'othello') {
        inner = v ? `<span class="disc p${v}${pop}"></span>` : playable ? '<span class="hint-dot"></span>' : '';
      } else {
        inner = v ? `<span class="mark p${v}${pop}">${v === 1 ? '×' : '○'}</span>` : '';
      }
      cells.push(`<div class="gcell${playable}" data-move="${i}">${inner}</div>`);
    }
    this.mount.innerHTML = `<div class="grid-board grid-${this.id}" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>`;
  }

  undo() {
    if (this.room) {
      this.hooks.toast && this.hooks.toast('联机对局不能悔棋');
      return;
    }
    if (this.thinking || !this.moves.length) return;

    const removeCount = this.turn === this.human ? 2 : 1;
    const kept = this.moves.slice(0, Math.max(0, this.moves.length - removeCount));
    this.board = this.engine.create();
    this.moves = [];
    this.record = [];
    this.winCells = [];
    this.turn = 1;

    for (const mv of kept) {
      const res = this.engine.apply(this.board, mv.move, mv.player);
      if (!res) break;
      this.board = res.board;
      this.moves.push({ move: mv.move, player: mv.player });
      this.record.push({ player: mv.player, label: this.label(mv.move) });
      this.turn = res.nextPlayer || 3 - mv.player;
    }

    this.status = 'playing';
    this.winner = 0;
    this.render();
    this.emitState();
    if (this.turn === this.ai) this.aiTurn();
  }

  resign() {
    if (this.status !== 'playing') return;
    this.finish(3 - this.human, 'resign');
  }

  resize() {
    /* grid layout is CSS-driven */
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = 0;
    if (this.mount) this.mount.innerHTML = '';
  }
}

function lastCell(board, cols, col) {
  for (let r = board.length / cols - 1; r >= 0; r -= 1) {
    if (board[r * cols + col] !== 0) return r * cols + col;
  }
  return -1;
}