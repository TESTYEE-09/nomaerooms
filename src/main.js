// main.js — wires it all together
import * as THREE from 'three';
import { Player, PLAYER_EYE_H } from './player.js';
import { Net } from './net/net.js';
import { ChatSystem, listVoices } from './ui/chat.js';
import {
  startHum, resumeAudio, tryStartMusic, playFootstep, playJumpscare,
  setHumIntensity, stopMusic, setMasterVolume,
} from './audio/audio.js';
import {
  CONFIG, updateStreaming, tickFlicker, updateShadowLight, findSpawnPoint, warmStart,
} from './world/world.js';
import { PirateClark, JUMPSCARE_DIST } from './entities/pirate-clark.js';
import { setupPostFX } from './render/postfx.js';

// ---- Boot sequence --------------------------------------------------------

const $ = (id) => document.getElementById(id);
const bootMsg = $('boot-msg');
const bootFill = $('boot-fill');
const bootScreen = $('boot');
const menuScreen = $('menu');
const hudScreen = $('hud');
const mobileScreen = $('mobile');
const mount = $('canvas-mount');

let progress = 0;
function bootStep(msg, pct) {
  bootMsg.textContent = msg;
  bootFill.style.width = `${pct}%`;
}

// mobile fallback
if (window.innerWidth < 720 || /Mobi|Android/i.test(navigator.userAgent)) {
  bootScreen.classList.add('hidden');
  mobileScreen.classList.remove('hidden');
}

const steps = [
  ['starting generator…', 12],
  ['rendering poolrooms…', 28],
  ['awakening Pirate Clark…', 44],
  ['attuning radios…', 62],
  ['connecting to broker…', 78],
  ['warming the lights…', 90],
  ['noloop achieved', 100],
];

(async function boot() {
  for (let i = 0; i < steps.length; i++) {
    bootStep(steps[i][0], steps[i][1]);
    await new Promise((r) => setTimeout(r, 350));
  }
  await new Promise((r) => setTimeout(r, 600));
  bootScreen.classList.add('hidden');
  menuScreen.classList.remove('hidden');
})();

// ---- Three.js setup --------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14100a);   // deep murk; lights carve the space
scene.fog = new THREE.FogExp2(0x191307, 0.03);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 200);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
mount.appendChild(renderer.domElement);
const dom = renderer.domElement;

// Post-processing composer (bloom + tone map + dread grade)
const fx = setupPostFX(renderer, scene, camera);

window.addEventListener('error', (e) => {
  console.error('[uncaught]', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled rejection]', e.reason);
});

// Very low fill so unlit corridors read as genuinely dark — the per-room point
// lights (see world.js) do the real work and carve the space out of the murk.
const hemi = new THREE.HemisphereLight(0xffe9b0, 0x1a140a, 0.18);
scene.add(hemi);
const amb = new THREE.AmbientLight(0xffe5b0, 0.06);
scene.add(amb);

// Warm the world
warmStart(scene);

// ---- Player ----------------------------------------------------------------

const player = new Player(camera, dom);
player.teleport(findSpawnPoint());
scene.add(camera);

// ---- Entities --------------------------------------------------------------

const clark = new PirateClark(scene);

// ---- UI wiring -------------------------------------------------------------

const ui = {
  logEl: $('chat-log'),
  listEl: $('chat-messages'),
  inputEl: $('chat-input'),
  wrapEl: $('chat-input-wrap'),
  clipBtn: $('chat-clip'),
  sanityBar: $('bar-sanity'),
  staminaBar: $('bar-stamina'),
  roomCode: $('room-code'),
  playerCount: $('player-count'),
  clarkWarning: $('clark-warning'),
  clarkText: $('clark-text'),
  pause: $('pause'),
};

