// audio.js — ambient + music
//
// We don't ship copyrighted music. Instead we:
//  1. Procedurally synthesize the "Backrooms hum" (fluorescent buzz + low drone)
//     using Web Audio. Always present, never blocks.
//  2. Optionally play tracks from /assets/music/*.ogg|.mp3|.wav if the user
//     drops them in. README explains.
//
// Procedural pieces use a shared AudioContext, lazy-initialized on first user
// gesture (browser autoplay policy).

let ctx = null;
let master = null;
let humOsc = null, humOsc2 = null, humGain = null, humLfo = null;
let droneOsc = null, droneGain = null;
let musicGain = null;
let currentMusic = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.55;
  musicGain.connect(master);
  return ctx;
}

export function resumeAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setMasterVolume(v) {
  if (master) master.gain.value = v;
}

// ---- Procedural Backrooms hum ----
export function startHum() {
  const c = ensure();
  if (!c) return;

  // Two slightly detuned sawtooth oscillators through a lowpass = fluorescent buzz
  humOsc = c.createOscillator();
  humOsc.type = 'sawtooth';
  humOsc.frequency.value = 60;
  humOsc2 = c.createOscillator();
  humOsc2.type = 'sawtooth';
  humOsc2.frequency.value = 60.4; // slow beat

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  lp.Q.value = 0.7;

  humGain = c.createGain();
  humGain.gain.value = 0.0;

  humOsc.connect(lp);
  humOsc2.connect(lp);
  lp.connect(humGain);
  humGain.connect(master);

  humOsc.start();
  humOsc2.start();

  // LFO for slow pulsation
  humLfo = c.createOscillator();
  humLfo.frequency.value = 0.13;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0.04;
  humLfo.connect(lfoGain);
  lfoGain.connect(humGain.gain);
  humLfo.start();

  // Sub-bass drone
  droneOsc = c.createOscillator();
  droneOsc.type = 'sine';
  droneOsc.frequency.value = 45;
  droneGain = c.createGain();
  droneGain.gain.value = 0.0;
  droneOsc.connect(droneGain);
  droneGain.connect(master);
  droneOsc.start();

  // Fade in
  const now = c.currentTime;
  humGain.gain.linearRampToValueAtTime(0.06, now + 4);
  droneGain.gain.linearRampToValueAtTime(0.05, now + 6);
}

export function setHumIntensity(v) {
  if (humGain) humGain.gain.value = 0.06 * v;
  if (droneGain) droneGain.gain.value = 0.05 * v;
}

// ---- Music slot ----
// Try a list of filenames; the first one that loads with 200 OK plays.
// If none are present, the procedural hum is the only sound and the game
// still feels complete.
//
// theme.ogg is the default and ships in the bundle (Kane Parsons-vibe track
// from Handprint Media, YouTube-dashed audio, normalized to 90s for a clean
// loop). mp3 and wav are fallbacks for browsers that don't support opus-in-ogg.

const MUSIC_CANDIDATES = [
  './assets/music/theme.ogg',
  './assets/music/theme.mp3',
  './assets/music/theme.wav',
];

export async function tryStartMusic() {
  const c = ensure();
  if (!c) return;

  for (const url of MUSIC_CANDIDATES) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok) {
        const audio = new Audio(url);
        audio.loop = true;
        audio.volume = 0.5;
        await audio.play();
        currentMusic = audio;
        return true;
      }
    } catch {}
  }
  return false;
}

export function stopMusic() {
  if (currentMusic) {
    currentMusic.pause();
    currentMusic = null;
  }
}

// ---- Footsteps (procedural) ----
let lastFootstep = 0;
export function playFootstep() {
  const c = ensure();
  if (!c) return;
  const now = c.currentTime;
  if (now - lastFootstep < 0.32) return;
  lastFootstep = now;
  const noise = c.createBufferSource();
  const buf = c.createBuffer(1, 1024, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / 200);
  noise.buffer = buf;
  const g = c.createGain();
  g.gain.value = 0.08;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  noise.connect(lp); lp.connect(g); g.connect(master);
  noise.start();
}

// ---- Jumpscare sting ----
export function playJumpscare() {
  const c = ensure();
  if (!c) return;
  const now = c.currentTime;
  // a quick sweep + chord
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.6);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0, now);
  g.gain.linearRampToValueAtTime(0.4, now + 0.05);
  g.gain.linearRampToValueAtTime(0.0, now + 0.8);
  osc.connect(g); g.connect(master);
  osc.start(now);
  osc.stop(now + 0.85);

  // a stinger chord
  [110, 138, 165].forEach((f) => {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const gg = c.createGain();
    gg.gain.setValueAtTime(0.0, now);
    gg.gain.linearRampToValueAtTime(0.12, now + 0.02);
    gg.gain.linearRampToValueAtTime(0.0, now + 1.2);
    o.connect(gg); gg.connect(master);
    o.start(now);
    o.stop(now + 1.25);
  });
}
