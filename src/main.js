// NomaeROOMS — entry point and game orchestration.
// Boot → menu → (host|join) → play loop. See module headers for subsystem docs.

import * as THREE from 'three';
import { UI } from './ui/ui.js';
import { Graphics } from './render/graphics.js';
import { buildMaterials } from './world/textures.js';
import { ChunkManager } from './world/chunks.js';
import { LightPool } from './world/lights.js';
import * as gen from './world/generator.js';
import { Input, IS_TOUCH } from './core/input.js';
import { PlayerController } from './player/controller.js';
import { AudioEngine } from './audio/audio.js';
import { Clark } from './entities/clark.js';
import { Net } from './net/net.js';
import { RemotePlayers } from './net/remotes.js';
import { loadSettings, settings } from './core/settings.js';
import { makeRoomCode, normalizeRoomCode, clamp, damp } from './core/utils.js';
import { QUALITY, STAMINA_MAX, NET_SEND_HZ, CLARK_NET_HZ, CELL } from './core/config.js';

loadSettings();

const ui = new UI();
const graphics = new Graphics(ui.el.canvas);
const input = new Input();
const audio = new AudioEngine(settings);
const player = new PlayerController(graphics.camera, input, settings);
const materials = buildMaterials();
const chunks = new ChunkManager(graphics.scene, materials);
const lights = new LightPool(graphics.scene);
lights.chunkManager = chunks;
const remotes = new RemotePlayers(graphics.scene);
const clark = new Clark(graphics.scene);
const net = new Net();

let state = 'loading';      // loading | menu | playing | paused | dead | scare
let fear = 0;
let sendAcc = 0, clarkAcc = 0;
let myColor = '#7da2ff';

// ---------- boot ----------

const TIPS = [
  'waking the fluorescents…',
  'unrolling the damp carpet…',
  'hanging the wallpaper…',
  'he can hear you…',
];
ui.showLoading(0.02, TIPS[0]);

clark.load((ev) => {
  if (ev?.total) ui.showLoading(0.05 + 0.9 * (ev.loaded / ev.total), TIPS[(ev.loaded / ev.total * 3.5) | 0]);
}).catch((e) => {
  console.warn('[clark] model failed to load:', e);
  ui.toast('warning: the entity failed to load');
}).finally(() => {
  ui.showLoading(1, 'ready.');
  setTimeout(() => { state = 'menu'; ui.showMenu(); }, 350);
});

// audio + menu music need a user gesture
ui.onAnyClick = () => {
  audio.init();
  if (state === 'menu') audio.playMenuMusic();
};

// ---------- menu actions ----------

ui.onHost = async () => {
  ui.setBusy(true);
  const code = makeRoomCode();
  const seed = (Math.random() * 0x7fffffff) | 0;
  try {
    await net.host(code, myProfile(), seed);
    startGame(seed, code);
  } catch (e) {
    ui.showMenu(e.message);
  }
};

ui.onJoin = async (rawCode) => {
  const code = normalizeRoomCode(rawCode);
  if (code.length !== 6) { ui.showMenu('Enter the 6-character room code.'); return; }
  ui.setBusy(true);
  try {
    const wel = await net.join(code, myProfile());
    startGame(wel.seed, code);
    for (const [id, info] of net.peersInfo) {
      remotes.add(id, info);
    }
    ui.setPlayers(net.playerCount());
  } catch (e) {
    net.destroy();
    ui.showMenu(e.message);
  }
};

function myProfile() {
  myColor = `hsl(${(Math.random() * 360) | 0}, 65%, 62%)`;
  return { name: ui.playerName(), color: myColor };
}

// ---------- game lifecycle ----------

function startGame(seed, code) {
  gen.setSeed(seed);
  const q = graphics.applyQuality(settings.quality, settings.fov);
  chunks.setRadius(q.chunkRadius);
  lights.configure(q);

  // spawn near the origin in an open cell, nudged so players don't stack
  const cell = gen.findOpenCell(0, 0);
  const c = gen.cellCenter(cell.x, cell.z);
  player.teleport(
    c.x + (Math.random() - 0.5) * 1.5,
    c.z + (Math.random() - 0.5) * 1.5
  );
  player.stamina = STAMINA_MAX;
  player.frozen = false;

  // build the whole initial radius in one go (loading is already shown)
  chunks.update(player.pos.x, player.pos.z, 999);

  if (net.isHost) {
    clark.relocateAway([{ x: player.pos.x, z: player.pos.z }]);
  }

  audio.enterGame();
  state = 'playing';
  ui.showGame(code);
  ui.setPlayers(net.playerCount());
  ui.addChat(null, net.isHost
    ? `room ${code} is open — share the code`
    : 'you noclipped in. find the others.', { system: true });
  if (!IS_TOUCH) ui.setHint('click to look around');
  input.requestLock(ui.el.canvas);
}

