// NomaeLETHAL — entry point and game orchestration.
// Boot → menu → (host|join crew) → orbit ⇄ moons ⇄ the Company.
//
// The host owns all shared state (phase, clock, economy, scrap transitions,
// monster sim) and broadcasts it through the relay; guests mirror it and send
// action requests. World layouts are deterministic from the shared seed, so
// only state transitions ever travel the wire.

import * as THREE from 'three';
import { UI } from './ui/ui.js';
import { Graphics } from './render/graphics.js';
import { buildMaterials } from './world/textures.js';
import { Facility } from './world/facility.js';
import { MoonWorld, PAD_Y } from './world/moon.js';
import { Ship } from './world/ship.js';
import { LightPool } from './world/lights.js';
import * as gen from './world/generator.js';
import { Input, IS_TOUCH } from './core/input.js';
import { PlayerController } from './player/controller.js';
import { AudioEngine } from './audio/audio.js';
import { Monsters } from './entities/monsters.js';
import { ScrapManager, ST } from './game/items.js';
import { Terminal } from './game/terminal.js';
import { saveRun, loadRun, clearRun } from './game/save.js';
import { Net } from './net/net.js';
import { RemotePlayers } from './net/remotes.js';
import { loadSettings, settings } from './core/settings.js';
import { clamp, damp, makeRoomCode } from './core/utils.js';
import {
  STAMINA_MAX, NET_SEND_HZ, ENT_NET_HZ, GM_NET_HZ, INTERACT_DIST, INV_SLOTS,
  MOONS, COMPANY_IDX, SELL_RATE, START_MONEY, START_QUOTA, QUOTA_STEP, QUOTA_DAYS,
  FLASHLIGHT_PRICE, DAY_START_H, DAY_END_H, DAY_REAL_SECONDS, HOUND_HOUR,
  TRANSIT_TIME, SHIP_D,
} from './core/config.js';

loadSettings();

const ui = new UI();
const graphics = new Graphics(ui.el.canvas);
const input = new Input();
const audio = new AudioEngine(settings);
const player = new PlayerController(graphics.camera, input, settings);
player.initFlashlight(graphics.scene);
const materials = buildMaterials();
const ship = new Ship(graphics.scene, materials);
const facility = new Facility(graphics.scene, materials);
const moonWorld = new MoonWorld(graphics.scene, materials);
const lights = new LightPool(graphics.scene);
lights.chunkManager = facility;
const monsters = new Monsters(graphics.scene);
const scrap = new ScrapManager(graphics.scene);
const remotes = new RemotePlayers(graphics.scene);
const terminal = new Terminal();
const net = new Net();

let state = 'loading';      // loading | menu | playing | paused | dead
let fear = 0;
let sendAcc = 0, entAcc = 0, gmAcc = 0;
let myColor = '#e8842c';
const lastStates = new Map();   // peerId -> last st msg
let shake = 0;                  // camera shake amount (landing/takeoff)
let alarmTimer = 0;

// ---- shared game state (host-authoritative) ----
const GS = {
  ph: 'orbit',          // orbit | landing | landed | leaving
  routed: null,         // moon index set at the terminal
  moon: null,           // moon index we are at / descending to
  day: 1,
  dl: QUOTA_DAYS,       // days left until deadline
  q: START_QUOTA,
  sold: 0,
  money: START_MONEY,
  clk: DAY_START_H,     // hour of day while landed
  cyc: 1,
};
let phaseT = 0;          // seconds in current transit phase (local)
let worldReady = false;  // moon/facility geometry currently built
let myFlashlight = false; // does the local player own a flashlight
let dead = false;
let deadBy = null;
let allDeadT = 0;

// ---------- boot ----------

const TIPS = [
  'requisitioning assets…',
  'fueling the dropship…',
  'counting the scrap…',
  'waking the things below…',
  'printing your contract…',
];
ui.showLoading(0.02, TIPS[0]);

let loadFrac = { m: 0, s: 0, ship: 0 };
const updateLoad = () => {
  const f = 0.05 + 0.9 * (loadFrac.m * 0.4 + loadFrac.s * 0.4 + loadFrac.ship * 0.2);
  ui.showLoading(f, TIPS[Math.min(TIPS.length - 1, (f * 5) | 0)]);
};
Promise.all([
  monsters.load((f) => { loadFrac.m = f; updateLoad(); }),
  scrap.load((f) => { loadFrac.s = f; updateLoad(); }),
  ship.load().then(() => { loadFrac.ship = 1; updateLoad(); }),
]).catch((e) => {
  console.warn('[boot] asset load problem:', e);
  ui.toast('some assets failed to load — continuing anyway');
}).finally(() => {
  ui.showLoading(1, 'ready.');
  setTimeout(() => { state = 'menu'; ui.showMenu(); }, 350);
});