let chat = null;
let net = null;
let localName = localStorage.getItem('nomaerooms.name') || `nomad${Math.floor(Math.random() * 99)}`;
let localVoiceURI = localStorage.getItem('nomaerooms.voiceURI') || null;
let inGame = false;
let paused = false;
let clarkSpawned = false;
let lastFootstepT = 0;
let jumpscareT = 0;

$('name-input').value = localName;

// populate voice dropdown
function populateVoices() {
  const sel = $('voice-select');
  sel.innerHTML = '';
  const voices = listVoices();
  if (voices.length === 0) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '(no TTS voices available)';
    sel.appendChild(o);
    return;
  }
  for (const v of voices) {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = `${v.name} (${v.lang})${v.default ? ' — default' : ''}`;
    sel.appendChild(o);
  }
  if (localVoiceURI && voices.some((v) => v.voiceURI === localVoiceURI)) {
    sel.value = localVoiceURI;
  } else if (voices.find((v) => v.default)) {
    sel.value = voices.find((v) => v.default).voiceURI;
    localVoiceURI = sel.value;
  }
}
populateVoices();
// some browsers load voices async
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = populateVoices;
}
$('voice-select').addEventListener('change', (e) => {
  localVoiceURI = e.target.value;
  localStorage.setItem('nomaerooms.voiceURI', localVoiceURI || '');
});
$('voice-test').addEventListener('click', () => {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(`Hi, I'm ${localName}. Welcome to the Backrooms.`);
  const v = listVoices().find((vv) => vv.voiceURI === localVoiceURI);
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
});

$('name-input').addEventListener('change', (e) => {
  localName = e.target.value.trim() || localName;
  localStorage.setItem('nomaerooms.name', localName);
});

// ---- Menu buttons ----------------------------------------------------------

$('btn-solo').addEventListener('click', () => startGame('solo'));
$('btn-host').addEventListener('click', () => startGame('host'));
$('btn-join').addEventListener('click', () => {
  $('join-panel').classList.toggle('hidden');
});
$('btn-connect').addEventListener('click', async () => {
  const code = $('room-input').value.trim();
  if (!code) return;
  await startGame('join', code);
});
$('btn-leave').addEventListener('click', leaveGame);
$('btn-credits').addEventListener('click', () => {
  $('credits').classList.remove('hidden');
});

// ---- Game flow -------------------------------------------------------------

async function startGame(mode, roomCode = null) {
  resumeAudio();
  startHum();
  tryStartMusic();

  // init net
  net = new Net({
    onStatus: (s) => ui.clarkText && (ui.clarkText.textContent = s),
    onChat: (msg) => chat?.receive(msg, false),
    onPeerJoin: (peerId, name) => {
      chat?.system(`${name || 'someone'} joined the room`);
      if (net.role === 'host') {
        // send full clip list to the new peer
        net._sendTo(peerId, { type: 'sync-clips', clips: chat?.clips || [] });
      }
    },
    onPeerLeave: (peerId) => {
      chat?.system(`someone left the room`);
    },
    onPosition: (peerId, pos, name) => {
      net.remotePlayers.set(peerId, { name, pos, lastSeen: performance.now() });
    },
    onClipSaved: (clip) => {
      chat?.clips.push(clip);
      chat?._toast(`shared clip: ${clip.name}`);
    },
    onSyncClips: (clips) => {
      if (clips && Array.isArray(clips)) {
        for (const c of clips) {
          if (!chat.clips.find((x) => x.id === c.id)) chat.clips.push(c);
        }
        chat._toast(`synced ${clips.length} clips`);
      }
    },
  });

  chat = new ChatSystem({
    ui,
    net,
    localName,
    localVoiceURI,
  });

  try {
    if (mode === 'host') {
      const code = await net.host();
      ui.roomCode.textContent = code;
      chat.system(`hosting room ${code}`);
    } else if (mode === 'join') {
      await net.join(roomCode);
      ui.roomCode.textContent = roomCode.toUpperCase();
      chat.system(`joined room ${roomCode.toUpperCase()}`);
      net._sendTo(net.connections.keys().next().value, { type: 'request-clips' });
    } else {
      net.role = 'solo';
      net.peerId = 'local';
      ui.roomCode.textContent = 'SOLO';
    }
  } catch (e) {
    console.error('[net] start failed', e);
    alert(`Multiplayer failed to start: ${e.message}\n\nFalling back to solo.`);
    net.role = 'solo';
    net.peerId = 'local';
    ui.roomCode.textContent = 'SOLO';
  }

  menuScreen.classList.add('hidden');
  hudScreen.classList.remove('hidden');
  ui.logEl.classList.remove('hidden');
  ui.roomCode.parentElement.parentElement.classList.remove('hidden');
  inGame = true;
  paused = false;

  player.teleport(findSpawnPoint());
  // Defer pointer-lock until the next real user gesture (browser autoplay policy).
  // The first click anywhere will lock; the menu button click we just did counts
  // for SOME browsers but not headless ones.
  const tryLock = () => {
    try { dom.requestPointerLock(); } catch {}
    document.removeEventListener('click', tryLock);
  };
  document.addEventListener('click', tryLock, { once: true });
}

