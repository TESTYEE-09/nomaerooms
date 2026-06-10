// All in-game sound is synthesized with WebAudio (no asset downloads):
// room tone, fluorescent buzz, carpet footsteps, heartbeat + chase drone tied
// to Clark's distance, and the jumpscare sting. Menu music is theme.mp3.

import { clamp } from '../core/utils.js';

export class AudioEngine {
  constructor(settingsRef) {
    this.settings = settingsRef;
    this.ctx = null;
    this.started = false;
    this.fear = 0;
    this._nextBeat = 0;
    this._music = null;
  }

  // must be called from a user gesture
  init() {
    if (this.started) return;
    this.started = true;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.applyVolumes();

    // --- room tone: looped brown noise, heavily low-passed
    const noiseBuf = this._noiseBuffer(4, 'brown');
    const amb = ctx.createBufferSource();
    amb.buffer = noiseBuf;
    amb.loop = true;
    const ambFilt = ctx.createBiquadFilter();
    ambFilt.type = 'lowpass';
    ambFilt.frequency.value = 240;
    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.0;
    amb.connect(ambFilt).connect(this.ambGain).connect(this.sfx);
    amb.start();

    // --- fluorescent buzz: 120 Hz + harmonics, gain driven per frame
    this.buzzGain = ctx.createGain();
    this.buzzGain.gain.value = 0;
    this.buzzGain.connect(this.sfx);
    for (const [f, g] of [[120, 1], [240, 0.5], [360, 0.22]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g * 0.012;
      o.connect(og).connect(this.buzzGain);
      o.start();
    }

    // --- chase drone: detuned saws through a dark filter, swells with fear
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    const droneFilt = ctx.createBiquadFilter();
    droneFilt.type = 'lowpass';
    droneFilt.frequency.value = 420;
    droneFilt.Q.value = 3;
    this.droneGain.connect(this.sfx);
    droneFilt.connect(this.droneGain);
    for (const det of [-14, -5, 0, 7, 19]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 55;
      o.detune.value = det * 8;
      const og = ctx.createGain();
      og.gain.value = 0.05;
      o.connect(og).connect(droneFilt);
      o.start();
    }
  }

  _noiseBuffer(seconds, kind = 'white') {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  applyVolumes() {
    if (this.master) this.master.gain.value = this.settings.volume;
    if (this._music) this._music.volume = this.settings.musicVolume * this.settings.volume * 0.7;
  }

  // ---- menu music (theme.mp3, looped) ----
  playMenuMusic() {
    if (!this._music) {
      this._music = new Audio('./assets/music/theme.mp3');
      this._music.loop = true;
    }
    this._music.volume = this.settings.musicVolume * this.settings.volume * 0.7;
    this._music.play().catch(() => { /* needs a user gesture; retried on click */ });
  }
  stopMenuMusic(fade = 1.2) {
    const m = this._music;
    if (!m || m.paused) return;
    const v0 = m.volume;
    const t0 = performance.now();
    const tick = () => {
      const k = (performance.now() - t0) / (fade * 1000);
      if (k >= 1 || m.paused) { m.pause(); m.volume = v0; return; }
      m.volume = v0 * (1 - k);
      requestAnimationFrame(tick);
    };
    tick();
  }

  enterGame() {
    this.stopMenuMusic();
    if (this.ambGain) this.ambGain.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 2);
  }

  // dt-driven update: buzz follows the nearest fixture, heartbeat + drone follow fear
  update(t, buzzAmount, fear) {
    if (!this.ctx) return;
    this.fear = fear;
    const ct = this.ctx.currentTime;
    this.buzzGain.gain.setTargetAtTime(clamp(buzzAmount, 0, 1), ct, 0.08);
    this.droneGain.gain.setTargetAtTime(Math.max(0, fear - 0.35) * 1.5, ct, 0.4);

    if (fear > 0.15 && t > this._nextBeat) {
      const rate = 1.15 - fear * 0.62;       // seconds between beats
      this._nextBeat = t + rate;
      this._thump(0.25 + fear * 0.5);
      setTimeout(() => this._thump(0.18 + fear * 0.35), rate * 280);
    }
  }

  _thump(vol) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(58, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    o.connect(g).connect(this.sfx);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  }

  footstep(sprint) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._stepBuf || (this._stepBuf = this._noiseBuffer(0.25));
    src.playbackRate.value = 0.8 + Math.random() * 0.45;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = sprint ? 950 : 620;
    const g = ctx.createGain();
    const v = sprint ? 0.16 : 0.09;
    g.gain.setValueAtTime(v, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(0, Math.random() * 0.1, 0.13);
  }

  // distant other-player steps could go here (kept simple: ignored)

  click() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    o.connect(g).connect(this.sfx);
    o.start();
    o.stop(ctx.currentTime + 0.06);
  }

  chatPing() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.07, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.connect(g).connect(this.sfx);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  }

  jumpscare() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    // layered scream: detuned saw cluster swept down through a screechy bandpass
    for (const det of [0, 23, -31, 47, -57]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(720, t0);
      o.frequency.exponentialRampToValueAtTime(140, t0 + 1.0);
      o.detune.value = det * 4;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(1500, t0);
      f.frequency.exponentialRampToValueAtTime(300, t0 + 1.0);
      f.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.15);
      o.connect(f).connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + 1.2);
    }
    // noise crash
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer(1.2);
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 300;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
    n.connect(nf).connect(ng).connect(this.master);
    n.start(t0);
    // the eating: three wet chomps (noise crunch + jaw-slam sub thud)
    for (const off of [0.15, 0.5, 0.85]) {
      const cn = ctx.createBufferSource();
      cn.buffer = this._noiseBuffer(0.25);
      cn.playbackRate.value = 0.55;
      const cf = ctx.createBiquadFilter();
      cf.type = 'bandpass';
      cf.frequency.value = 480;
      cf.Q.value = 0.8;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t0 + off);
      cg.gain.exponentialRampToValueAtTime(0.5, t0 + off + 0.015);
      cg.gain.exponentialRampToValueAtTime(0.001, t0 + off + 0.16);
      cn.connect(cf).connect(cg).connect(this.master);
      cn.start(t0 + off);
      const jaw = ctx.createOscillator();
      jaw.type = 'sine';
      jaw.frequency.setValueAtTime(70, t0 + off);
      jaw.frequency.exponentialRampToValueAtTime(32, t0 + off + 0.1);
      const jg = ctx.createGain();
      jg.gain.setValueAtTime(0.45, t0 + off);
      jg.gain.exponentialRampToValueAtTime(0.001, t0 + off + 0.14);
      jaw.connect(jg).connect(this.master);
      jaw.start(t0 + off);
      jaw.stop(t0 + off + 0.16);
    }

    // sub impact
    const s = ctx.createOscillator();
    s.type = 'sine';
    s.frequency.setValueAtTime(90, t0);
    s.frequency.exponentialRampToValueAtTime(28, t0 + 0.7);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.5, t0);
    sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.8);
    s.connect(sg).connect(this.master);
    s.start(t0);
    s.stop(t0 + 0.9);
  }
}
