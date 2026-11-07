/**
 * Web Audio sound kit — synthesized, no external assets.
 * Browsers require a user gesture before audio can start, so call unlock() on first interaction.
 */
const STORAGE_KEY = 'qijing.sound.enabled';

export class AudioKit {
  constructor() {
    this.enabled = true;
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch (_) {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
  }

  unlock() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setEnabled(value) {
    this.enabled = !!value;
    try {
      localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off');
    } catch (_) {
      /* ignore */
    }
    if (this.enabled) this.unlock();
    else if (this.master) this.master.gain.value = 0;
    if (this.enabled && this.master) this.master.gain.value = 0.5;
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  tone({ freq = 440, type = 'sine', dur = 0.18, gain = 0.2, slideTo = null, delay = 0 }) {
    if (!this.enabled) return;
    const ctx = this.unlock();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  noise({ dur = 0.08, gain = 0.18, freq = 1400, q = 1.2, delay = 0, type = 'bandpass' }) {
    if (!this.enabled) return;
    const ctx = this.unlock();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** Dispatch a named preset, e.g. play('place'). */
  play(name) {
    if (name === 'play' || typeof this[name] !== 'function') return;
    try {
      this[name]();
    } catch (_) {
      /* never let audio break the game */
    }
  }

  click() {
    this.tone({ freq: 620, type: 'triangle', dur: 0.06, gain: 0.08 });
  }

  place() {
    this.noise({ dur: 0.07, gain: 0.22, freq: 900, q: 0.9 });
    this.tone({ freq: 190, type: 'sine', dur: 0.13, gain: 0.22, slideTo: 120 });
  }

  capture() {
    this.noise({ dur: 0.12, gain: 0.3, freq: 380, q: 0.7 });
    this.tone({ freq: 140, type: 'square', dur: 0.2, gain: 0.16, slideTo: 70 });
    this.tone({ freq: 520, type: 'triangle', dur: 0.1, gain: 0.1, delay: 0.03 });
  }

  select() {
    this.tone({ freq: 880, type: 'sine', dur: 0.06, gain: 0.07 });
  }

  check() {
    this.tone({ freq: 660, type: 'square', dur: 0.16, gain: 0.12 });
    this.tone({ freq: 880, type: 'square', dur: 0.18, gain: 0.12, delay: 0.13 });
  }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.34, gain: 0.16, delay: i * 0.12 }));
    this.tone({ freq: 1568, type: 'sine', dur: 0.5, gain: 0.1, delay: 0.48 });
  }

  lose() {
    const notes = [392, 349.23, 293.66, 220];
    notes.forEach((f, i) => this.tone({ freq: f, type: 'sine', dur: 0.4, gain: 0.15, delay: i * 0.14 }));
  }

  draw() {
    this.tone({ freq: 440, type: 'sine', dur: 0.4, gain: 0.1 });
    this.tone({ freq: 440, type: 'sine', dur: 0.4, gain: 0.1, delay: 0.22 });
  }

  notify() {
    this.tone({ freq: 1040, type: 'sine', dur: 0.12, gain: 0.1 });
    this.tone({ freq: 780, type: 'sine', dur: 0.18, gain: 0.08, delay: 0.1 });
  }
}