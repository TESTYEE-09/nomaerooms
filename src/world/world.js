// world.js — procedural Backrooms level generator
// Uses chunked procedural generation: rooms are placed on a deterministic grid
// and corridors connect them. Chunks around the player are kept loaded; distant
// ones are recycled. This gives the "infinite" feel without ever allocating more
// than a few hundred rooms at a time.

import * as THREE from 'three';
import { TEX } from './textures.js';

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
const roomLights = new Set();    // all currently-loaded room PointLights
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

// PBR materials sharing the procedural texture sets from textures.js. Each room
// gets its own geometry (built at real world dimensions) with UVs scaled so the
// textures tile at a fixed real-world rate instead of stretching per room.
const sharedMats = {
  floor: new THREE.MeshStandardMaterial({
    map: TEX.carpet.map,
    normalMap: TEX.carpet.normalMap,
    roughnessMap: TEX.carpet.roughnessMap,
    roughness: 1.0, metalness: 0.0,
  }),
  ceiling: new THREE.MeshStandardMaterial({
    map: TEX.ceiling.map,
    normalMap: TEX.ceiling.normalMap,
    roughnessMap: TEX.ceiling.roughnessMap,
    roughness: 0.9, metalness: 0.0,
  }),
  wall: new THREE.MeshStandardMaterial({
    map: TEX.wallpaper.map,
    normalMap: TEX.wallpaper.normalMap,
    roughnessMap: TEX.wallpaper.roughnessMap,
    roughness: 0.85, metalness: 0.0,
    side: THREE.FrontSide,
  }),
  fixture: new THREE.MeshStandardMaterial({
    color: 0xfff4c8, emissive: 0xfff1c0, emissiveIntensity: 2.4,
    roughness: 0.4, metalness: 0.0,
  }),
};
sharedMats.wall.normalScale = new THREE.Vector2(0.8, 0.8);
sharedMats.floor.normalScale = new THREE.Vector2(1.0, 1.0);
sharedMats.ceiling.normalScale = new THREE.Vector2(0.6, 0.6);

// Build a plane at real (w, h) world dimensions with UVs that repeat every
// `tile` world units, so a shared tiling texture reads at a consistent scale.
function makePlane(w, h, tile) {
  const geom = new THREE.PlaneGeometry(w, h);
  const uv = geom.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (h / tile));
  }
  uv.needsUpdate = true;
  return geom;
}

const FLOOR_TILE = 3.0;     // world units per carpet repeat
const WALL_TILE = 3.0;      // world units per wallpaper repeat
const CEIL_TILE = 4.0;      // world units per ceiling-tile-pair repeat
const BASE_LIGHT = 30;      // candela for a healthy room light (physical units)

