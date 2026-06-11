import { settings } from '../core/settings.js';

const PROXIMITY_DIST = 20;
const SPEAK_COOLDOWN = 8000;
const AMBIENT_INTERVAL = 12000;

const FALLBACK_LINES = [
  'I see you...',
  'Fresh meat.',
  'Grrrr...',
  'So hungry...',
  'Found you.',
  '...running...',
  'SSssss...',
  'Closer...',
];

function rand(min, max) { return min + Math.random() * (max - min); }

function linspace(start, end, steps) {
  const arr = [];
  const step = (end - start) / (steps - 1);
  for (let i = 0; i < steps; i++) arr.push(start + step * i);
  return arr;
}

export class ClarkAI {
  constructor() {
    this.audioCtx = null;
    this.gainNode = null;
    this.masterGain = null;
    this.pannerNode = null;
    this.active = false;
    this.lastSpoke = 0;
    this.lastAmbient = 0;
    this._speaking = false;
    this._onSpeech = null;
    this._currentSource = null;
  }

  set onSpeech(fn) { this._onSpeech = fn; }

  async init() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) { console.warn('[clark-ai] WebAudio unavailable'); return; }
    this.audioCtx = new AudioCtor();
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.value = settings.clarkVolume ?? 0.8;
    this.pannerNode = this.audioCtx.createStereoPanner();
    this.masterGain.connect(this.pannerNode);
    this.pannerNode.connect(this.audioCtx.destination);
    this.active = true;
    await this._resume().catch(() => {});
  }

  async _resume() {
    if (this.audioCtx?.state === 'suspended') await this.audioCtx.resume();
  }

  unlockAudio() { return this._resume(); }

  say(text) {
    if (!this.active || !this.audioCtx) return;
    const now = Date.now();
    if (now - this.lastSpoke < SPEAK_COOLDOWN) return;
    if (this._speaking) return;
    this.lastSpoke = now;
    this._speaking = true;
    this._onSpeech?.(text);
    this._playMonsterSound();
  }

  ambient() {
    if (!this.active || !this.audioCtx) return;
    const now = Date.now();
    if (now - this.lastAmbient < AMBIENT_INTERVAL) return;
    if (this._speaking) return;
    this.lastAmbient = now;

    const sounds = ['growl', 'hiss', 'snarl', 'breathe', 'click'];
    const type = sounds[(Math.random() * sounds.length) | 0];
    const lines = {
      growl: 'Grrrr...',
      hiss: 'SSssss...',
      snarl: '...hungry...',
      breathe: '...huff...',
      click: '...tchhh...',
    };
    this._onSpeech?.(lines[type]);
    this._speaking = true;
    this._playMonsterSound(type);
  }

  respondToChat(playerName, message) {
    this.say(FALLBACK_LINES[(Math.random() * FALLBACK_LINES.length) | 0]);
  }

  updateSpatial(clarkX, clarkZ, playerX, playerZ) {
    if (!this.masterGain || !this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') void this._resume();

    const dist = Math.hypot(clarkX - playerX, clarkZ - playerZ);
    const volume = Math.max(0, 1 - dist / PROXIMITY_DIST) * (settings.clarkVolume ?? 0.8);
    this.masterGain.gain.setTargetAtTime(volume * 1.5, this.audioCtx.currentTime, 0.1);

    if (this.pannerNode) {
      const dx = clarkX - playerX;
      const pan = Math.max(-1, Math.min(1, dx / 10));
      this.pannerNode.pan.setTargetAtTime(pan, this.audioCtx.currentTime, 0.1);
    }
  }

  _playMonsterSound(type) {
    if (!this.audioCtx) { this._speaking = false; return; }
    void this._resume();

    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const vol = settings.clarkVolume ?? 0.8;

    switch (type || ['growl', 'hiss', 'snarl', 'breathe', 'click'][(Math.random() * 5) | 0]) {
      case 'hiss': this._genHiss(ctx, now, vol); break;
      case 'snarl': this._genSnarl(ctx, now, vol); break;
      case 'breathe': this._genBreath(ctx, now, vol); break;
      case 'click': this._genClick(ctx, now, vol); break;
      default: this._genGrowl(ctx, now, vol); break;
    }
  }

  _genGrowl(ctx, now, vol) {
    const dur = rand(0.6, 1.4);
    const oscCount = 3;
    const sources = [];
    for (let i = 0; i < oscCount; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();

      osc.type = ['sawtooth', 'square', 'sawtooth'][i];
      osc.frequency.setValueAtTime(i === 0 ? rand(45, 75) : i === 1 ? rand(80, 140) : rand(30, 50), now);
      osc.frequency.exponentialRampToValueAtTime(i === 0 ? rand(25, 45) : i === 1 ? rand(50, 90) : rand(15, 30), now + dur);

      filter.type = 'lowpass';
      filter.frequency.value = rand(120, 350);
      filter.Q.value = rand(1, 4);

      lfo.type = 'sine';
      lfo.frequency.value = rand(4, 12);
      lfoGain.gain.value = rand(15, 40);
      lfo.connect(lfoGain).connect(osc.frequency);

      const g = rand(0.12, 0.28) * vol / oscCount;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(g, now + rand(0.05, 0.15));
      if (Math.random() > 0.5) {
        const mid = now + rand(0.2, 0.6);
        gain.gain.setValueAtTime(g, mid);
        gain.gain.exponentialRampToValueAtTime(g * rand(0.6, 0.9), mid + rand(0.1, 0.3));
      }
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(filter).connect(gain).connect(this.masterGain || ctx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.05);
      lfo.start(now);
      lfo.stop(now + dur + 0.05);
      sources.push(osc);
    }

    if (Math.random() > 0.4) {
      const noise = ctx.createBufferSource();
      const bufSize = ctx.sampleRate * dur;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.max(0, 1 - i / bufSize * 2);
      }
      noise.buffer = buf;
      const nGain = ctx.createGain();
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.value = rand(60, 180);
      nFilter.Q.value = rand(0.5, 2);
      nGain.gain.setValueAtTime(0.001, now);
      nGain.gain.exponentialRampToValueAtTime(rand(0.08, 0.18) * vol, now + rand(0.05, 0.2));
      nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      noise.connect(nFilter).connect(nGain).connect(this.masterGain || ctx.destination);
      noise.start(now);
      sources.push(noise);
    }

    const endT = now + dur + 0.1;
    sources[sources.length - 1].onended = () => { this._speaking = false; };
  }

  _genHiss(ctx, now, vol) {
    const dur = rand(0.5, 1.2);
    const bufSize = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (0.3 + 0.7 * (1 - i / bufSize));
    }
    const source = ctx.createBufferSource();
    source.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = rand(2000, 4000);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(rand(0.08, 0.18) * vol, now + rand(0.05, 0.1));
    const mid = now + dur * rand(0.3, 0.6);
    gain.gain.setValueAtTime(rand(0.06, 0.14) * vol, mid);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = rand(3, 8);
    lfoGain.gain.value = rand(500, 1500);
    lfo.connect(lfoGain).connect(filter.frequency);

    source.connect(filter).connect(gain).connect(this.masterGain || ctx.destination);
    source.start(now);
    lfo.start(now);
    lfo.stop(now + dur + 0.05);
    source.onended = () => { this._speaking = false; };
  }

  _genSnarl(ctx, now, vol) {
    const dur = rand(0.4, 0.9);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'square';
    osc.frequency.setValueAtTime(rand(100, 200), now);
    osc.frequency.exponentialRampToValueAtTime(rand(40, 80), now + dur);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(rand(400, 800), now);
    filter.frequency.exponentialRampToValueAtTime(rand(150, 300), now + dur);
    filter.Q.value = rand(2, 6);

    const g = rand(0.15, 0.3) * vol;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(g, now + rand(0.02, 0.08));
    gain.gain.setValueAtTime(g * 0.4, now + dur * 0.3);
    gain.gain.exponentialRampToValueAtTime(g, now + dur * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sawtooth';
    lfo.frequency.value = rand(15, 30);
    lfoGain.gain.value = rand(30, 80);
    lfo.connect(lfoGain).connect(osc.frequency);

    osc.connect(filter).connect(gain).connect(this.masterGain || ctx.destination);
    osc.start(now);
    lfo.start(now);
    lfo.stop(now + dur + 0.05);
    osc.onended = () => { this._speaking = false; };
  }

  _genBreath(ctx, now, vol) {
    const dur = rand(1.0, 2.0);
    const bufSize = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      const t = i / ctx.sampleRate;
      const envelope = Math.sin(Math.PI * t / dur) * 0.5 + 0.5;
      data[i] = (Math.random() * 2 - 1) * envelope * envelope;
    }

    const source = ctx.createBufferSource();
    source.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = rand(80, 200);
    filter.Q.value = rand(1, 3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(rand(0.06, 0.14) * vol, now + rand(0.1, 0.3));
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = rand(0.5, 2);
    lfoGain.gain.value = rand(20, 50);
    lfo.connect(lfoGain).connect(filter.frequency);

    source.connect(filter).connect(gain).connect(this.masterGain || ctx.destination);
    source.start(now);
    lfo.start(now);
    lfo.stop(now + dur + 0.05);
    source.onended = () => { this._speaking = false; };
  }

  _genClick(ctx, now, vol) {
    const count = 3 + (Math.random() * 5) | 0;
    const gap = rand(0.06, 0.18);
    const dur = count * gap + 0.2;

    for (let i = 0; i < count; i++) {
      const t = now + i * gap;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = rand(800, 3000);
      const g = rand(0.04, 0.1) * vol;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(g, t + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, t + rand(0.02, 0.05));
      osc.connect(gain).connect(this.masterGain || ctx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    }

    setTimeout(() => { this._speaking = false; }, dur * 1000 + 100);
  }

  destroy() {
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} }
    this.audioCtx = null;
    this.active = false;
    this._speaking = false;
    this._currentSource = null;
  }
}
