// NomaeROOMS — entry point and game orchestration.
// Boot → menu → (host|join) → play loop. See module headers for subsystem docs.

import * as THREE from 'three';
import { UI } from './ui/ui.js';
import { Graphics } from './render/graphics.js';
import { buildMaterials } from './world/textures.js';
import { ChunkManager } from './world/chunks.js';
import { LightPool } from './world/lights.js';
import { ObjectPlacer } from './world/objects.js';
import * as gen from './world/generator.js';
import { Input, IS_TOUCH } from './core/input.js';
import { PlayerController } from './player/controller.js';
import { AudioEngine } from './audio/audio.js';
import { Clark } from './entities/clark.js';
import { Net } from './net/net.js';
import { RemotePlayers } from './net/remotes.js';
import { ClarkAI } from './ai/clark-ai.js';
import { Hallucinations } from './effects/hallucinations.js';
import { loadSettings, settings } from './core/settings.js';
import { clamp, damp } from './core/utils.js';
import { QUALITY, STAMINA_MAX, NET_SEND_HZ, CLARK_NET_HZ, CELL, HUNTED_SURVIVE_TIME, HUNTED_SWAP_RANGE, HUNTED_SWAP_COOLDOWN, FLASHLIGHT_PICKUP_DIST, WEAPON_STUN_DURATION, WEAPON_RANGE, WEAPON_PICKUP_DIST, WEAPON_USER_COOLDOWN } from './core/config.js';

console.log('[main] module starting');
console.log('[main] Clark imported:', typeof Clark);

loadSettings();

const ui = new UI();
const graphics = new Graphics(ui.el.canvas);
const input = new Input();
const audio = new AudioEngine(settings);
const player = new PlayerController(graphics.camera, input, settings);
player.initFlashlight(graphics.scene);
const materials = buildMaterials();
const chunks = new ChunkManager(graphics.scene, materials);
const objects = new ObjectPlacer(graphics.scene);
chunks.objectPlacer = objects;
const lights = new LightPool(graphics.scene);
lights.chunkManager = chunks;
const remotes = new RemotePlayers(graphics.scene);
const clark = new Clark(graphics.scene);
const clarkAI = new ClarkAI();
const hallucinations = new Hallucinations(audio);
const net = new Net();

let state = 'loading';      // loading | menu | playing | paused | dead | scare
let fear = 0;
let sendAcc = 0, clarkAcc = 0, aiAcc = 0;
let myColor = '#7da2ff';
const deadPeers = new Set();

// weapon state
let hasWeapon = false;
let weaponCooldown = 0;

// hunted mode state (host-authoritative)
let huntedId = null;           // peer id of the hunted player
let huntedTimer = 0;           // countdown seconds remaining
let swapReady = false;         // can the hunted swap right now?
let swapCooldownTimer = 0;     // cooldown before next swap is allowed
let lastSwapTick = 0;          // time of last swap broadcast
let huntedStarted = false;

clarkAI.onSpeech = (text) => {
  if (!settings.clarkAIEnabled) return;
  ui.addChat('Clark', text, { proximity: clark.active ? 1 - Math.min(1, Math.hypot(clark.pos.x - player.pos.x, clark.pos.z - player.pos.z) / 25) : 0, ai: true });
  if (net.isHost) net.sendClarkAI(text);
};

// ---------- boot ----------

const TIPS = [
  'waking the fluorescents…',
  'unrolling the damp carpet…',
  'hanging the wallpaper…',
  'placing the furniture…',
  'he can hear you…',
];
ui.showLoading(0.02, TIPS[0]);

clark.load((ev) => {
  console.log('[main] clark.load callback fired:', ev);
  if (ev?.total) ui.showLoading(0.05 + 0.9 * (ev.loaded / ev.total), TIPS[(ev.loaded / ev.total * 3.5) | 0]);
}).catch((e) => {
  console.warn('[clark] model failed to load:', e);
  ui.toast('warning: the entity failed to load');
}).finally(() => {
  console.log('[main] clark.load finally');
  ui.showLoading(1, 'ready.');
  setTimeout(() => { state = 'menu'; ui.showMenu(); }, 350);
});