function leaveGame() {
  inGame = false;
  if (net) { net.leave(); net = null; }
  if (clarkSpawned) { clark.despawn(); clarkSpawned = false; }
  stopMusic();
  player.releaseLock();
  hudScreen.classList.add('hidden');
  ui.pause.classList.add('hidden');
  menuScreen.classList.remove('hidden');
}

// ---- Pause / pointer lock --------------------------------------------------

document.addEventListener('pointerlockchange', () => {
  if (!inGame) return;
  const locked = document.pointerLockElement === dom;
  if (!locked && !paused) {
    paused = true;
    ui.pause.classList.remove('hidden');
  } else if (locked && paused) {
    paused = false;
    ui.pause.classList.add('hidden');
  }
});
document.addEventListener('keydown', (e) => {
  if (!inGame) return;
  if (e.code === 'Escape' && paused) {
    dom.requestPointerLock();
  }
  if (e.code === 'KeyC') {
    // toggle credits (works whether paused or playing)
    const cred = document.getElementById('credits');
    if (cred) cred.classList.toggle('hidden');
    e.preventDefault();
  }
});

// ---- Resize ----------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  fx.resize(window.innerWidth, window.innerHeight);
});

// ---- Spawn Clark after a delay --------------------------------------------

setTimeout(() => {
  if (inGame && !clarkSpawned) {
    clark.spawn(player.pos);
    clarkSpawned = true;
    chat?.system('You are not alone.');
  }
}, 8000);

// ---- Main loop -------------------------------------------------------------