function leaveToMenu(message = '') {
  net.destroy();
  remotes.clear();
  clark.active = false;
  clark.group.visible = false;
  input.releaseLock();
  state = 'menu';
  ui.showMenu(message);
  audio.playMenuMusic();
}

// ---------- net wiring ----------

net.onPeerJoin = (id, info) => {
  remotes.add(id, info);
  ui.setPlayers(net.playerCount());
  ui.addChat(null, `${info.name} noclipped in`, { system: true });
  audio.chatPing();
};
net.onPeerLeave = (id) => {
  const name = remotes.map.get(id)?.info.name || 'someone';
  remotes.remove(id);
  ui.setPlayers(net.playerCount());
  ui.addChat(null, `${name} is gone`, { system: true });
};
net.onState = (id, msg) => remotes.applyState(id, msg);
net.onChat = (id, text) => {
  const name = net.peersInfo.get(id)?.name || remotes.map.get(id)?.info.name || '???';
  remotes.say(id, text);
  const dist = remotes.distanceTo(id, graphics.camera.position);
  const proximity = clamp(1.2 - dist / 30, 0.05, 1);
  ui.addChat(name, text, { proximity });
  audio.chatPing();
};
net.onClark = (msg) => clark.applyNet(msg, 1 / CLARK_NET_HZ);
net.onScareRequest = () => hostRelocateClark();   // a guest got caught
net.onScared = (id) => {
  const name = net.peersInfo.get(id)?.name || 'someone';
  ui.addChat(null, `${name} was taken`, { system: true });
};
net.onClosed = (reason) => leaveToMenu(reason);

function hostRelocateClark(scaredGuestId = null) {
  if (!net.isHost) return;
  const ps = [{ x: player.pos.x, z: player.pos.z }, ...remotes.positions()];
  clark.relocateAway(ps);
  net.sendClark(clark.netState());
  if (scaredGuestId !== null) net.sendScared(scaredGuestId);
}

// ---------- chat / pause / death ----------

ui.onChatSend = (text) => {
  net.sendChat(text);
  ui.addChat(ui.playerName(), text, { proximity: 1 });
};
ui.onResume = () => {
  state = 'playing';
  ui.hideOverlays();
  input.requestLock(ui.el.canvas);
};
ui.onLeave = () => leaveToMenu();
ui.onRespawn = () => {
  // wake up far from where he got you
  const a = Math.random() * Math.PI * 2;
  const cx = Math.floor((player.pos.x + Math.cos(a) * 36) / CELL);
  const cz = Math.floor((player.pos.z + Math.sin(a) * 36) / CELL);
  const cell = gen.findOpenCell(cx, cz);
  const c = gen.cellCenter(cell.x, cell.z);
  player.teleport(c.x, c.z);
  player.frozen = false;
  chunks.update(player.pos.x, player.pos.z, 999);
  fear = 0;
  state = 'playing';
  ui.hideOverlays();
  input.requestLock(ui.el.canvas);
};
ui.onSettingsChanged = () => {
  audio.applyVolumes();
  if (state !== 'menu' && state !== 'loading') {
    const q = graphics.applyQuality(settings.quality, settings.fov);
    chunks.setRadius(q.chunkRadius);
    lights.configure(q);
  }
};

input.onLockChange = (locked) => {
  if (!locked && state === 'playing' && !ui.chatOpen) {
    state = 'paused';
    ui.showPause();
  }
  if (locked) ui.setHint('');
};

ui.el.canvas.addEventListener('click', () => {
  if (state === 'playing' && !input.pointerLocked) input.requestLock(ui.el.canvas);
});

