// All in-game sound is synthesized with WebAudio (no asset downloads):
// room tone, fluorescent buzz, carpet footsteps, heartbeat + chase drone tied
// to Clark's distance, and the jumpscare sting.

import { clamp } from '../core/utils.js';

export class AudioEngine {
  constructor(settingsRef) {
    this.settings = settingsRef;
    this.ctx = null;
    this.started = false;
    this.fear = 0;
    this._nextBeat = 0;
    this._music = null;
    this._tinnitusActive = false;
    this._tinnitusNodes = null;
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

  // ---- procedural menu music ----
  playMenuMusic() {
    if (this._music) return;
    const ctx = this.ctx;
    // Simple ambient drone for menu
    this._music = ctx.createGain();
    this._music.connect(this.master);
    this._music.gain.value = 0;
    this._musicSources = [];
    const notes = [55, 41.2, 49, 36.7]; // A1, F1, G1, D1
    for (const freq of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.value = 0.02;
      osc.connect(gain).connect(this._music);
      osc.start();
      this._musicSources.push(osc);
    }
    this._music.gain.linearRampToValueAtTime(this.settings.musicVolume * this.settings.volume * 0.7, ctx.currentTime + 2);
  }
  stopMenuMusic(fade = 1.2) {
    if (!this._music) return;
    const v0 = this._music.gain.value || 0;
    const ctx = this.ctx;
    this._music.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
    setTimeout(() => {
      this._musicSources?.forEach(o => { try { o.stop(); } catch {} });
      this._musicSources = [];
      this._music.disconnect();
      this._music = null;
    }, fade * 1000);
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

    // impact stinger at the very start
    const stinger = ctx.createOscillator();
    stinger.type = 'square';
    stinger.frequency.setValueAtTime(120, t0);
    stinger.frequency.exponentialRampToValueAtTime(320, t0 + 0.03);
    stinger.frequency.exponentialRampToValueAtTime(60, t0 + 0.35);
    const stingerG = ctx.createGain();
    stingerG.gain.setValueAtTime(0.0001, t0);
    stingerG.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
    stingerG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    const stingerW = ctx.createWaveShaper();
    stingerW.curve = this._distCurve(200);
    stinger.connect(stingerW).connect(stingerG).connect(this.master);
    stinger.start(t0);
    stinger.stop(t0 + 0.5);

    // layered scream: detuned saw cluster swept down through a screechy bandpass
    for (const det of [0, 23, -31, 47, -57]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(880, t0);
      o.frequency.exponentialRampToValueAtTime(120, t0 + 1.0);
      o.detune.value = det * 5;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(2000, t0);
      f.frequency.exponentialRampToValueAtTime(250, t0 + 1.0);
      f.Q.value = 2.0;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.15);
      const w = ctx.createWaveShaper();
      w.curve = this._distCurve(100);
      o.connect(f).connect(w).connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + 1.2);
    }
    // noise crash — wider, louder
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer(1.2);
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
    n.connect(nf).connect(ng).connect(this.master);
    n.start(t0);
    // the eating: three wet chomps (noise crunch + jaw-slam sub thud)
    for (const off of [0.15, 0.5, 0.85]) {
      const cn = ctx.createBufferSource();
      cn.buffer = this._noiseBuffer(0.25);
      cn.playbackRate.value = 0.45;
      const cf = ctx.createBiquadFilter();
      cf.type = 'bandpass';
      cf.frequency.value = 520;
      cf.Q.value = 1.2;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t0 + off);
      cg.gain.exponentialRampToValueAtTime(0.6, t0 + off + 0.015);
      cg.gain.exponentialRampToValueAtTime(0.001, t0 + off + 0.18);
      cn.connect(cf).connect(cg).connect(this.master);
      cn.start(t0 + off);
      const jaw = ctx.createOscillator();
      jaw.type = 'sine';
      jaw.frequency.setValueAtTime(80, t0 + off);
      jaw.frequency.exponentialRampToValueAtTime(28, t0 + off + 0.12);
      const jg = ctx.createGain();
      jg.gain.setValueAtTime(0.55, t0 + off);
      jg.gain.exponentialRampToValueAtTime(0.001, t0 + off + 0.16);
      jaw.connect(jg).connect(this.master);
      jaw.start(t0 + off);
      jaw.stop(t0 + off + 0.18);
    }

    // sub impact deeper
    const s = ctx.createOscillator();
    s.type = 'sine';
    s.frequency.setValueAtTime(100, t0);
    s.frequency.exponentialRampToValueAtTime(22, t0 + 0.7);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.6, t0);
    sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
    s.connect(sg).connect(this.master);
    s.start(t0);
    s.stop(t0 + 1.0);
  }

  _distCurve(amount) {
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  flashlightOn() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    // electrical hum/click — short power-on transient
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t0);
    o.frequency.exponentialRampToValueAtTime(80, t0 + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 600;
    f.Q.value = 2.0;
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t0);
    o.stop(t0 + 0.3);

    // subtle noise burst
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer(0.3);
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 800;
    nf.Q.value = 1.5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.06, t0 + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    n.connect(nf).connect(ng).connect(this.sfx);
    n.start(t0);
    n.stop(t0 + 0.3);
  }

  // ---- audio hallucinations ----

  hallucinationWhisper() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + Math.random() * 0.15;

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(1.0);

    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1000 + Math.random() * 1200;
    f.Q.value = 1.2 + Math.random() * 1.0;

    const g = ctx.createGain();
    const vol = 0.03 + Math.random() * 0.025;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5 + Math.random() * 0.4);

    src.connect(f).connect(g).connect(this.sfx);
    src.start(t0);
    src.stop(t0 + 1.0);
  }

  hallucinationWhisperFar() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + Math.random() * 0.3;

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(1.2);

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 800 + Math.random() * 600;

    const g = ctx.createGain();
    const vol = 0.015 + Math.random() * 0.015;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8 + Math.random() * 0.6);

    src.connect(f).connect(g).connect(this.sfx);
    src.start(t0);
    src.stop(t0 + 1.5);
  }

  startTinnitus() {
    if (!this.ctx || this._tinnitusActive) return;
    this._tinnitusActive = true;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 4000 + Math.random() * 3000;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 3 + Math.random() * 2;

    const lfoG = ctx.createGain();
    lfoG.gain.value = 500;

    lfo.connect(lfoG).connect(o.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.000001, t0);
    g.gain.linearRampToValueAtTime(0.012, t0 + 0.5);

    o.connect(g).connect(this.sfx);
    o.start();
    lfo.start();

    this._tinnitusNodes = [o, lfo, lfoG, g];
  }

  stopTinnitus() {
    if (!this._tinnitusActive) return;
    this._tinnitusActive = false;
    if (this._tinnitusNodes) {
      const ctx = this.ctx;
      const t1 = ctx.currentTime + 0.3;
      for (const node of this._tinnitusNodes) {
        if (node.stop) { try { node.stop(t1); } catch {} }
      }
      this._tinnitusNodes = null;
    }
  }

  stopHallucinations() {
    this.stopTinnitus();
  }
}