ui.onAnyClick = () => {
  audio.init();
  if (state === 'menu') audio.playMenuMusic();
};

// ---------- menu ----------

function myProfile() {
  myColor = `hsl(${(Math.random() * 360) | 0}, 70%, 58%)`;
  return { name: ui.playerName(), color: myColor };
}

ui.onHost = async () => {
  ui.setBusy(true);
  const seed = (Math.random() * 0x7fffffff) | 0;
  let code = makeRoomCode();
  if (code === 'NROOMS') code = makeRoomCode();
  try {
    await net.host(code, myProfile(), seed);
    startGame(seed, code);
  } catch (e) {
    net.destroy();
    ui.showMenu(net.friendlyErr(e));
  }
};

ui.onContinue = async () => {
  const saved = loadRun();
  if (!saved) { ui.refreshContinue(); return; }
  ui.setBusy(true);
  const seed = saved.seed | 0;
  let code = makeRoomCode();
  if (code === 'NROOMS') code = makeRoomCode();
  try {
    await net.host(code, myProfile(), seed);
    startGame(seed, code, saved);
  } catch (e) {
    net.destroy();
    ui.showMenu(net.friendlyErr(e));
  }
};

ui.onJoin = async (code) => {
  ui.setBusy(true);
  try {
    const wel = await net.join(code, myProfile());
    startGame(wel.seed, code);
    for (const [id, info] of net.peersInfo) remotes.add(id, info);
    ui.setPlayers(net.playerCount());
  } catch (e) {
    net.destroy();
    ui.showMenu(net.friendlyErr(e));
  }
};

// ---------- game lifecycle ----------

function startGame(seed, code, saved = null) {
  GS.seed = seed | 0;
  Object.assign(GS, {
    ph: 'orbit', routed: null, moon: null, day: 1, dl: QUOTA_DAYS,
    q: START_QUOTA, sold: 0, money: START_MONEY, clk: DAY_START_H, cyc: 1,
  });
  scrap.reset();
  myFlashlight = false;
  // restore a saved run's economy + ship cargo (host only)
  if (saved) {
    Object.assign(GS, {
      day: saved.day, dl: saved.dl, q: saved.q, sold: saved.sold,
      money: saved.money, cyc: saved.cyc,
    });
    scrap.importShip(saved.ship);
    scrap.materializeShip();
    myFlashlight = !!saved.flashlight;
  }
  dead = false;
  worldReady = false;
  const q = graphics.applyQuality(settings.quality, settings.fov);
  lights.configure(q);

  spawnInShip();
  if (myFlashlight) { player.setFlashlight(true); ui.setFlashlight(true); }
  ship.setDoor(false);
  ship.setHullVisible(false);

  audio.enterGame();
  state = 'playing';
  ui.showGame(code);
  ui.setPlayers(net.playerCount());
  ui.addChat(null, net.isHost
    ? `crew ${code} is hiring — share the code`
    : 'you signed the contract. welcome aboard.', { system: true });
  ui.addChat(null, 'use the TERMINAL to pick a moon, then pull the LEVER.', { system: true });
  if (!IS_TOUCH) ui.setHint('click to look around');
  input.requestLock(ui.el.canvas);
}