document.addEventListener('keydown', (e) => {
  if (state === 'playing' && !ui.chatOpen && (e.code === 'KeyT' || e.code === 'Enter')) {
    e.preventDefault();
    ui.openChat();
  } else if (state === 'paused' && e.code === 'Escape') {
    // browsers debounce pointer-lock re-entry; the button handles resume
  }
});

if (IS_TOUCH) {
  const sprintBtn = ui.el.touchSprint;
  sprintBtn.addEventListener('touchstart', () => input.setSprintTouch(true));
  sprintBtn.addEventListener('touchend', () => input.setSprintTouch(false));
  // pause via room chip long-press is overkill; give touch users the players chip
  ui.el.playersChip.addEventListener('click', () => {
    if (state === 'playing') { state = 'paused'; ui.showPause(); }
  });
}

// ---------- jumpscare ----------

function triggerJumpscare() {
  state = 'scare';
  player.frozen = true;
  fear = 1;
  clark.beginScare(graphics.camera);
  audio.jumpscare();
  ui.scareFlash();
  input.releaseLock();
  if (net.isHost) {
    setTimeout(() => hostRelocateClark(), 1600);
  } else {
    setTimeout(() => net.requestScare(), 1600);
  }
  setTimeout(() => {
    if (state === 'scare') { state = 'dead'; ui.showDeath(); }
  }, 1900);
}

// ---------- main loop ----------

player.onFootstep = (sprint) => audio.footstep(sprint);

const clock = new THREE.Clock();

// debug handle (harmless in production; used by automated checks)
window.__nr = { player, clark, net, chunks, graphics, get state() { return state; } };

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  const inGame = state === 'playing' || state === 'paused' || state === 'dead' || state === 'scare';
  if (!inGame) return;

  input.enabled = state === 'playing' && !ui.chatOpen;
  input.update();

  // world + player
  const colliders = chunks.collidersNear(player.pos.x, player.pos.z);
  player.update(dt, colliders);
  chunks.update(player.pos.x, player.pos.z, 1);
  lights.update(t, player.pos.x, player.pos.z);
  remotes.update(dt, graphics.camera.position);

  // Clark
  if (clark.active) {
    if (net.isHost) {
      const ps = [{ x: player.pos.x, z: player.pos.z }, ...remotes.positions()];
      if (state !== 'scare') clark.hostUpdate(dt, ps);
      clarkAcc += dt;
      if (clarkAcc >= 1 / CLARK_NET_HZ) {
        clarkAcc = 0;
        net.sendClark(clark.netState());
      }
    } else if (state !== 'scare') {
      clark.guestUpdate(dt);
    }
    if (state === 'playing' && clark.isScaring(player.pos.x, player.pos.z)) {
      triggerJumpscare();
    }
  }

  // while being eaten: he advances into the lens, the view is dragged up to
  // his face with a violent tremble
  if (state === 'scare') {
    clark.scareUpdate(dt, graphics.camera);
    const dx = clark.pos.x - player.pos.x, dz = clark.pos.z - player.pos.z;
    const wantYaw = Math.atan2(-dx, -dz);
    let dy = wantYaw - player.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    player.yaw += dy * Math.min(1, dt * 14);
    player.pitch = damp(player.pitch, 0.55, 10, dt) + (Math.random() - 0.5) * 0.05;
    player.yaw += (Math.random() - 0.5) * 0.035;
  }

  // fear: proximity drives the post grade + heartbeat
  const targetFear = state === 'scare' ? 1 : clark.fearFor(player.pos.x, player.pos.z);
  fear = damp(fear, targetFear, 3, dt);
  graphics.setFear(fear);

  // audio: buzz follows the nearest fixture
  const buzz = clamp(1 - lights.nearestDist / 9, 0, 1) * (0.25 + 0.75 * lights.nearestFlicker);
  audio.update(t, buzz, fear);

  // network send
  sendAcc += dt;
  if (sendAcc >= 1 / NET_SEND_HZ && net.peer) {
    sendAcc = 0;
    net.sendState({
      p: [+player.pos.x.toFixed(3), +player.pos.z.toFixed(3)],
      y: +player.y.toFixed(2),
      ry: +player.yaw.toFixed(3),
      pi: +player.pitch.toFixed(2),
      mv: player.moving ? 1 : 0,
      sp: player.sprinting ? 1 : 0,
    });
  }

  // HUD
  ui.setStamina(player.stamina / STAMINA_MAX);

  graphics.render(t);
}
frame();
