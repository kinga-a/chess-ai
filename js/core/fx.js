/** Canvas helpers, board particles, ambient background and confetti. */

export function fitCanvas(canvas, width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: width, h: height, dpr };
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}

export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.min(1, Math.max(0, t)) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** Transient particles + expanding rings drawn above the board. */
export class BoardEffects {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.rings = [];
    this.w = 1;
    this.h = 1;
    this.last = 0;
    this.raf = 0;
    this.running = true;
    this.resize();
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const out = fitCanvas(this.canvas, Math.max(1, rect.width), Math.max(1, rect.height));
    this.w = out.w;
    this.h = out.h;
  }

  burst(x, y, color = '#d9a441', count = 28, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (40 + Math.random() * 180) * power;
      this.parts.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 30,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.5,
        size: 1.2 + Math.random() * 2.6,
        color,
        gravity: 260,
      });
    }
  }

  ring(x, y, color = 'rgba(217,164,65,0.6)', maxR = 46) {
    this.rings.push({ x, y, r: 6, maxR, life: 0, maxLife: 0.5, color });
  }

  clear() {
    this.parts.length = 0;
    this.rings.length = 0;
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  tick(ts) {
    if (!this.running) return;
    const dt = Math.min(0.05, this.last ? (ts - this.last) / 1000 : 0.016);
    this.last = ts;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
      const alpha = 1 - p.life / p.maxLife;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      if (r.life >= r.maxLife) {
        this.rings.splice(i, 1);
        continue;
      }
      const t = r.life / r.maxLife;
      r.r = 6 + (r.maxR - 6) * easeOutCubic(t);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2 * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}

/** Slow drifting starfield behind the whole app. */
export class AmbientBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.points = [];
    this.w = 0;
    this.h = 0;
    this.raf = 0;
    this.running = true;
    this.resize();
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const out = fitCanvas(this.canvas, Math.max(1, rect.width), Math.max(1, rect.height));
    this.w = out.w;
    this.h = out.h;
    const count = Math.min(90, Math.round((this.w * this.h) / 16000));
    this.points = Array.from({ length: count }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      r: 0.6 + Math.random() * 1.7,
      vx: (Math.random() - 0.5) * 5,
      vy: (Math.random() - 0.5) * 5,
      alpha: 0.12 + Math.random() * 0.4,
      gold: Math.random() > 0.55,
    }));
  }

  tick() {
    if (!this.running) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    for (const p of this.points) {
      p.x += p.vx * 0.016;
      p.y += p.vy * 0.016;
      if (p.x < -10) p.x = this.w + 10;
      if (p.x > this.w + 10) p.x = -10;
      if (p.y < -10) p.y = this.h + 10;
      if (p.y > this.h + 10) p.y = -10;
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.gold ? '#d9a441' : '#8ff0da';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}

const CONFETTI_COLORS = ['#d9a441', '#f4d491', '#37c9a9', '#8ff0da', '#c0392b', '#ece6d6'];

export function launchConfetti(layer, count = 70) {
  if (!layer) return;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('i');
    el.className = 'confetti';
    el.style.left = `${Math.random() * 100}%`;
    el.style.top = `${-10 - Math.random() * 20}%`;
    el.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    el.style.animationDuration = `${2.2 + Math.random() * 2.2}s`;
    el.style.animationDelay = `${Math.random() * 0.5}s`;
    el.style.width = `${5 + Math.random() * 7}px`;
    el.style.height = `${8 + Math.random() * 12}px`;
    el.style.transform = `rotate(${Math.random() * 180}deg)`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 5200);
  }
}