// audio + menu music need a user gesture
ui.onAnyClick = () => {
  audio.init();
  void clarkAI.unlockAudio();
  if (state === 'menu') audio.playMenuMusic();
};

// ---------- menu actions ----------

const GLOBAL_ROOM = 'NROOMS';

ui.onPlay = async () => {
  ui.setBusy(true);
  const seed = (Math.random() * 0x7fffffff) | 0;
  try {
    console.log('[main] calling net.play with seed:', seed);
    const wel = await net.play(GLOBAL_ROOM, myProfile(), seed);
    console.log('[main] net.play returned:', wel);
    startGame(wel.seed || seed, GLOBAL_ROOM);
    for (const [id, info] of net.peersInfo) {
      remotes.add(id, info);
    }
    ui.setPlayers(net.playerCount());
  } catch (e) {
    console.error('[main] net.play failed:', e);
    net.destroy();
    ui.showMenu(net._friendlyErr?.(e) || e?.message || 'Connection failed');
  }
};

function myProfile() {
  myColor = `hsl(${(Math.random() * 360) | 0}, 65%, 62%)`;
  return { name: ui.playerName(), color: myColor };
}

// ---------- game lifecycle ----------

function startGame(seed, code) {
  gen.setSeed(seed);
  objects.setSeed(seed);
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
  player.setFlashlight(false);
  ui.setFlashlight(false);
  hasWeapon = false;
  weaponCooldown = 0;
  ui.setWeapon(false);

  // build the whole initial radius in one go (loading is already shown)
  chunks.update(player.pos.x, player.pos.z, 999);

  if (net.isHost) {
    clark.relocateAway([{ x: player.pos.x, z: player.pos.z }]);
  }

  // start hunted mode on the host
  if (net.isHost) {
    startHuntedMode();
  }

  if (settings.clarkAIEnabled) clarkAI.init();
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
  clarkAI.destroy();
  hallucinations.destroy();
  remotes.clear();
  deadPeers.clear();
  objects.clear();
  clark.active = false;
  clark.group.visible = false;
  player.setFlashlight(false);
  ui.setFlashlight(false);
  hasWeapon = false;
  ui.setWeapon(false);
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
  deadPeers.delete(id);
  ui.setPlayers(net.playerCount());
  ui.addChat(null, `${name} is gone`, { system: true });
};
net.onState = (id, msg) => {
  remotes.applyState(id, msg);
  if (msg.dead) deadPeers.add(id); else deadPeers.delete(id);
};
net.onChat = (id, text) => {
  const name = net.peersInfo.get(id)?.name || remotes.map.get(id)?.info.name || '???';
  remotes.say(id, text);
  const dist = remotes.distanceTo(id, graphics.camera.position);
  const proximity = clamp(1.2 - dist / 30, 0.05, 1);
  ui.addChat(name, text, { proximity });
  audio.chatPing();
  // if Clark is near the chatting player, he responds (host only)
  if (clark.active && settings.clarkAIEnabled) {
    const rp = remotes.map.get(id);
    if (rp) {
      const cd = Math.hypot(clark.pos.x - rp.group.position.x, clark.pos.z - rp.group.position.z);
      if (cd < 20) clarkAI.respondToChat(name, text);
    }
  }
};
net.onClark = (msg) => clark.applyNet(msg, 1 / CLARK_NET_HZ);
net.onScareRequest = (from) => hostRelocateClark(from);   // a guest got caught
net.onScared = (id) => {
  const name = net.peersInfo.get(id)?.name || 'someone';
  ui.addChat(null, `${name} was taken`, { system: true });
};
net.onClarkAI = (text) => {
  if (!settings.clarkAIEnabled) return;
  ui.addChat('Clark', text, { proximity: clark.active ? 1 - Math.min(1, Math.hypot(clark.pos.x - player.pos.x, clark.pos.z - player.pos.z) / 25) : 0, ai: true });
};

// hunted mode net callbacks
net.onHuntedState = (state) => {
  huntedId = state.huntedId;
  huntedTimer = state.timer;
  swapReady = state.swapReady;
  swapCooldownTimer = state.swapCooldown;
  const isHunted = huntedId === net.myId;
  ui.setHuntedState({ isHunted, timer: huntedTimer });
};

