/** Canvas renderer for the Xiangqi board. Pure drawing, no game rules. */
import { fitCanvas, easeOutCubic } from '../core/fx.js';

export const PIECE_NAMES = {
  K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
  k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
};

const MARK_POINTS = [
  [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
  [6, 0], [6, 2], [6, 4], [6, 6], [6, 8],
  [2, 1], [2, 7], [7, 1], [7, 7],
];

export class ChessRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 1;
    this.h = 1;
    this.cell = 1;
    this.mx = 0;
    this.my = 0;
    this.texture = null;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const out = fitCanvas(this.canvas, Math.max(1, rect.width), Math.max(1, rect.height));
    this.ctx = out.ctx;
    this.w = out.w;
    this.h = out.h;
    this.cell = Math.min(this.w / 9.8, this.h / 11.4);
    this.mx = (this.w - 8 * this.cell) / 2;
    this.my = (this.h - 9 * this.cell) / 2;
    this.buildTexture();
  }

  pos(r, c) {
    return { x: this.mx + c * this.cell, y: this.my + r * this.cell };
  }

  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return -1;
    const x = ((clientX - rect.left) / rect.width) * this.w;
    const y = ((clientY - rect.top) / rect.height) * this.h;
    const c = Math.round((x - this.mx) / this.cell);
    const r = Math.round((y - this.my) / this.cell);
    if (r < 0 || r > 9 || c < 0 || c > 8) return -1;
    const p = this.pos(r, c);
    if (Math.hypot(x - p.x, y - p.y) > this.cell * 0.64) return -1;
    return r * 9 + c;
  }

  buildTexture() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(this.w));
    c.height = Math.max(1, Math.round(this.h));
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, this.w, this.h);
    grad.addColorStop(0, '#eccc95');
    grad.addColorStop(0.42, '#e3bf80');
    grad.addColorStop(0.75, '#d8ae69');
    grad.addColorStop(1, '#c99a56');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);

    for (let i = 0; i < 70; i++) {
      const y = Math.random() * this.h;
      g.beginPath();
      g.strokeStyle = `rgba(120, 76, 34, ${0.03 + Math.random() * 0.05})`;
      g.lineWidth = 0.5 + Math.random() * 1.6;
      g.moveTo(-10, y);
      g.bezierCurveTo(this.w * 0.35, y + (Math.random() - 0.5) * 20, this.w * 0.7, y + (Math.random() - 0.5) * 20, this.w + 10, y + (Math.random() - 0.5) * 12);
      g.stroke();
    }
    for (let i = 0; i < 2200; i++) {
      g.fillStyle = `rgba(${90 + Math.random() * 60}, ${55 + Math.random() * 40}, 20, ${Math.random() * 0.05})`;
      g.fillRect(Math.random() * this.w, Math.random() * this.h, 1.2, 1.2);
    }
    const v = g.createRadialGradient(this.w / 2, this.h / 2, this.w * 0.22, this.w / 2, this.h / 2, this.w * 0.82);
    v.addColorStop(0, 'rgba(255,244,215,0.10)');
    v.addColorStop(1, 'rgba(90,48,12,0.26)');
    g.fillStyle = v;
    g.fillRect(0, 0, c.width, c.height);
    this.texture = c;
  }

  draw(state, ts) {
    const ctx = this.ctx;
    const cell = this.cell;
    if (this.texture) ctx.drawImage(this.texture, 0, 0, this.w, this.h);
    else {
      ctx.fillStyle = '#dcb273';
      ctx.fillRect(0, 0, this.w, this.h);
    }

    this.drawGrid(ctx);

    // Last move markers
    if (state.lastMove) {
      const a = this.pos(Math.floor(state.lastMove.from / 9), state.lastMove.from % 9);
      const b = this.pos(Math.floor(state.lastMove.to / 9), state.lastMove.to % 9);
      ctx.strokeStyle = 'rgba(217, 164, 65, 0.85)';
      ctx.lineWidth = Math.max(1.4, cell * 0.045);
      this.cornerMark(ctx, a.x, a.y, cell * 0.3);
      ctx.strokeStyle = 'rgba(255, 236, 186, 0.9)';
      this.cornerMark(ctx, b.x, b.y, cell * 0.3);
    }

    // Legal destinations
    if (state.legal && state.legal.length) {
      for (const idx of state.legal) {
        const p = this.pos(Math.floor(idx / 9), idx % 9);
        const occupied = !!state.board[idx];
        if (occupied) {
          ctx.strokeStyle = 'rgba(192, 57, 43, 0.8)';
          ctx.lineWidth = Math.max(1.6, cell * 0.05);
          ctx.beginPath();
          ctx.arc(p.x, p.y, cell * 0.44, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const pulse = 0.4 + Math.sin(ts / 420) * 0.12;
          ctx.fillStyle = `rgba(45, 105, 86, ${pulse})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(3, cell * 0.13), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Pieces
    const anim = state.anim;
    for (let i = 0; i < state.board.length; i++) {
      const piece = state.board[i];
      if (!piece) continue;
      if (anim && i === anim.to) continue;
      if (anim && i === anim.from) continue;
      const p = this.pos(Math.floor(i / 9), i % 9);
      this.drawPiece(ctx, p.x, p.y, cell * 0.44, piece);
    }

    // Animation
    if (anim) {
      const t = Math.min(1, (ts - anim.start) / anim.duration);
      const eased = easeOutCubic(t);
      const a = this.pos(Math.floor(anim.from / 9), anim.from % 9);
      const b = this.pos(Math.floor(anim.to / 9), anim.to % 9);
      const x = a.x + (b.x - a.x) * eased;
      const y = a.y + (b.y - a.y) * eased;
      const lift = Math.sin(eased * Math.PI) * cell * 0.16;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = cell * 0.22;
      ctx.shadowOffsetY = cell * 0.1 + lift;
      this.drawPiece(ctx, x, y - lift, cell * 0.44, anim.piece);
      ctx.restore();
    }

    // Selection ring
    if (state.selected >= 0) {
      const p = this.pos(Math.floor(state.selected / 9), state.selected % 9);
      const pulse = 0.75 + Math.sin(ts / 260) * 0.25;
      ctx.strokeStyle = `rgba(244, 212, 145, ${pulse})`;
      ctx.lineWidth = Math.max(2, cell * 0.06);
      ctx.beginPath();
      ctx.arc(p.x, p.y, cell * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(217, 164, 65, 0.45)';
      ctx.lineWidth = Math.max(3, cell * 0.1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, cell * 0.52, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Check indicator
    if (state.checkSide) {
      const king = state.board.findIndex((p) => p && p.toUpperCase() === 'K' && (p === 'K' ? state.checkSide === 'w' : state.checkSide === 'b'));
      if (king >= 0) {
        const p = this.pos(Math.floor(king / 9), king % 9);
        const pulse = 0.45 + Math.sin(ts / 200) * 0.25;
        ctx.strokeStyle = `rgba(192, 57, 43, ${pulse})`;
        ctx.lineWidth = Math.max(2.5, cell * 0.07);
        ctx.beginPath();
        ctx.arc(p.x, p.y, cell * (0.52 + Math.sin(ts / 200) * 0.04), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  drawGrid(ctx) {
    const cell = this.cell;
    const x0 = this.mx;
    const y0 = this.my;
    const x1 = this.mx + 8 * cell;
    const y1 = this.my + 9 * cell;
    ctx.lineCap = 'round';

    // Board frame
    ctx.strokeStyle = 'rgba(74, 45, 20, 0.85)';
    ctx.lineWidth = Math.max(2, cell * 0.07);
    ctx.strokeRect(x0 - cell * 0.34, y0 - cell * 0.34, 8 * cell + cell * 0.68, 9 * cell + cell * 0.68);
    ctx.strokeStyle = 'rgba(120, 78, 36, 0.6)';
    ctx.lineWidth = Math.max(1, cell * 0.03);
    ctx.strokeRect(x0 - cell * 0.16, y0 - cell * 0.16, 8 * cell + cell * 0.32, 9 * cell + cell * 0.32);

    // Horizontal lines
    ctx.strokeStyle = 'rgba(70, 42, 18, 0.75)';
    ctx.lineWidth = Math.max(1, cell * 0.028);
    ctx.beginPath();
    for (let r = 0; r < 10; r++) {
      const y = y0 + r * cell;
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();

    // Vertical lines (broken at the river)
    ctx.beginPath();
    for (let c = 0; c < 9; c++) {
      const x = x0 + c * cell;
      if (c === 0 || c === 8) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      } else {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + 4 * cell);
        ctx.moveTo(x, y0 + 5 * cell);
        ctx.lineTo(x, y1);
      }
    }
    ctx.stroke();

    // Palaces
    ctx.beginPath();
    ctx.moveTo(x0 + 3 * cell, y0);
    ctx.lineTo(x0 + 5 * cell, y0 + 2 * cell);
    ctx.moveTo(x0 + 5 * cell, y0);
    ctx.lineTo(x0 + 3 * cell, y0 + 2 * cell);
    ctx.moveTo(x0 + 3 * cell, y0 + 7 * cell);
    ctx.lineTo(x0 + 5 * cell, y0 + 9 * cell);
    ctx.moveTo(x0 + 5 * cell, y0 + 7 * cell);
    ctx.lineTo(x0 + 3 * cell, y0 + 9 * cell);
    ctx.stroke();

    // Position markers
    ctx.strokeStyle = 'rgba(70, 42, 18, 0.55)';
    ctx.lineWidth = Math.max(1, cell * 0.032);
    const gap = cell * 0.11;
    const len = cell * 0.22;
    for (const [r, c] of MARK_POINTS) {
      const p = this.pos(r, c);
      const left = c > 0;
      const right = c < 8;
      ctx.beginPath();
      if (left) {
        ctx.moveTo(p.x - gap - len, p.y - gap);
        ctx.lineTo(p.x - gap, p.y - gap);
        ctx.lineTo(p.x - gap, p.y - gap - len);
        ctx.moveTo(p.x - gap - len, p.y + gap);
        ctx.lineTo(p.x - gap, p.y + gap);
        ctx.lineTo(p.x - gap, p.y + gap + len);
      }
      if (right) {
        ctx.moveTo(p.x + gap + len, p.y - gap);
        ctx.lineTo(p.x + gap, p.y - gap);
        ctx.lineTo(p.x + gap, p.y - gap - len);
        ctx.moveTo(p.x + gap + len, p.y + gap);
        ctx.lineTo(p.x + gap, p.y + gap);
        ctx.lineTo(p.x + gap, p.y + gap + len);
      }
      ctx.stroke();
    }

    // River text
    const midY = y0 + 4.5 * cell;
    ctx.fillStyle = 'rgba(92, 54, 22, 0.55)';
    ctx.font = `${Math.max(12, cell * 0.62)}px "Songti SC", "STSong", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('楚  河', x0 + 2 * cell, midY);
    ctx.fillText('漢  界', x0 + 6 * cell, midY);
  }

  cornerMark(ctx, x, y, size) {
    const d = Math.max(2, this.cell * 0.12);
    ctx.beginPath();
    ctx.moveTo(x - size, y - size + d);
    ctx.lineTo(x - size, y - size);
    ctx.lineTo(x - size + d, y - size);
    ctx.moveTo(x + size - d, y - size);
    ctx.lineTo(x + size, y - size);
    ctx.lineTo(x + size, y - size + d);
    ctx.moveTo(x + size, y + size - d);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x + size - d, y + size);
    ctx.moveTo(x - size + d, y + size);
    ctx.lineTo(x - size, y + size);
    ctx.lineTo(x - size, y + size - d);
    ctx.stroke();
  }

  drawPiece(ctx, x, y, r, piece) {
    const isRed = piece >= 'A' && piece <= 'Z';
    ctx.save();
    ctx.shadowColor = 'rgba(30, 15, 4, 0.4)';
    ctx.shadowBlur = r * 0.45;
    ctx.shadowOffsetY = r * 0.16;

    const base = ctx.createRadialGradient(x - r * 0.32, y - r * 0.34, r * 0.12, x, y, r);
    base.addColorStop(0, '#fffaf0');
    base.addColorStop(0.55, '#f3e6c9');
    base.addColorStop(0.9, '#ddc9a1');
    base.addColorStop(1, '#c5ab7d');
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = isRed ? 'rgba(150, 34, 24, 0.85)' : 'rgba(30, 32, 30, 0.85)';
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.94, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.8, r * 0.035);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = isRed ? '#9e2318' : '#20221f';
    ctx.font = `700 ${Math.round(r * 1.06)}px "STKaiti", "KaiTi", "Songti SC", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(PIECE_NAMES[piece] || piece, x, y + r * 0.04);
    ctx.restore();
  }
}