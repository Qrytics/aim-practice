/**
 * Small original synthesized sounds (Web Audio oscillators). No samples, no
 * game audio. The AudioContext is created lazily after a user gesture (browser
 * autoplay policy). Sound is on by default with a visible mute control, because
 * hit confirmation helps timing feedback. Volume is modest.
 */

export type SfxName = 'hit' | 'miss' | 'expire' | 'start' | 'end';

type AC = AudioContext;

export class Sfx {
  private ctx: AC | null = null;
  private master: GainNode | null = null;
  private _muted = false;
  private _volume = 0.5;

  get muted(): boolean {
    return this._muted;
  }
  get volume(): number {
    return this._volume;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    this.applyGain();
  }

  setVolume(v: number): void {
    this._volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5));
    this.applyGain();
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this._muted ? 0 : this._volume * 0.35;
  }

  /** Call from a user gesture (e.g. Start). Safe to call repeatedly; never throws. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.applyGain();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null; // audio is optional; never break the trainer
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, peak: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this._muted || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  play(name: SfxName): void {
    switch (name) {
      case 'hit':
        this.tone(880, 0.09, 'triangle', 0.9, 1320);
        break;
      case 'miss':
        this.tone(160, 0.09, 'sine', 0.6, 110);
        break;
      case 'expire':
        this.tone(220, 0.14, 'sine', 0.35, 150);
        break;
      case 'start':
        this.tone(660, 0.12, 'square', 0.3);
        this.tone(990, 0.16, 'square', 0.3, undefined, 0.12);
        break;
      case 'end':
        this.tone(740, 0.14, 'triangle', 0.6);
        this.tone(554, 0.14, 'triangle', 0.6, undefined, 0.14);
        this.tone(370, 0.26, 'triangle', 0.6, undefined, 0.28);
        break;
    }
  }
}