net.onSwapRequest = (fromId) => {
  // host receives swap request from the hunted guest
  processSwapRequest();
};

net.onSwapResult = (result) => {
  // Host broadcasts swap with {fromX, fromZ, toX, toZ, swapId, allyId}
  if (result.swapId === net.myId) {
    // we are the hunted — go to the ally's old spot (toX/toZ)
    player.teleport(result.toX, result.toZ);
  } else if (result.allyId === net.myId) {
    // we are the ally — go to the hunted's old spot (fromX/fromZ)
    player.teleport(result.fromX, result.fromZ);
  }
  swapCooldownTimer = HUNTED_SWAP_COOLDOWN;
  ui.addChat(null, 'Swap! You traded places.', { system: true });
};

net.onHuntedWin = () => {
  ui.addChat(null, 'The Hunted survived! All escape.', { system: true });
  huntedStarted = false;
  setTimeout(() => {
    if (state === 'playing') huntedStarted = true;
  }, 5000);
};

net.onWeaponStun = (from) => {
  if (!net.isHost) return;
  clark.stun(WEAPON_STUN_DURATION);
  net.sendClark(clark.netState());
  audio.clarkStun();
  const name = net.peersInfo.get(from)?.name || 'someone';
  ui.addChat(null, `${name} shot Clark with a revolver!`, { system: true });
};

net.onClosed = (reason) => leaveToMenu(reason);

function hostRelocateClark(caughtId = null) {
  if (!net.isHost) return;
  const ps = [{ x: player.pos.x, z: player.pos.z }, ...remotes.positions()];
  clark.relocateAway(ps);
  net.sendClark(clark.netState());
  if (caughtId !== null) {
    net.sendScared(caughtId);
    // if the hunted was caught, restart hunted mode
    if (huntedId && caughtId === huntedId) {
      ui.addChat(null, 'The Hunted was taken. A new hunt begins.', { system: true });
      setTimeout(() => { if (net.isHost) startHuntedMode(); }, 3000);
    }
  }
}

// ---- hunted mode (host-authoritative) ----

function startHuntedMode() {
  if (!net.isHost) return;
  huntedStarted = true;
  huntedTimer = HUNTED_SURVIVE_TIME;
  swapCooldownTimer = 0;
  lastSwapTick = 0;

  // pick a random player (including host) as hunted
  const allIds = [net.myId, ...net.conns.keys()].filter((id) => id);
  if (!allIds.length) { huntedId = net.myId; }
  else { huntedId = allIds[(Math.random() * allIds.length) | 0]; }

  net.sendHunted({ huntedId, timer: huntedTimer, swapReady: false, swapCooldown: 0 });
  ui.addChat(null, 'One is the Hunted. Clark hunts the chosen. Protect them.', { system: true });
  const n = net.peersInfo.get(huntedId)?.name || 'they';
  ui.addChat(null, `Clark has chosen ${n}`, { system: true });
}

function broadcastHunted() {
  if (!net.isHost) return;
  swapReady = swapCooldownTimer <= 0;
  net.sendHunted({ huntedId, timer: huntedTimer, swapReady, swapCooldown: swapCooldownTimer });
}

function endHuntedWin() {
  if (!net.isHost) return;
  net.sendHuntedWin();
  ui.addChat(null, 'The Hunted survived! All escape.', { system: true });
  // give a brief celebration, then restart hunted
  setTimeout(() => {
    if (net.isHost && state === 'playing') startHuntedMode();
  }, 5000);
}