function buildRoomMeshes(room) {
  const group = new THREE.Group();
  const wx = room.x * CONFIG.TILE;
  const wz = room.z * CONFIG.TILE;
  const ww = room.w * CONFIG.TILE;
  const wh = room.h * CONFIG.TILE;

  // floor
  const floor = new THREE.Mesh(makePlane(ww, wh, FLOOR_TILE), sharedMats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(wx + ww / 2, 0, wz + wh / 2);
  floor.receiveShadow = true;
  group.add(floor);

  // ceiling
  const ceiling = new THREE.Mesh(makePlane(ww, wh, CEIL_TILE), sharedMats.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(wx + ww / 2, CONFIG.WALL_H, wz + wh / 2);
  ceiling.receiveShadow = true;
  group.add(ceiling);

  // walls (4)
  const wMat = sharedMats.wall;
  const makeWall = (sx, sz, sw, rotY) => {
    const m = new THREE.Mesh(makePlane(sw, CONFIG.WALL_H, WALL_TILE), wMat);
    m.position.set(sx, CONFIG.WALL_H / 2, sz);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  // north (z = wz)
  makeWall(wx + ww / 2, wz, ww, 0);
  // south (z = wz + wh)
  makeWall(wx + ww / 2, wz + wh, ww, Math.PI);
  // west (x = wx)
  makeWall(wx, wz + wh / 2, wh, -Math.PI / 2);
  // east (x = wx + ww)
  makeWall(wx + ww, wz + wh / 2, wh, Math.PI / 2);

  // light fixture on ceiling — emissive so the bloom pass makes it glow.
  // Flicker rooms get their own material so their glow can pulse independently.
  const fxMat = room.lightFlicker ? sharedMats.fixture.clone() : sharedMats.fixture;
  const lightFixture = new THREE.Mesh(
    new THREE.BoxGeometry(CONFIG.TILE * 0.9, 0.12, CONFIG.TILE * 0.32),
    fxMat
  );
  if (room.lightFlicker) lightFixture.userData.ownMaterial = true;
  lightFixture.position.set(wx + ww / 2, CONFIG.WALL_H - 0.06, wz + wh / 2);
  group.add(lightFixture);

  // point light for this room. Only the few nearest the player stay enabled
  // each frame (see updateLights) so the light count never tanks the GPU.
  const baseI = room.lightFlicker ? BASE_LIGHT * 0.45 : BASE_LIGHT;
  const light = new THREE.PointLight(0xffe6a4, baseI, CONFIG.TILE * 9, 2.0);
  light.position.set(wx + ww / 2, CONFIG.WALL_H - 0.5, wz + wh / 2);
  light.userData = {
    isRoomLight: true,
    baseIntensity: baseI,
    flicker: !!room.lightFlicker,
    seed: room.lightSeed,
    fixture: lightFixture,
  };
  group.add(light);
  roomLights.add(light);

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
    // Geometries are per-room (built with custom UVs), so dispose them.
    // Materials and textures are shared across all rooms — leave them.
    if (o.geometry) o.geometry.dispose();
    if (o.userData?.ownMaterial && o.material) o.material.dispose();
    if (o.isPointLight) {
      roomLights.delete(o);
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
  // Update flickering fluorescent tubes — occasional sharp dropouts plus a
  // constant low buzz, and drive the emissive fixture so the bloom flickers too.
  const t = time / 1000;
  for (const l of roomLights) {
    if (!l.userData.flicker) continue;
    const seed = l.userData.seed;
    const base = l.userData.baseIntensity;
    const s = t + seed * 0.001;
    const buzz = 0.85 + 0.15 * Math.sin(s * 47.0);
    const drop = Math.sin(s * 13.0) * Math.sin(s * 7.3) > 0.92 ? 0.15 : 1.0;
    const k = buzz * drop;
    l.intensity = base * k;
    // flicker the tube's own glow too (per-room cloned material)
    const fx = l.userData.fixture;
    if (fx && fx.userData.ownMaterial) fx.material.emissiveIntensity = 2.4 * k;
  }
}

// Forward rendering evaluates EVERY visible light for every lit pixel, so a few
// hundred room lights tank the frame rate with PBR materials. Each frame we keep
// only the handful nearest the player switched on and hide the rest — they're in
// fog/darkness anyway. This is the single most important perf lever.
const MAX_VISIBLE_LIGHTS = 7;
const _lightBuf = [];
export function updateLights(playerPos) {
  _lightBuf.length = 0;
  for (const l of roomLights) {
    const dx = l.position.x - playerPos.x;
    const dz = l.position.z - playerPos.z;
    _lightBuf.push([dx * dx + dz * dz, l]);
  }
  _lightBuf.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < _lightBuf.length; i++) {
    _lightBuf[i][1].visible = i < MAX_VISIBLE_LIGHTS;
  }
}

// ---- Collision ---------------------------------------------------------------

// The collider boxes are the WALKABLE room/corridor volumes. A position is valid
// only while it stays inside that union; stepping into the void between rooms is
// what a "wall" is. We resolve X then Z separately so you slide along walls, and
// test the leading edge of the player so you stop just short of the void.
function walkableAt(x, z) {
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i].box;
    if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) return true;
  }
  return false;
}

export function resolveCollision(prev, next, halfWidth, halfHeight) {
  // X axis — check the leading edge in the direction of travel.
  if (next.x !== prev.x) {
    const edgeX = next.x + Math.sign(next.x - prev.x) * halfWidth;
    if (!walkableAt(edgeX, prev.z)) next.x = prev.x;
  }
  // Z axis
  if (next.z !== prev.z) {
    const edgeZ = next.z + Math.sign(next.z - prev.z) * halfWidth;
    if (!walkableAt(next.x, edgeZ)) next.z = prev.z;
  }

  // Floor: y=0 wherever we're standing inside a room, otherwise we're over void.
  const floorY = walkableAt(next.x, next.z) ? 0 : -Infinity;
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