function spawnInShip() {
  player.teleport((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.5, Math.PI);
  player.stamina = STAMINA_MAX;
  player.frozen = false;
  player.floorY = 0;
}

function leaveToMenu(message = '') {
  net.destroy();
  remotes.clear();
  lastStates.clear();
  monsters.clearAll();
  scrap.reset();
  facility.dispose();
  moonWorld.dispose();
  terminal.hide();
  player.setFlashlight(false);
  ui.setFlashlight(false);
  audio.setRumble(0);
  input.releaseLock();
  state = 'menu';
  dead = false;
  ui.showMenu(message);
  audio.playMenuMusic();
}

// ---------- zones ----------

function myZone() {
  if (player.pos.x > 2500) return 'fac';
  if (GS.ph === 'orbit' || GS.ph === 'landing' || GS.ph === 'leaving') return 'ship';
  return ship.contains(player.pos.x, player.pos.z, 0.3) ? 'ship' : 'moon';
}

function facSeed() {
  return (GS.seed ^ ((GS.moon ?? 0) * 101159) ^ (GS.day * 7919)) | 0;
}

// ---------- world build / teardown ----------

function buildWorld() {
  const idx = GS.moon;
  const fs = facSeed();
  gen.setSeed(fs);
  gen.setTheme(MOONS[idx].maze);
  moonWorld.build(idx, fs);
  if (idx !== COMPANY_IDX) facility.build(MOONS[idx].maze);
  scrap.spawnForMoon(fs, idx, GS.day, facility, moonWorld);
  if (net.isHost) monsters.spawnForMoon(MOONS[idx], facility, moonWorld);
  else monsters.buildRoster(MOONS[idx]);
  ship.setHullVisible(true);
  worldReady = true;
}

function disposeWorld() {
  scrap.keepShipOnly();
  monsters.clearAll();
  facility.dispose();
  moonWorld.dispose();
  ship.setHullVisible(false);
  worldReady = false;
}

// ---------- phase machine ----------

/** Local reaction to a phase change (host and guests both run this). */
function applyPhase(newPh) {
  const old = GS.ph;
  GS.ph = newPh;
  phaseT = 0;
  if (newPh === 'landing') {
    ship.setDoor(false);
    ship.setLever(true);
    audio.setRumble(1);
    audio.doorHiss();
    shake = 1;
    if (!worldReady || moonWorld.moonIdx !== GS.moon) buildWorld();
    ui.addChat(null, `descending to ${MOONS[GS.moon].name}…`, { system: true });
  } else if (newPh === 'landed') {
    audio.setRumble(0);
    ship.setDoor(true);
    ship.setLever(false);
    audio.doorHiss();
    shake = 0.4;
    alarmTimer = 0;
    if (!worldReady || moonWorld.moonIdx !== GS.moon) buildWorld();
    ui.addChat(null, `welcome to ${MOONS[GS.moon].name}. ship leaves at midnight.`, { system: true });
  } else if (newPh === 'leaving') {
    ship.setDoor(false);
    ship.setLever(true);
    audio.setRumble(1);
    audio.doorHiss();
    shake = 1;
    ui.addChat(null, 'taking off…', { system: true });
  } else if (newPh === 'orbit') {
    audio.setRumble(0);
    ship.setLever(false);
    shake = 0;
    if (old === 'leaving') disposeWorld();
    // revive the dead
    if (dead) {
      dead = false;
      deadBy = null;
      ui.hideOverlays();
      if (state === 'dead') state = 'playing';
      input.requestLock(ui.el.canvas);
    }
    spawnInShip();
    ui.addChat(null, 'back in orbit.', { system: true });
  }
}

// ---- host-side transitions ----

function sendGm() {
  if (!net.isHost) return;
  net.send('gm', gmPayload());
}
function gmPayload() {
  return {
    ph: GS.ph, routed: GS.routed, moon: GS.moon, day: GS.day, dl: GS.dl,
    q: GS.q, sold: GS.sold, money: GS.money, clk: +GS.clk.toFixed(3), cyc: GS.cyc,
  };
}

// Persist the run (host only) at stable beats so it can be resumed later.
function maybeSave() {
  if (!net.isHost) return;
  saveRun({
    seed: GS.seed, day: GS.day, dl: GS.dl, q: GS.q, sold: GS.sold,
    money: GS.money, cyc: GS.cyc, flashlight: myFlashlight,
    ship: scrap.exportShip(),
  });
}

function hostLever() {
  if (GS.ph === 'orbit') {
    if (GS.routed === null) {
      ui.toast('no course set — use the terminal');
      net.send('ev', { e: 'toast', text: 'no course set — use the terminal' });
      return;
    }
    GS.moon = GS.routed;
    applyPhase('landing');
    sendGm();
  } else if (GS.ph === 'landed') {
    hostStartLeaving();
  }
}

function hostStartLeaving() {
  // anyone not aboard gets left behind
  for (const p of allPlayers()) {
    if (!p.dead && p.zone !== 'ship') hostKill(p.id, 'takeoff');
  }
  // carried scrap inside the ship is auto-stowed
  for (const p of allPlayers()) {
    if (p.zone !== 'ship') continue;
    for (const it of scrap.carriedBy(p.id)) {
      hostDrop(it.id, [p.x, 0, p.z], 'ship');
    }
  }
  applyPhase('leaving');
  sendGm();
}

function hostFinishLeaving() {
  const wasCompany = GS.moon === COMPANY_IDX;
  applyPhase('orbit');
  GS.moon = null;
  GS.routed = null;
  if (!wasCompany) {
    GS.day++;
    GS.dl--;
  }
  if (GS.dl < 0) {
    if (GS.sold >= GS.q) {
      // shouldn't happen (cycle resets at sell time), but be safe
      hostCycleComplete();
    } else {
      net.send('ev', { e: 'fired', stats: firedStats() });
      onFired(firedStats());
      setTimeout(() => { if (net.isHost) hostResetRun(); }, 6500);
      return;
    }
  }
  sendGm();
  maybeSave();
}

function firedStats() {
  return `you sold $${GS.sold} of a $${GS.q} quota · survived ${GS.day} days · cycle ${GS.cyc}`;
}

function hostCycleComplete() {
  GS.cyc++;
  GS.q += QUOTA_STEP + GS.cyc * 15;
  GS.dl = QUOTA_DAYS;
  GS.sold = 0;
  net.send('ev', { e: 'quota' });
  ui.addChat(null, `quota fulfilled! new quota: $${GS.q}. ${QUOTA_DAYS} days.`, { system: true });
  audio.sellChime();
  maybeSave();
}

function hostResetRun() {
  Object.assign(GS, {
    ph: 'orbit', routed: null, moon: null, day: 1, dl: QUOTA_DAYS,
    q: START_QUOTA, sold: 0, money: START_MONEY, clk: DAY_START_H, cyc: 1,
  });
  scrap.reset();
  net.send('ev', { e: 'reset' });
  onRunReset();
  sendGm();
}

function onFired(stats) {
  clearRun();
  input.releaseLock();
  terminal.hide();
  ui.showFired(stats);
  audio.jumpscare();
}

function onRunReset() {
  disposeWorld();
  scrap.reset();
  dead = false;
  applyPhase('orbit');
  ui.hideOverlays();
  state = 'playing';
  ui.addChat(null, 'new contract. same fine print.', { system: true });
  input.requestLock(ui.el.canvas);
}

// ---- host scrap / economy ----

function hostTake(id, pid) {
  const it = scrap.items[id];
  if (!it) return;
  if (it.state !== ST.FREE && it.state !== ST.DROPPED && it.state !== ST.SHIP) return;
  if (scrap.carriedBy(pid).length >= INV_SLOTS) return;
  const ev = { e: 'scrap', k: 'take', id, by: pid };
  scrap.apply(ev);
  net.send('ev', ev);
  if (pid === net.myId) audio.pickup();
}

function hostDrop(id, p, zone) {
  const it = scrap.items[id];
  if (!it || it.state !== ST.CARRIED) return;
  const ev = { e: 'scrap', k: 'drop', id, p, zone };
  scrap.apply(ev);
  net.send('ev', ev);
}

function hostBell() {
  if (GS.ph !== 'landed' || GS.moon !== COMPANY_IDX) return;
  audio.bellDing();
  net.send('ev', { e: 'bell' });
  const items = scrap.atCounter(moonWorld.counterPos);
  if (!items.length) {
    ui.addChat(null, 'the Company waits. place scrap at the counter, then ring.', { system: true });
    net.send('ev', { e: 'toast', text: 'place scrap at the counter, then ring the bell' });
    return;
  }
  const rate = SELL_RATE[clamp(GS.dl, 0, 3)] ?? 1;
  let total = 0;
  for (const it of items) {
    total += it.value;
    const ev = { e: 'scrap', k: 'sell', id: it.id };
    scrap.apply(ev);
    net.send('ev', ev);
  }
  const gain = Math.round(total * rate);
  GS.money += gain;
  GS.sold += total;
  ui.addChat(null, `sold $${total} of scrap → $${gain} credits (${Math.round(rate * 100)}% rate)`, { system: true });
  net.send('ev', { e: 'soldmsg', total, gain, rate });
  audio.cash();
  if (GS.sold >= GS.q) hostCycleComplete();
  sendGm();
  maybeSave();
}

function hostBuy(pid, what) {
  if (what !== 'flashlight') return;
  if (GS.money < FLASHLIGHT_PRICE) {
    net.send('ev', { e: 'toast', text: 'insufficient credits' }, pid !== net.myId ? pid : undefined);
    if (pid === net.myId) ui.toast('insufficient credits');
    return;
  }
  GS.money -= FLASHLIGHT_PRICE;
  net.send('ev', { e: 'buy', pid, what });
  applyBuy(pid, what);
  sendGm();
  maybeSave();
}

function applyBuy(pid, what) {
  if (what === 'flashlight' && pid === net.myId) {
    myFlashlight = true;
    player.setFlashlight(true);
    ui.setFlashlight(true);
    audio.flashlightOn();
    ui.toast('flashlight acquired');
  } else if (what === 'flashlight') {
    const name = net.peersInfo.get(pid)?.name || 'someone';
    ui.addChat(null, `${name} bought a flashlight`, { system: true });
  }
}

// ---- host kills ----

function allPlayers() {
  const out = [{
    id: net.myId, x: player.pos.x, z: player.pos.z, ry: player.yaw,
    zone: myZone(), sp: player.sprinting ? 1 : 0, mv: player.moving ? 1 : 0,
    dead,
  }];
  for (const [id, st] of lastStates) {
    if (!net.conns.has(id) && !net.peersInfo.has(id)) continue;
    out.push({
      id, x: st.p[0], z: st.p[1], ry: st.ry || 0,
      zone: st.zn || 'ship', sp: st.sp, mv: st.mv, dead: !!st.dead,
    });
  }
  return out;
}

function hostKill(pid, by) {
  // drop whatever they carried where they stood
  const p = allPlayers().find((q) => q.id === pid);
  for (const it of scrap.carriedBy(pid)) {
    hostDrop(it.id, [p?.x ?? 0, 0, p?.z ?? 0], p?.zone === 'fac' ? 'fac' : 'moon');
  }
  net.send('ev', { e: 'death', pid, by });
  applyDeath(pid, by);
}

function applyDeath(pid, by) {
  if (pid === net.myId) {
    dead = true;
    deadBy = by;
    state = 'dead';
    player.frozen = true;
    audio.jumpscare();
    ui.scareFlash();
    input.releaseLock();
    terminal.hide();
    setTimeout(() => { if (dead) ui.showDeath(by); }, 900);
  } else {
    const name = net.peersInfo.get(pid)?.name || 'someone';
    const what = { crawler: 'was torn apart', stalker: 'vanished', hound: 'was run down', takeoff: 'missed the ship' }[by] || 'died';
    ui.addChat(null, `${name} ${what}`, { system: true });
    audio.chatPing();
  }
}

// ---------- terminal wiring ----------

terminal.getState = () => ({
  phase: GS.ph, moonIdx: GS.moon, routed: GS.routed, day: GS.day, daysLeft: GS.dl,
  quota: GS.q, sold: GS.sold, money: GS.money,
  shipValue: scrap.shipValue(), remaining: scrap.remainingValue(),
});
terminal.onRoute = (idx) => {
  if (net.isHost) {
    GS.routed = idx;
    sendGm();
  } else {
    net.send('act', { a: 'route', idx });
  }
};
terminal.onBuy = (what) => {
  if (net.isHost) hostBuy(net.myId, what);
  else net.send('act', { a: 'buy', what });
};
terminal.onClose = () => {
  if (state === 'playing') input.requestLock(ui.el.canvas);
};

// ---------- net wiring ----------

net.onPeerJoin = (id, info) => {
  remotes.add(id, info);
  ui.setPlayers(net.playerCount());
  ui.addChat(null, `${info.name} signed on`, { system: true });
  audio.chatPing();
  if (net.isHost) {
    // bring the newcomer up to speed
    net.send('sync', { gm: gmPayload(), snap: scrap.snapshot() }, id);
  }
};

net.onPeerLeave = (id) => {
  const name = remotes.map.get(id)?.info.name || 'someone';
  remotes.remove(id);
  lastStates.delete(id);
  ui.setPlayers(net.playerCount());
  ui.addChat(null, `${name} quit the company`, { system: true });
};

net.onClosed = (reason) => leaveToMenu(reason);

net.onMsg = (m, from, msg) => {
  switch (m) {
    case 'st':
      remotes.applyState(from, { id: from, ...msg });
      lastStates.set(from, msg);
      break;

    case 'chat': {
      const name = net.peersInfo.get(from)?.name || '???';
      remotes.say(from, msg.text);
      const dist = remotes.distanceTo(from, graphics.camera.position);
      ui.addChat(name, msg.text, { proximity: clamp(1.2 - dist / 30, 0.05, 1) });
      audio.chatPing();
      break;
    }

    case 'gm': {
      if (net.isHost) break;
      const oldPh = GS.ph;
      const oldDay = GS.day;
      Object.assign(GS, msg);
      if (msg.ph !== oldPh) applyPhase(msg.ph);
      else if (msg.ph === 'landed' && (!worldReady || moonWorld.moonIdx !== GS.moon || oldDay !== GS.day)) {
        buildWorld();
        ship.setDoor(true);
      }
      break;
    }

    case 'sync': {
      if (net.isHost) break;
      const oldPh = GS.ph;
      Object.assign(GS, msg.gm);
      if (GS.ph !== oldPh) applyPhase(GS.ph);
      if ((GS.ph === 'landed' || GS.ph === 'landing') && !worldReady) buildWorld();
      if (msg.snap && worldReady) scrap.applySnapshot(msg.snap);
      break;
    }

    case 'ent':
      if (!net.isHost) monsters.applyNetStates(msg.s || [], 1 / ENT_NET_HZ);
      break;

    case 'ev':
      handleEvent(msg, from);
      break;

    case 'act':
      if (!net.isHost) break;
      if (msg.a === 'lever') hostLever();
      else if (msg.a === 'route') { GS.routed = msg.idx; sendGm(); ui.addChat(null, `course set: ${MOONS[msg.idx].name}`, { system: true }); }
      else if (msg.a === 'take') hostTake(msg.id, from);
      else if (msg.a === 'drop') hostDrop(msg.id, msg.p, msg.zone);
      else if (msg.a === 'bell') hostBell();
      else if (msg.a === 'buy') hostBuy(from, msg.what);
      break;
  }
};

function handleEvent(ev) {
  switch (ev.e) {
    case 'scrap':
      scrap.apply(ev);
      if (ev.k === 'take' && ev.by === net.myId) audio.pickup();
      if (ev.k === 'drop') audio.dropThud();
      break;
    case 'death':
      applyDeath(ev.pid, ev.by);
      break;
    case 'buy':
      applyBuy(ev.pid, ev.what);
      break;
    case 'bell':
      audio.bellDing();
      break;
    case 'soldmsg':
      ui.addChat(null, `sold $${ev.total} of scrap → $${ev.gain} credits (${Math.round(ev.rate * 100)}% rate)`, { system: true });
      audio.cash();
      break;
    case 'quota':
      ui.addChat(null, 'quota fulfilled! check the terminal for the new number.', { system: true });
      audio.sellChime();
      break;
    case 'fired':
      onFired(ev.stats);
      break;
    case 'reset':
      onRunReset();
      break;
    case 'toast':
      ui.toast(ev.text);
      break;
    case 'roar':
      audio.roar();
      break;
    case 'howl':
      audio.howl();
      ui.addChat(null, 'something howls outside.', { system: true });
      break;
    case 'alarm':
      audio.alarmBeep();
      ui.addChat(null, 'SHIP LEAVES AT MIDNIGHT.', { system: true });
      break;
  }
}

// ---------- chat / pause ----------

ui.onChatSend = (text) => {
  net.send('chat', { text });
  ui.addChat(ui.playerName(), text, { proximity: 1 });
};
ui.onResume = () => {
  state = 'playing';
  ui.hideOverlays();
  input.requestLock(ui.el.canvas);
};
ui.onLeave = () => leaveToMenu();
ui.onSettingsChanged = () => {
  audio.applyVolumes();
  if (state !== 'menu' && state !== 'loading') {
    const q = graphics.applyQuality(settings.quality, settings.fov);
    lights.configure(q);
  }
};

input.onLockChange = (locked) => {
  if (!locked && state === 'playing' && !ui.chatOpen && !terminal.open) {
    state = 'paused';
    ui.showPause();
  }
  if (locked) ui.setHint('');
};

ui.el.canvas.addEventListener('click', () => {
  if (state === 'playing' && !input.pointerLocked && !terminal.open) input.requestLock(ui.el.canvas);
});

// ---------- interactions ----------

function currentInteract() {
  if (state !== 'playing' || dead) return null;
  const zone = myZone();
  const px = player.pos.x, pz = player.pos.z;
  const near = (x, z, r = INTERACT_DIST) => Math.hypot(x - px, z - pz) < r;

  if (zone === 'ship') {
    if (near(ship.terminalPos.x, ship.terminalPos.z, 2.2)) {
      return { kind: 'terminal', hint: '<b>E</b> — use terminal' };
    }
    if (near(ship.leverPos.x, ship.leverPos.z, 2.2)) {
      if (GS.ph === 'orbit') return { kind: 'lever', hint: GS.routed === null ? '<b>E</b> — lever (set a course first)' : `<b>E</b> — descend to ${MOONS[GS.routed].name}` };
      if (GS.ph === 'landed') return { kind: 'lever', hint: '<b>E</b> — take off' };
    }
  }
  if (zone === 'moon' && worldReady) {
    if (moonWorld.facDoorEnter && near(moonWorld.facDoorEnter.x, moonWorld.facDoorEnter.z)) {
      return { kind: 'enterFac', hint: '<b>E</b> — enter facility' };
    }
    if (moonWorld.bellPos && near(moonWorld.bellPos.x, moonWorld.bellPos.z, 2.6)) {
      return { kind: 'bell', hint: '<b>E</b> — ring the bell (sells counter scrap)' };
    }
  }
  if (zone === 'fac' && facility.built) {
    if (near(facility.entrance.x, facility.entrance.z)) {
      return { kind: 'exitFac', hint: '<b>E</b> — exit facility' };
    }
  }
  // scrap
  const myCarry = scrap.carriedBy(net.myId);
  if (myCarry.length < INV_SLOTS) {
    const it = scrap.nearestTakeable(px, pz, zone);
    if (it) return { kind: 'take', id: it.id, hint: `<b>E</b> — grab ${it.type.name} ($${it.value})` };
  }
  return null;
}

function doInteract() {
  const act = currentInteract();
  if (!act) return;
  switch (act.kind) {
    case 'terminal':
      input.releaseLock();
      terminal.show();
      break;
    case 'lever':
      if (net.isHost) hostLever();
      else net.send('act', { a: 'lever' });
      break;
    case 'enterFac':
      // face into the maze (+Z): camera forward is (-sin yaw, -cos yaw)
      player.teleport(facility.entrance.x, facility.entrance.z, Math.PI);
      player.floorY = 0;
      audio.doorHiss();
      break;
    case 'exitFac': {
      const d = moonWorld.facDoorEnter;
      player.teleport(d.x, d.z, Math.atan2(-d.x, -d.z) + Math.PI);
      player.floorY = moonWorld.groundY(d.x, d.z);
      audio.doorHiss();
      break;
    }
    case 'bell':
      if (net.isHost) hostBell();
      else net.send('act', { a: 'bell' });
      break;
    case 'take':
      if (net.isHost) hostTake(act.id, net.myId);
      else net.send('act', { a: 'take', id: act.id });
      break;
  }
}

function doDrop() {
  const carried = scrap.carriedBy(net.myId);
  if (!carried.length) return;
  const it = carried[carried.length - 1];
  const zone = myZone();
  const p = [
    +player.pos.x.toFixed(2),
    +(zone === 'moon' ? moonWorld.groundY(player.pos.x, player.pos.z) : player.floorY).toFixed(2),
    +player.pos.z.toFixed(2),
  ];
  if (net.isHost) hostDrop(it.id, p, zone);
  else net.send('act', { a: 'drop', id: it.id, p, zone });
}

document.addEventListener('keydown', (e) => {
  if (terminal.open) return;
  if (state === 'playing' && !ui.chatOpen && (e.code === 'KeyT' || e.code === 'Enter')) {
    e.preventDefault();
    ui.openChat();
  }
  if (state === 'playing' && !ui.chatOpen && e.code === 'KeyE') doInteract();
  if (state === 'playing' && !ui.chatOpen && e.code === 'KeyG') doDrop();
});

if (IS_TOUCH) {
  const sprintBtn = ui.el.touchSprint;
  sprintBtn.addEventListener('touchstart', () => input.setSprintTouch(true));
  sprintBtn.addEventListener('touchend', () => input.setSprintTouch(false));
  ui.onInteractTouch = () => doInteract();
  ui.el.playersChip.addEventListener('click', () => {
    if (state === 'playing') { state = 'paused'; ui.showPause(); }
  });
}

// ---------- main loop ----------

player.onFootstep = (sprint) => audio.footstep(sprint);

const clock = new THREE.Clock();

window.__nl = { player, GS, net, monsters, scrap, facility, moonWorld, ship, graphics, get state() { return state; } };

// When the tab is hidden rAF stops, which would freeze the host's simulation
// for the whole crew — keep ticking on a timer instead.
setInterval(() => { if (document.hidden) frame(true); }, 50);

// rAF driver. Guarded so we never run two overlapping chains (e.g. a deferred
// callback firing at the same time as a visibilitychange restart). Note rAF
// invokes its callback with a timestamp arg, so we must NOT pass `frame`
// directly — that timestamp would be read as `fromTimer` and kill the chain.
let rafScheduled = false;
function scheduleFrame() {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => { rafScheduled = false; frame(); });
}
// Hidden tabs may drop the pending rAF; restart the chain on return so the
// game doesn't stay frozen on a single still frame.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { clock.getDelta(); scheduleFrame(); }
});