/** Host processes a swap — the hunted player swaps with the nearest ally in range */
function processSwapRequest() {
  if (!net.isHost) return;
  if (swapCooldownTimer > 0) return;
  if (state !== 'playing') return;
  if (!huntedId) return;

  // find hunted position
  let huntedPos;
  if (huntedId === net.myId) {
    huntedPos = { x: player.pos.x, z: player.pos.z };
  } else {
    const rp = remotes.map.get(huntedId);
    if (!rp) return;
    huntedPos = { x: rp.group.position.x, z: rp.group.position.z };
  }

  // find nearest alive player to the hunted within range
  let bestId = null, bestDist = Infinity;
  for (const id of [net.myId, ...net.conns.keys()]) {
    if (!id || id === huntedId) continue;
    if (deadPeers.has(id)) continue;
    let pos;
    if (id === net.myId) {
      pos = { x: player.pos.x, z: player.pos.z };
    } else {
      const rp = remotes.map.get(id);
      if (!rp) continue;
      pos = { x: rp.group.position.x, z: rp.group.position.z };
    }
    const d = Math.hypot(pos.x - huntedPos.x, pos.z - huntedPos.z);
    if (d < bestDist && d <= HUNTED_SWAP_RANGE) { bestDist = d; bestId = id; }
  }
  if (!bestId) return;

  swapCooldownTimer = HUNTED_SWAP_COOLDOWN;

  // get positions of both players
  let allyPos;
  if (bestId === net.myId) {
    allyPos = { x: player.pos.x, z: player.pos.z };
  } else {
    const rp = remotes.map.get(bestId);
    if (!rp) return;
    allyPos = { x: rp.group.position.x, z: rp.group.position.z };
  }

  // hunted stays hunted, swap positions
  if (huntedId === net.myId) {
    player.teleport(allyPos.x, allyPos.z);
  }
  if (bestId === net.myId) {
    player.teleport(huntedPos.x, huntedPos.z);
  }
  // broadcast swap for guests
  net.sendSwapResult({ fromX: huntedPos.x, fromZ: huntedPos.z, toX: allyPos.x, toZ: allyPos.z, swapId: huntedId, allyId: bestId });

  const allyName = net.peersInfo.get(bestId)?.name || 'they';
  ui.addChat(null, `Swap! The Hunted traded places with ${allyName}.`, { system: true });

  // after swap, Clark gets pushed away slightly
  const awayAngle = Math.atan2(clark.pos.z - allyPos.z, clark.pos.x - allyPos.x);
  clark.teleport(
    clark.pos.x + Math.cos(awayAngle) * 8,
    clark.pos.z + Math.sin(awayAngle) * 8
  );
  net.sendClark(clark.netState());

  broadcastHunted();
}

// ---------- chat / pause / death ----------

