// world.js — procedural Backrooms level generator
// Uses chunked procedural generation: rooms are placed on a deterministic grid
// and corridors connect them. Chunks around the player are kept loaded; distant
// ones are recycled. This gives the "infinite" feel without ever allocating more
// than a few hundred rooms at a time.

import * as THREE from 'three';

// ---- Tunables ----------------------------------------------------------------

export const CONFIG = {
  CELL: 12,                  // grid cell size (world units) for room placement
  ROOM_MIN: 8,               // min room size (cells)
  ROOM_MAX: 22,              // max room size (cells)
  CORRIDOR_W: 4,             // corridor width
  WALL_H: 4.0,               // wall height
  LOAD_RADIUS: 3,            // chunks (cells) around player to keep loaded
  UNLOAD_RADIUS: 5,          // chunks beyond this get recycled
  SEED_BASE: 1337,
  TILE: 2,                   // world units per "tile" (used for colliders)
};

// ---- Seeded PRNG -------------------------------------------------------------

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(cx, cz, salt) {
  // simple deterministic hash → seed
  let h = (cx * 374761393 + cz * 668265263 + salt * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---- Cell / Room model -------------------------------------------------------
//
// The world is a sparse grid of "cells" (cellX, cellZ) each containing zero or
// more rooms. A room is a rect {x, z, w, h} in cells. Corridors are short
// straight runs from one cell to its neighbor.
//
// Each loaded room produces: floor mesh, ceiling mesh, 4 wall meshes,
// collider boxes.

const roomsByCell = new Map();   // "cx,cz" → Room[]
const colliders = [];            // flat list of {box: THREE.Box3, center: THREE.Vector3}
let lastPlayerCell = { x: 999, z: 999 };

function cellKey(cx, cz) { return `${cx},${cz}`; }

function generateCell(cx, cz) {
  const rng = mulberry32(hash2(cx, cz, CONFIG.SEED_BASE));
  const rooms = [];

  // 1–3 rooms per cell
  const count = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const w = CONFIG.ROOM_MIN + Math.floor(rng() * (CONFIG.ROOM_MAX - CONFIG.ROOM_MIN));
    const h = CONFIG.ROOM_MIN + Math.floor(rng() * (CONFIG.ROOM_MAX - CONFIG.ROOM_MIN));
    const ox = Math.floor(rng() * (CONFIG.CELL - w));
    const oz = Math.floor(rng() * (CONFIG.CELL - h));
    rooms.push({
      x: cx * CONFIG.CELL + ox,
      z: cz * CONFIG.CELL + oz,
      w, h,
      lightFlicker: rng() < 0.18,    // some rooms have a broken light
      lightSeed: Math.floor(rng() * 1e6),
    });
  }

  // 0–1 corridor slot connecting to the +x neighbor (if we own the cell)
  // Corridors are stored as part of the cell to the LEFT — that way we don't
  // double-author them.
  if (cx > -100) {
    const corridorRng = mulberry32(hash2(cx - 1, cz, CONFIG.SEED_BASE + 7));
    if (corridorRng() < 0.55) {
      const czr = Math.floor(corridorRng() * (CONFIG.CELL - CONFIG.CORRIDOR_W));
      rooms.push({
        x: (cx - 1) * CONFIG.CELL + CONFIG.CELL - 1,
        z: cz * CONFIG.CELL + czr,
        w: 1, h: CONFIG.CORRIDOR_W,
        isCorridor: true,
        dir: 'x',
      });
    }
  }
  if (cz > -100) {
    const corridorRng = mulberry32(hash2(cx, cz - 1, CONFIG.SEED_BASE + 11));
    if (corridorRng() < 0.55) {
      const cxr = Math.floor(corridorRng() * (CONFIG.CELL - CONFIG.CORRIDOR_W));
      rooms.push({
        x: cx * CONFIG.CELL + cxr,
        z: (cz - 1) * CONFIG.CELL + CONFIG.CELL - 1,
        w: CONFIG.CORRIDOR_W, h: 1,
        isCorridor: true,
        dir: 'z',
      });
    }
  }

  return rooms;
}

function ensureCell(cx, cz) {
  const k = cellKey(cx, cz);
  if (!roomsByCell.has(k)) roomsByCell.set(k, generateCell(cx, cz));
  return roomsByCell.get(k);
}

// ---- Mesh build helpers ------------------------------------------------------

const ROOM_GEOM = new THREE.PlaneGeometry(1, 1);
const WALL_GEOM = new THREE.PlaneGeometry(1, 1);

// Procedural wallpaper texture: yellow base + grid + stains. We bake this once.
function makeWallpaperTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');

  // base — bright yellow (Backrooms iconic)
  ctx.fillStyle = '#e6c265';
  ctx.fillRect(0, 0, 256, 256);

  // mottled stains
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 20 + Math.random() * 50;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(110, 80, 20, 0.45)');
    grad.addColorStop(1, 'rgba(110, 80, 20, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // faded grid pattern (faint)
  ctx.strokeStyle = 'rgba(100, 70, 20, 0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 256; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }

  // subtle scratches
  ctx.strokeStyle = 'rgba(50, 35, 5, 0.3)';
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * 256, Math.random() * 256);
    ctx.lineTo(Math.random() * 256, Math.random() * 256);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCarpetTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5e6b3d';
  ctx.fillRect(0, 0, 256, 256);
  // noise
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const a = Math.random() * 0.25;
    ctx.fillStyle = `rgba(${20 + Math.random() * 30},${30 + Math.random() * 30},${10 + Math.random() * 20},${a})`;
    ctx.fillRect(x, y, 1, 1);
  }
  // darker patches
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 30 + Math.random() * 60;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(20, 30, 10, 0.4)');
    grad.addColorStop(1, 'rgba(20, 30, 10, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCeilingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#dccd9a';
  ctx.fillRect(0, 0, 128, 128);
  // tile lines
  ctx.strokeStyle = 'rgba(60, 50, 30, 0.4)';
  for (let i = 0; i <= 128; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
  }
  // water stains
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const r = 10 + Math.random() * 25;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(100, 80, 40, 0.4)');
    grad.addColorStop(1, 'rgba(100, 80, 40, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const wallpaperTex = makeWallpaperTexture();
const carpetTex = makeCarpetTexture();
const ceilingTex = makeCeilingTexture();

const sharedMats = {
  floor: new THREE.MeshLambertMaterial({ map: carpetTex }),
  ceiling: new THREE.MeshLambertMaterial({ map: ceilingTex }),
  wall: new THREE.MeshLambertMaterial({ map: wallpaperTex, side: THREE.FrontSide }),
};

function buildRoomMeshes(room) {
  const group = new THREE.Group();
  const wx = room.x * CONFIG.TILE;
  const wz = room.z * CONFIG.TILE;
  const ww = room.w * CONFIG.TILE;
  const wh = room.h * CONFIG.TILE;

  // floor
  const floor = new THREE.Mesh(ROOM_GEOM, sharedMats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.scale.set(ww, wh, 1);
  floor.position.set(wx + ww / 2, 0, wz + wh / 2);
  floor.receiveShadow = true;
  group.add(floor);

  // ceiling (slightly lower so lights feel "in the room")
  const ceiling = new THREE.Mesh(ROOM_GEOM, sharedMats.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.scale.set(ww, wh, 1);
  ceiling.position.set(wx + ww / 2, CONFIG.WALL_H, wz + wh / 2);
  group.add(ceiling);

  // walls (4)
  const wMat = sharedMats.wall;
  const makeWall = (sx, sz, sw, sh, rotY) => {
    const m = new THREE.Mesh(WALL_GEOM, wMat);
    m.scale.set(sw, sh, 1);
    m.position.set(sx, sh / 2, sz);
    m.rotation.y = rotY;
    group.add(m);
  };
  // north (z = wz)
  makeWall(wx + ww / 2, wz, ww, CONFIG.WALL_H, 0);
  // south (z = wz + wh)
  makeWall(wx + ww / 2, wz + wh, ww, CONFIG.WALL_H, Math.PI);
  // west (x = wx)
  makeWall(wx, wz + wh / 2, wh, CONFIG.WALL_H, -Math.PI / 2);
  // east (x = wx + ww)
  makeWall(wx + ww, wz + wh / 2, wh, CONFIG.WALL_H, Math.PI / 2);

  // light fixture on ceiling
  const lightFixture = new THREE.Mesh(
    new THREE.BoxGeometry(CONFIG.TILE * 0.8, 0.2, CONFIG.TILE * 0.3),
    new THREE.MeshBasicMaterial({ color: 0xfff4c8 })
  );
  lightFixture.position.set(wx + ww / 2, CONFIG.WALL_H - 0.05, wz + wh / 2);
  group.add(lightFixture);

  // point light for this room (always-on at half intensity; flicker rooms dim occasionally)
  const light = new THREE.PointLight(0xffe9a8, room.lightFlicker ? 0.6 : 1.4, CONFIG.TILE * 6, 1.6);
  light.position.set(wx + ww / 2, CONFIG.WALL_H - 0.5, wz + wh / 2);
  if (room.lightFlicker) {
    light.userData = { flicker: true, seed: room.lightSeed, baseIntensity: 1.4 };
  }
  group.add(light);

  // collider
  const box = new THREE.Box3(
    new THREE.Vector3(wx, 0, wz),
    new THREE.Vector3(wx + ww, CONFIG.WALL_H, wz + wh)
  );
  const center = new THREE.Vector3(wx + ww / 2, CONFIG.WALL_H / 2, wz + wh / 2);
  colliders.push({ box, center, isCorridor: !!room.isCorridor });

  return group;
}

// ---- Streaming ---------------------------------------------------------------

const loadedCells = new Map();   // "cx,cz" → THREE.Group

function loadCell(cx, cz) {
  const k = cellKey(cx, cz);
  if (loadedCells.has(k)) return;
  const rooms = ensureCell(cx, cz);
  const g = new THREE.Group();
  for (const r of rooms) g.add(buildRoomMeshes(r));
  loadedCells.set(k, g);
  return g;
}

function unloadCell(cx, cz) {
  const k = cellKey(cx, cz);
  const g = loadedCells.get(k);
  if (!g) return;
  g.parent?.remove(g);
  g.traverse((o) => {
    if (o.geometry && o.geometry !== ROOM_GEOM && o.geometry !== WALL_GEOM) {
      // shared geometries are reused; only dispose per-mesh extras
    }
  });
  loadedCells.delete(k);

  // also drop colliders belonging to this cell
  const wx = cx * CONFIG.CELL * CONFIG.TILE;
  const wz = cz * CONFIG.CELL * CONFIG.TILE;
  const wsx = CONFIG.CELL * CONFIG.TILE;
  for (let i = colliders.length - 1; i >= 0; i--) {
    const c = colliders[i];
    if (c.center.x >= wx && c.center.x < wx + wsx &&
        c.center.z >= wz && c.center.z < wz + wsx) {
      colliders.splice(i, 1);
    }
  }
}

export function updateStreaming(scene, playerPos) {
  const cx = Math.floor(playerPos.x / (CONFIG.CELL * CONFIG.TILE));
  const cz = Math.floor(playerPos.z / (CONFIG.CELL * CONFIG.TILE));

  if (cx === lastPlayerCell.x && cz === lastPlayerCell.z) return;
  lastPlayerCell = { x: cx, z: cz };

  const want = new Set();
  for (let dx = -CONFIG.LOAD_RADIUS; dx <= CONFIG.LOAD_RADIUS; dx++) {
    for (let dz = -CONFIG.LOAD_RADIUS; dz <= CONFIG.LOAD_RADIUS; dz++) {
      want.add(cellKey(cx + dx, cz + dz));
    }
  }

  // unload far
  for (const k of Array.from(loadedCells.keys())) {
    const [x, z] = k.split(',').map(Number);
    if (Math.abs(x - cx) > CONFIG.UNLOAD_RADIUS || Math.abs(z - cz) > CONFIG.UNLOAD_RADIUS) {
      unloadCell(x, z);
    }
  }

  // load missing
  for (const k of want) {
    if (!loadedCells.has(k)) {
      const [x, z] = k.split(',').map(Number);
      const g = loadCell(x, z);
      if (g) scene.add(g);
    }
  }
}

export function getColliders() { return colliders; }

export function tickFlicker(time) {
  // Update flickering lights (subtle pulse, not full blackout)
  for (const g of loadedCells.values()) {
    g.traverse((o) => {
      if (o.isPointLight && o.userData?.flicker) {
        const seed = o.userData.seed;
        const base = o.userData.baseIntensity ?? 1.4;
        const t = (time / 1000 + seed * 0.001) % 1000;
        const flicker = 0.7 + 0.3 * (Math.sin(t * 13.0) * Math.sin(t * 7.3) * 0.5 + 0.5);
        o.intensity = base * flicker;
      }
    });
  }
}

// ---- Collision ---------------------------------------------------------------

// AABB sweep vs static colliders. Returns corrected position + floor Y.
// We resolve X then Z separately so wall-sliding works.
export function resolveCollision(prev, next, halfWidth, halfHeight) {
  const playerBox = new THREE.Box3();

  // X axis
  const tryX = next.x;
  playerBox.min.set(tryX - halfWidth, prev.y - halfHeight, prev.z - halfWidth);
  playerBox.max.set(tryX + halfWidth, prev.y + halfHeight, prev.z + halfWidth);
  if (colliders.some(c => playerBox.intersectsBox(c.box))) {
    next.x = prev.x;
  }

  // Z axis
  const tryZ = next.z;
  playerBox.min.set(next.x - halfWidth, prev.y - halfHeight, tryZ - halfWidth);
  playerBox.max.set(next.x + halfWidth, prev.y + halfHeight, tryZ + halfWidth);
  if (colliders.some(c => playerBox.intersectsBox(c.box))) {
    next.z = prev.z;
  }

  // Floor (y): find the top of the highest collider below the player.
  // Since rooms all sit on y=0 and have top y=WALL_H, the player is either on
  // the floor of a room (y=0, eye height = 1.6) or inside one (which shouldn't
  // happen if we resolve correctly). We just need a ground reference — use the
  // nearest room's floor level.
  let floorY = -Infinity;
  const px = next.x, pz = next.z;
  for (const c of colliders) {
    if (px >= c.box.min.x && px <= c.box.max.x &&
        pz >= c.box.min.z && pz <= c.box.max.z) {
      floorY = Math.max(floorY, 0); // room floors are at y=0
    }
  }
  return { floorY };
}

// ---- Spawn point -------------------------------------------------------------

export function findSpawnPoint() {
  // Spawn at cell (0, 0) — guaranteed to have a room
  ensureCell(0, 0);
  const rooms = roomsByCell.get(cellKey(0, 0));
  const r = rooms[0];
  return new THREE.Vector3(
    (r.x + r.w / 2) * CONFIG.TILE,
    1.6,
    (r.z + r.h / 2) * CONFIG.TILE,
  );
}

// initial warm: load cells around origin so the player isn't in a void
export function warmStart(scene) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const g = loadCell(dx, dz);
      if (g) scene.add(g);
    }
  }
  lastPlayerCell = { x: 0, z: 0 };
}