let last = performance.now();
let lastPosSent = 0;

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (inGame && !paused) {
    // update world streaming
    updateStreaming(scene, player.pos);
    tickFlicker(now);
    updateShadowLight(player.pos);

    // footstep audio
    const wish = (player._keys.has('KeyW') || player._keys.has('KeyS') ||
                  player._keys.has('KeyA') || player._keys.has('KeyD') ||
                  player._keys.has('ArrowUp'));
    if (wish && player.onGround) {
      lastFootstepT += dt;
      const interval = player._keys.has('ShiftLeft') ? 0.32 : 0.42;
      if (lastFootstepT > interval) { playFootstep(); lastFootstepT = 0; }
    } else {
      lastFootstepT = 0;
    }

    // update player
    const clarkInfo = clarkSpawned ? clark.update(dt, player.pos) : null;
    const clarkDist = clarkInfo ? clarkInfo.dist : Infinity;
    const inLight = (clarkDist < JUMPSCARE_DIST + 5) || isLitArea(player.pos);
    player.update(dt, { clarkDist, inLight });

    // update HUD bars
    ui.sanityBar.style.width = `${player.sanity}%`;
    ui.staminaBar.style.width = `${player.stamina}%`;
    if (player.sanity < 35) ui.sanityBar.style.background = 'var(--clark-red)';
    else ui.sanityBar.style.background = 'var(--sanity)';
    if (player.stamina < 25) ui.staminaBar.style.background = 'var(--clark-red)';

    // Clark proximity warning
    if (clarkSpawned && clarkDist < 25) {
      ui.clarkWarning.classList.remove('hidden');
      if (clarkDist < JUMPSCARE_DIST + 1) {
        ui.clarkText.textContent = 'HE IS RIGHT BEHIND YOU';
      } else if (clarkDist < 8) {
        ui.clarkText.textContent = 'something is close';
      } else {
        ui.clarkText.textContent = '...footsteps...';
      }
    } else {
      ui.clarkWarning.classList.add('hidden');
    }

    // Jumpscare
    if (clarkInfo && clarkInfo.jumpscare) {
      if (now - jumpscareT > 5000) {
        jumpscareT = now;
        triggerJumpscare();
      }
    }

    // send pos to peers (host: 20Hz, client: 10Hz to host only)
    if (net && net.role !== 'solo' && net.connections.size > 0) {
      if (now - lastPosSent > 50) {
        lastPosSent = now;
        const pos = { x: player.pos.x, y: player.pos.y, z: player.pos.z,
                      yaw: player.yaw, pitch: player.pitch };
        if (net.role === 'host') {
          net.broadcast({ type: 'pos', peerId: net.peerId, pos, name: localName });
        } else {
          // client → host
          for (const c of net.connections.values()) {
            if (c.open) c.send({ type: 'pos', pos, name: localName });
          }
        }
      }
    }
  }

  fx.update(dt);
  fx.composer.render();
  requestAnimationFrame(loop);
}

function triggerJumpscare() {
  // visual: red flash
  document.body.style.transition = 'none';
  document.body.style.boxShadow = 'inset 0 0 200px 100px rgba(193, 39, 45, 0.95)';
  setTimeout(() => {
    document.body.style.transition = 'box-shadow 0.4s';
    document.body.style.boxShadow = 'none';
  }, 100);
  playJumpscare();
  chat?.system('⚠ JUMPSCARE');
}

function isLitArea(pos) {
  // quick check: if any room in colliders has its center within ~5 units of the
  // player, the room's point light (if on) is hitting us. We'll just say "in a
  // room" = "lit" — the room generation has point lights on by default.
  // For darkness, we test distance to nearest room edge.
  return true; // TODO refine: darkness = no nearby room in radius
}

requestAnimationFrame(loop);

// ---- Dev console hook (only used for testing) ------------------------------
// Exposed on window.nomae for headless-browser smoke tests.
window.nomae = {
  scene, camera, renderer, player, clark, net, chat, dom,
  teleportNearClark: (dist = 8) => {
    if (!clark.alive) clark.spawn(player.pos);
    const dir = new THREE.Vector3().subVectors(player.pos, clark.group.position).setY(0).normalize();
    player.pos.copy(clark.group.position).addScaledVector(dir, dist);
    player.pos.y = 1.6;
    player.vel.set(0, 0, 0);
    // face clark
    const dx = clark.group.position.x - player.pos.x;
    const dz = clark.group.position.z - player.pos.z;
    player.yaw = Math.atan2(-dx, -dz);
    player.pitch = 0;
  },
  spawnClarkNear: (dist = 6) => {
    if (!clark.alive) clark.spawn(player.pos);
    const a = Math.random() * Math.PI * 2;
    clark.group.position.set(
      player.pos.x + Math.cos(a) * dist,
      0,
      player.pos.z + Math.sin(a) * dist
    );
    clark.alive = true;
    clark.group.visible = true;
    if (clark._gltfMesh) clark._gltfMesh.visible = true;
  },
};

// ---- Cleanup on unload -----------------------------------------------------
window.addEventListener('beforeunload', () => {
  if (net) net.leave();
  player.dispose();
  renderer.dispose();
});