ui.onChatSend = (text) => {
  net.sendChat(text);
  ui.addChat(ui.playerName(), text, { proximity: 1 });
  // if Clark is nearby, he responds
  if (clark.active && settings.clarkAIEnabled) {
    const dist = Math.hypot(clark.pos.x - player.pos.x, clark.pos.z - player.pos.z);
    if (dist < 20) clarkAI.respondToChat(ui.playerName(), text);
  }
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
  player.setFlashlight(false);
  ui.setFlashlight(false);
  hasWeapon = false;
  weaponCooldown = 0;
  ui.setWeapon(false);
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
  // gun pickup: press E near a gun on the ground
  if (state === 'playing' && !ui.chatOpen && e.code === 'KeyE' && !hasWeapon) {
    for (let i = 0; i < objects.guns.length; i++) {
      const g = objects.guns[i];
      if (g.collected) continue;
      const d = Math.hypot(g.x - player.pos.x, g.z - player.pos.z);
      if (d < WEAPON_PICKUP_DIST) {
        objects.removeGun(i);
        hasWeapon = true;
        audio.click();
        ui.toast('found a revolver');
        ui.setWeapon(true);
        break;
      }
    }
  }

  // weapon use: press Q to shoot Clark — stuns him
  if (state === 'playing' && !ui.chatOpen && e.code === 'KeyQ' && hasWeapon && weaponCooldown <= 0) {
    if (clark.active) {
      const d = Math.hypot(clark.pos.x - player.pos.x, clark.pos.z - player.pos.z);
      if (d < WEAPON_RANGE && gen.lineOfSight(player.pos.x, player.pos.z, clark.pos.x, clark.pos.z)) {
        e.preventDefault();
        hasWeapon = false;
        weaponCooldown = WEAPON_USER_COOLDOWN;
        ui.setWeapon(false);
        audio.weaponUse();
        if (net.isHost) {
          clark.stun(WEAPON_STUN_DURATION);
          net.sendClark(clark.netState());
        } else {
          net.sendWeaponStun();
        }
        audio.clarkStun();
        ui.addChat(null, 'You shot Clark with the revolver!', { system: true });
      }
    }
  }

  // flashlight pickup: press E near a flashlight on the ground
  if (state === 'playing' && !ui.chatOpen && e.code === 'KeyE' && !player.hasFlashlight) {
    for (let i = 0; i < objects.flashlights.length; i++) {
      const fl = objects.flashlights[i];
      if (fl.collected) continue;
      const d = Math.hypot(fl.x - player.pos.x, fl.z - player.pos.z);
      if (d < FLASHLIGHT_PICKUP_DIST) {
        objects.removeFlashlight(i);
        player.setFlashlight(true);
        audio.flashlightOn();
        ui.toast('found a flashlight');
        ui.setFlashlight(true);
        break;
      }
    }
  }
  // hunted swap: the hunted player presses F to swap with nearest ally.
  // Always give feedback — a silent F reads as a broken key.
  if (state === 'playing' && !ui.chatOpen && e.code === 'KeyF') {
    e.preventDefault();
    if (huntedId !== net.myId) {
      ui.toast('only the Hunted can swap');
    } else if (!swapReady) {
      ui.toast(`swap recharging (${Math.ceil(swapCooldownTimer)}s)`);
    } else if (net.isHost) {
      processSwapRequest();
    } else {
      net.sendSwapRequest();
    }
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
    setTimeout(() => hostRelocateClark(net.myId), 1600);
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
window.__nr = { player, clark, clarkAI, net, chunks, graphics, get state() { return state; } };

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // adaptive quality: track frame time, scale back when lagging
  this._ft ||= { history: [], scaled: false, timer: 0 };
  const ft = this._ft;
  ft.history.push(dt * 1000);
  if (ft.history.length > 30) {
    ft.history.shift();
    const avg = ft.history.reduce((a, b) => a + b, 0) / ft.history.length;
    if (avg > 45 && !ft.scaled) { ft.scaled = true; graphics.scaleQuality(0); }
    else if (avg < 22 && ft.scaled) { ft.scaled = false; graphics.scaleQuality(1); }
    if (ft.scaled && avg < 22) { ft.timer += dt; if (ft.timer > 5) { ft.scaled = false; graphics.scaleQuality(1); ft.timer = 0; } }
    else if (!ft.scaled && avg > 45) { ft.timer += dt; if (ft.timer > 3) { ft.scaled = true; graphics.scaleQuality(0); ft.timer = 0; } }
    else ft.timer = 0;
  }

  // chunk budget: drain queue faster when many chunks are pending
  const _budget = ft.scaled ? 3 : 1;

  const inGame = state === 'playing' || state === 'paused' || state === 'dead' || state === 'scare';
  if (!inGame) return;

  input.enabled = state === 'playing' && !ui.chatOpen;
  input.update();

  // world + player
  const colliders = chunks.collidersNear(player.pos.x, player.pos.z);
  player.update(dt, colliders);
  chunks.update(player.pos.x, player.pos.z, _budget);

  // almond water: walk into a bottle to drink it
  if (state === 'playing' && chunks.drinkNear(player.pos.x, player.pos.z)) {
    player.stamina = STAMINA_MAX;
    player.boostT = 8;
    ui.addChat(null, 'almond water — stamina restored, your legs feel lighter', { system: true });
    audio.chatPing();
  }
  lights.update(t, player.pos.x, player.pos.z);
  remotes.update(dt, graphics.camera.position);

  // Clark
  if (clark.active) {
    if (net.isHost) {
      const selfAlive = state !== 'dead' && state !== 'scare';
      const allPs = remotes.positions().filter((p) => !deadPeers.has(p.id));
      if (selfAlive) allPs.unshift({ x: player.pos.x, z: player.pos.z });
      let huntedPos = null;
      if (huntedId && huntedId !== net.myId) {
        const rp = remotes.map.get(huntedId);
        if (rp) huntedPos = { x: rp.group.position.x, z: rp.group.position.z };
      } else if (huntedId === net.myId) {
        huntedPos = { x: player.pos.x, z: player.pos.z };
      }
      if (allPs.length && state !== 'scare') clark.hostUpdate(dt, allPs, huntedPos);
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

    // AI voice: update spatial audio + trigger ambient/monster sounds
    if (state === 'playing' && settings.clarkAIEnabled) {
      clarkAI.updateSpatial(clark.pos.x, clark.pos.z, player.pos.x, player.pos.z);
      const dist = Math.hypot(clark.pos.x - player.pos.x, clark.pos.z - player.pos.z);
      if (dist < 20) {
        aiAcc += dt;
        if (aiAcc > 1) { aiAcc = 0; clarkAI.ambient(); }
      }
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

  // hallucinations: audio events driven by fear
  if (state === 'playing') hallucinations.update(dt, fear, t);

  // hunted mode: host ticks the timer, broadcasts state periodically
  if (net.isHost && huntedStarted && huntedId) {
    huntedTimer -= dt;
    if (huntedTimer <= 0) {
      huntedTimer = 0;
      endHuntedWin();
    }
    swapCooldownTimer = Math.max(0, swapCooldownTimer - dt);
    lastSwapTick += dt;
    if (lastSwapTick >= 0.5) {
      lastSwapTick = 0;
      broadcastHunted();
    }
  }
  // update swap hint for the hunted player (shows when near an ally)
  if (huntedId === net.myId && swapReady) {
    let nearAlly = false;
    for (const [id, rp] of remotes.map) {
      if (deadPeers.has(id)) continue;
      const d = Math.hypot(player.pos.x - rp.group.position.x, player.pos.z - rp.group.position.z);
      if (d <= HUNTED_SWAP_RANGE) { nearAlly = true; break; }
    }
    ui.showSwapHint(nearAlly);
  } else {
    ui.showSwapHint(false);
  }

  // weapon cooldown
  if (weaponCooldown > 0) weaponCooldown -= dt;

  // weapon use hint
  if (hasWeapon && state === 'playing') {
    const canStun = clark.active && Math.hypot(clark.pos.x - player.pos.x, clark.pos.z - player.pos.z) < WEAPON_RANGE && gen.lineOfSight(player.pos.x, player.pos.z, clark.pos.x, clark.pos.z);
    ui.showWeaponHint(canStun);
  } else {
    ui.showWeaponHint(false);
  }

  // pickup hints: flashlight uses original pickupHint, gun uses separate
  let nearGun = false, nearFlashlight = false;
  if (!hasWeapon && state === 'playing') {
    for (const g of objects.guns) {
      if (g.collected) continue;
      if (Math.hypot(g.x - player.pos.x, g.z - player.pos.z) < WEAPON_PICKUP_DIST) {
        nearGun = true; break;
      }
    }
  }
  if (!player.hasFlashlight && state === 'playing') {
    for (const fl of objects.flashlights) {
      if (fl.collected) continue;
      if (Math.hypot(fl.x - player.pos.x, fl.z - player.pos.z) < FLASHLIGHT_PICKUP_DIST) {
        nearFlashlight = true; break;
      }
    }
  }
  ui.showGunPickupHint(nearGun);
  ui.showPickupHint(nearFlashlight);

  // sync hunted timer to UI every frame (smooth countdown)
  if (huntedId) {
    ui.setHuntedState({ isHunted: huntedId === net.myId, timer: huntedTimer });
  } else {
    ui.setHuntedState(null);
  }

  // network send
  sendAcc += dt;
  if (sendAcc >= 1 / NET_SEND_HZ && net.ws) {
    sendAcc = 0;
    net.sendState({
      p: [+player.pos.x.toFixed(3), +player.pos.z.toFixed(3)],
      y: +player.y.toFixed(2),
      ry: +player.yaw.toFixed(3),
      pi: +player.pitch.toFixed(2),
      mv: player.moving ? 1 : 0,
      sp: player.sprinting ? 1 : 0,
      dead: (state === 'dead' || state === 'scare') ? 1 : 0,
    });
  }

  // proximity indicator
  const nearby = [];
  for (const [id, rp] of remotes.map) {
    if (deadPeers.has(id)) continue;
    const d = Math.hypot(rp.group.position.x - player.pos.x, rp.group.position.z - player.pos.z);
    if (d < 15) nearby.push({ name: rp.info.name, dist: d });
  }
  ui.setProximity(nearby);

  // HUD
  ui.setStamina(player.stamina / STAMINA_MAX);

  graphics.render(t);
}
frame();
// force rebuild