function frame(fromTimer) {
  if (!fromTimer) scheduleFrame();
  window.__nlF = (window.__nlF || 0) + 1;
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  const inGame = state === 'playing' || state === 'paused' || state === 'dead';
  if (!inGame) return;
  window.__nlG = (window.__nlG || 0) + 1;

  input.enabled = state === 'playing' && !ui.chatOpen && !terminal.open;
  input.update();

  const zone = myZone();

  // colliders + floor
  let colliders;
  if (zone === 'fac') {
    colliders = facility.collidersNear(player.pos.x, player.pos.z);
  } else {
    colliders = ship.colliders();
    if (worldReady && (GS.ph === 'landed')) colliders = colliders.concat(moonWorld.collidersNear(player.pos.x, player.pos.z));
  }
  player.groundFn = (x, z) => {
    if (zone === 'fac') return 0;
    const sy = ship.floorYAt(x, z);
    if (sy !== null) return sy;
    if (GS.ph === 'landed' && worldReady) return moonWorld.groundY(x, z);
    return 0;
  };
  const carried = scrap.carriedBy(net.myId);
  const carryW = carried.reduce((s, it) => s + it.weight, 0);
  player.speedMul = clamp(1 - carryW / 130, 0.5, 1);

  player.update(dt, colliders);
  ship.update(dt);
  remotes.update(dt, graphics.camera.position);

  // camera shake during transit
  if (shake > 0.01) {
    shake = damp(shake, GS.ph === 'landing' || GS.ph === 'leaving' ? 1 : 0, 2.5, dt);
    graphics.camera.position.x += (Math.random() - 0.5) * 0.035 * shake;
    graphics.camera.position.y += (Math.random() - 0.5) * 0.045 * shake;
    graphics.camera.rotation.z += (Math.random() - 0.5) * 0.004 * shake;
  } else if (GS.ph === 'landing' || GS.ph === 'leaving') {
    shake = 0.2;
  }

  // ---- host simulation ----
  if (net.isHost) {
    phaseT += dt;
    if (GS.ph === 'landing' && phaseT >= TRANSIT_TIME) {
      GS.clk = DAY_START_H;
      applyPhase('landed');
      sendGm();
    } else if (GS.ph === 'leaving' && phaseT >= TRANSIT_TIME) {
      hostFinishLeaving();
    } else if (GS.ph === 'landed') {
      // day clock
      const rate = (DAY_END_H - DAY_START_H) / DAY_REAL_SECONDS;
      const prev = GS.clk;
      GS.clk = Math.min(DAY_END_H, GS.clk + rate * dt);
      if (prev < HOUND_HOUR && GS.clk >= HOUND_HOUR) {
        if (monsters.releaseHounds()) {
          net.send('ev', { e: 'howl' });
          audio.howl();
          ui.addChat(null, 'something howls outside.', { system: true });
        }
      }
      if (prev < 23 && GS.clk >= 23) {
        net.send('ev', { e: 'alarm' });
        audio.alarmBeep();
        ui.addChat(null, 'SHIP LEAVES AT MIDNIGHT.', { system: true });
      }
      if (GS.clk >= DAY_END_H) {
        hostStartLeaving();
      }

      // monsters
      const players = allPlayers();
      monsters.hostUpdate(dt, players, facility, moonWorld);
      const kill = monsters.checkKills(players);
      if (kill) hostKill(kill.pid, kill.kind);

      // crawler roar on new chases
      for (const mo of monsters.list) {
        if (mo.kind === 'crawler' && mo.state === 1 && !mo._roared) {
          mo._roared = true;
          net.send('ev', { e: 'roar' });
          audio.roar();
        } else if (mo.kind === 'crawler' && mo.state === 0) {
          mo._roared = false;
        }
      }

      // everyone dead → autopilot home
      if (players.every((p) => p.dead)) {
        allDeadT += dt;
        if (allDeadT > 5) { allDeadT = 0; hostStartLeaving(); }
      } else allDeadT = 0;

      entAcc += dt;
      if (entAcc >= 1 / ENT_NET_HZ) {
        entAcc = 0;
        net.send('ent', { s: monsters.netStates() });
      }
    }

    gmAcc += dt;
    if (gmAcc >= 1 / GM_NET_HZ) {
      gmAcc = 0;
      sendGm();
    }
  } else {
    if (GS.ph === 'landed') monsters.guestUpdate(dt);
  }

  // facility lights
  if (zone === 'fac') {
    lights.update(t, player.pos.x, player.pos.z);
    lights.ambient.intensity = 0.45;
    facility.updateBeacon(t);
  } else {
    lights.update(t, 1e8, 1e8); // park the pool
    lights.ambient.intensity = 0.08;
  }

  // environment / sky
  const env = moonWorld.updateSky(
    GS.ph === 'landed' && worldReady ? GS.clk : null);
  if (zone === 'fac') {
    graphics.setEnv({ fog: 0x0a0c08, density: 0.055, sky: 0x020302 }, dt);
  } else {
    graphics.setEnv(env, dt);
  }

  // fear: nearest active monster in my zone
  const targetFear = dead ? 1 : monsters.maxFear(player.pos.x, player.pos.z, zone);
  fear = damp(fear, targetFear, 3, dt);
  graphics.setFear(fear);

  const buzz = zone === 'fac'
    ? clamp(1 - lights.nearestDist / 9, 0, 1) * (0.25 + 0.75 * lights.nearestFlicker)
    : 0;
  audio.update(t, buzz, fear);

  // interact hint
  const act = currentInteract();
  ui.setInteractHint(act?.hint || (carried.length ? '<b>G</b> — drop ' + carried[carried.length - 1].type.name : ''));

  // network send
  sendAcc += dt;
  if (sendAcc >= 1 / NET_SEND_HZ && net.ws) {
    sendAcc = 0;
    net.send('st', {
      p: [+player.pos.x.toFixed(3), +player.pos.z.toFixed(3)],
      y: +(player.floorY + player.y).toFixed(2),
      ry: +player.yaw.toFixed(3),
      pi: +player.pitch.toFixed(2),
      mv: player.moving ? 1 : 0,
      sp: player.sprinting ? 1 : 0,
      zn: zone,
      dead: dead ? 1 : 0,
    });
  }

  // HUD
  ui.setStamina(player.stamina / STAMINA_MAX);
  ui.setStatus({
    day: GS.day, daysLeft: Math.max(0, GS.dl), quota: GS.q, sold: GS.sold,
    money: GS.money, clock: GS.ph === 'landed' ? GS.clk : null, landed: GS.ph === 'landed',
  });
  ui.setShipValue(scrap.shipValue());
  ui.setInventory([carried[0], carried[1]]);

  // quota board in the ship reflects the live numbers
  const qKey = GS.q + '|' + GS.sold + '|' + GS.dl;
  if (qKey !== frame._qKey) {
    frame._qKey = qKey;
    ship.setQuotaBoard({ q: GS.q, sold: GS.sold, dl: GS.dl });
  }

  graphics.render(t);
}
scheduleFrame();
