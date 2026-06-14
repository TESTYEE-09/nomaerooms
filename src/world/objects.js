import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2 } from '../core/utils.js';
import { CELL, CHUNK_SIZE, CHUNK_CELLS } from '../core/config.js';
import * as gen from './generator.js';

// Furniture used to be hundreds of individual meshes per chunk, each with its
// own material — thousands of draw calls, the main FPS sink. Instead every
// chunk's furniture is baked into two merged meshes (matte + metal) that share
// these materials; per-mesh colour is carried in a vertex-colour attribute.
const SHARED = {
  matte: new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.0, vertexColors: true }),
  metal: new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.6, vertexColors: true }),
};
const SHARED_SET = new Set([SHARED.matte, SHARED.metal]);

// Flatten a freshly-built furniture Group into per-bucket geometry lists, baking
// each mesh's (already tinted) colour into vertex colours so one material can
// draw the whole chunk. Disposes the temporary meshes' geometry + materials.
function bakeGroup(group, buckets) {
  group.updateMatrixWorld(true);
  group.traverse((m) => {
    if (!m.isMesh) return;
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    // keep only the attributes mergeGeometries needs to line up
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    const col = m.material.color || new THREE.Color(0x808080);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    const bucket = (m.material.metalness ?? 0) > 0.3 ? 'metal' : 'matte';
    (buckets[bucket] ||= []).push(geo);
    m.geometry.dispose();
    if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
    else m.material.dispose();
  });
}

const woodMat = (c) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.7 + Math.random() * 0.15, metalness: 0.0,
});
const metalMat = (c) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.4 + Math.random() * 0.2, metalness: 0.6,
});
const plasticMat = (c) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.6 + Math.random() * 0.2, metalness: 0.0,
});
const fabricMat = (c) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.9, metalness: 0.0,
});

function createOfficeChair() {
  const g = new THREE.Group();
  const s = 1.5;
  const frameMat = metalMat(0x3a3a3a);
  const seatMat = fabricMat(0x1a1a2e);
  const wheelMat = plasticMat(0x1a1a1a);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04 * s, 0.02 * s, 0.14 * s), frameMat);
    arm.position.set(Math.sin(a) * 0.15 * s, 0.01 * s, Math.cos(a) * 0.15 * s);
    arm.rotation.y = -a;
    g.add(arm);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * s, 0.025 * s, 0.015 * s, 5), wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(Math.sin(a) * 0.22 * s, 0.01 * s, Math.cos(a) * 0.22 * s);
    g.add(wheel);
  }

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.08 * s, 0.03 * s, 6), frameMat);
  hub.position.y = 0.015 * s;
  g.add(hub);

  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.025 * s, 0.03 * s, 0.35 * s, 6), metalMat(0x888888));
  cyl.position.y = 0.2 * s;
  g.add(cyl);

  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.22 * s, 0.06 * s, 10), seatMat);
  seat.position.y = 0.38 * s;
  g.add(seat);

  for (const side of [-1, 1]) {
    const armPost = new THREE.Mesh(new THREE.BoxGeometry(0.025 * s, 0.15 * s, 0.025 * s), plasticMat(0x222222));
    armPost.position.set(side * 0.22 * s, 0.48 * s, -0.02 * s);
    g.add(armPost);
    const armPad = new THREE.Mesh(new THREE.BoxGeometry(0.04 * s, 0.015 * s, 0.1 * s), seatMat);
    armPad.position.set(side * 0.22 * s, 0.55 * s, -0.02 * s);
    g.add(armPad);
  }

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.18 * s, 0.18 * s, 0.035 * s), seatMat);
  back.position.set(0, 0.62 * s, -0.14 * s);
  g.add(back);

  return g;
}

function createDesk() {
  const g = new THREE.Group();
  const s = 1.5;
  const desktopMat = woodMat(0x6a5238);
  const legMat = metalMat(0x5a5a5a);

  const top = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 0.035 * s, 0.5 * s), desktopMat);
  top.position.y = 0.72 * s;
  g.add(top);

  for (const [dx, dz] of [[-0.4 * s, -0.22 * s], [0.4 * s, -0.22 * s], [-0.4 * s, 0.22 * s], [0.4 * s, 0.22 * s]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.025 * s, 0.7 * s, 0.025 * s), legMat);
    leg.position.set(dx, 0.35 * s, dz);
    g.add(leg);
  }

  return g;
}

function createFilingCabinet() {
  const g = new THREE.Group();
  const s = 1.5;
  const bodyMat = metalMat(0x5a6a5a);
  const handleMat = metalMat(0x3a3a3a);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.35 * s, 0.75 * s, 0.45 * s), bodyMat);
  body.position.y = 0.375 * s;
  g.add(body);

  for (let i = 0; i < 3; i++) {
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.3 * s, 0.2 * s, 0.01 * s), bodyMat);
    drawer.position.set(0, 0.15 * s + i * 0.22 * s, 0.225 * s);
    g.add(drawer);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008 * s, 0.008 * s, 0.06 * s, 4), handleMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(0, 0.15 * s + i * 0.22 * s, 0.235 * s);
    g.add(handle);
  }

  return g;
}

function createLamp() {
  const g = new THREE.Group();
  const s = 1.5;
  const poleMat = metalMat(0x4a4a4a);
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0x2a3a2a, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.1 * s, 0.025 * s, 8), poleMat);
  base.position.y = 0.015 * s;
  g.add(base);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015 * s, 0.02 * s, 0.6 * s, 6), poleMat);
  pole.position.y = 0.35 * s;
  g.add(pole);

  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.12 * s, 0.15 * s, 8), shadeMat);
  shade.position.y = 0.7 * s;
  g.add(shade);

  return g;
}

function createShelf() {
  const g = new THREE.Group();
  const s = 1.5;
  const shelfMat = woodMat(0x5a4a3a);

  for (const [dx, dz] of [[-0.2 * s, -0.15 * s], [0.2 * s, -0.15 * s], [-0.2 * s, 0.15 * s], [0.2 * s, 0.15 * s]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02 * s, 0.6 * s, 0.02 * s), shelfMat);
    leg.position.set(dx, 0.3 * s, dz);
    g.add(leg);
  }

  for (let i = 0; i < 3; i++) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.45 * s, 0.015 * s, 0.35 * s), shelfMat);
    board.position.set(0, 0.05 * s + i * 0.2 * s, 0);
    g.add(board);
  }

  return g;
}

function createFlashlightPickup() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xccaa44, roughness: 0.6, metalness: 0.4 });
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.16, 6), bodyMat);
  body.position.y = 0.08;
  g.add(body);

  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.04, 6), bodyMat);
  head.position.y = 0.18;
  g.add(head);

  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 6), lensMat);
  lens.position.set(0, 0.2, 0.04);
  lens.rotation.x = -Math.PI / 2;
  g.add(lens);

  const glow = new THREE.PointLight(0xffdd88, 0.25, 1.2);
  glow.position.y = 0.2;
  g.add(glow);

  return g;
}

function createGunPickup() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.6 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.8, metalness: 0.0 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.4, metalness: 0.5 });
  const s = 2.5;
  g.scale.setScalar(s);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.12), bodyMat);
  body.position.y = 0.02;
  g.add(body);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.16, 6), bodyMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, 0.08);
  g.add(barrel);

  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8), accentMat);
  cyl.rotation.x = Math.PI / 2;
  cyl.position.set(0, 0.02, 0.005);
  g.add(cyl);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.025), gripMat);
  grip.position.set(0, -0.015, -0.04);
  g.add(grip);

  const glow = new THREE.PointLight(0x6666aa, 0.5, 3.0);
  glow.position.set(0, 0.04, 0.06);
  g.add(glow);

  return g;
}

const BUILDERS = [
  createOfficeChair, createDesk, createFilingCabinet,
  createLamp, createShelf,
];

function pickObjectType(cx, cz, seed) {
  const r = hash2(cx, cz, seed);
  const isHallCell = gen.isHall(cx, cz);
  if (isHallCell) {
    if (r < 0.55) return null;
    if (r < 0.65) return 'desk';
    if (r < 0.74) return 'chair';
    if (r < 0.82) return 'filing';
    if (r < 0.89) return 'shelf';
    if (r < 0.93) return 'lamp';
    if (r < 0.96) return 'flashlight';
    if (r < 0.98) return 'gun';
    return null;
  }
  if (r < 0.95) return null;
  if (r < 0.975) return 'chair';
  return 'lamp';
}

function getBuilder(type) {
  switch (type) {
    case 'chair': return createOfficeChair;
    case 'desk': return createDesk;
    case 'filing': return createFilingCabinet;
    case 'lamp': return createLamp;
    case 'shelf': return createShelf;
    case 'flashlight': return createFlashlightPickup;
    case 'gun': return createGunPickup;
    default: return null;
  }
}

export class ObjectPlacer {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    this.flashlights = []; // { mesh, x, z, collected, cellKey }
    this._collectedFlashlights = new Set(); // cellKey strings
    this.guns = []; // { mesh, x, z, collected, cellKey }
    this._collectedGuns = new Set(); // cellKey strings
    this._seed = 0x5eed;
  }

  setSeed(seed) { this._seed = seed; }

  buildChunkObjects(ccx, ccz) {
    const seed = this._seed;
    const x0 = ccx * CHUNK_CELLS, z0 = ccz * CHUNK_CELLS;
    const group = new THREE.Group();
    const placed = [];
    const buckets = {};

    for (let lz = 0; lz < CHUNK_CELLS; lz++) {
      for (let lx = 0; lx < CHUNK_CELLS; lx++) {
        const cx = x0 + lx, cz = z0 + lz;
        const midX = (cx + 0.5) * CELL, midZ = (cz + 0.5) * CELL;

        if (gen.pillar(cx, cz)) continue;

        const type = pickObjectType(cx, cz, seed);
        if (!type) continue;

        // flashlight handling — tracked separately from furniture
        if (type === 'flashlight') {
          const cellKey = cx + ',' + cz;
          if (this._collectedFlashlights.has(cellKey)) continue;
          const obj = createFlashlightPickup();
          const r = hash2(cx * 7, cz * 13, seed);
          const snaps = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -Math.PI / 4, -Math.PI / 2, -3 * Math.PI / 4];
          const angle = r * Math.PI * 2;
          obj.rotation.y = snaps.reduce((p, c) => (Math.abs(angle - c) < Math.abs(angle - p) ? c : p));
          const margin = 0.2;
          const offX = (hash2(cx, cz, seed + 0x111) - 0.5) * (CELL * 0.5 - margin);
          const offZ = (hash2(cx, cz + 99, seed + 0x222) - 0.5) * (CELL * 0.5 - margin);
          obj.position.set(midX + offX, 0.02, midZ + offZ);
          this.scene.add(obj);
          this.flashlights.push({ mesh: obj, x: obj.position.x, z: obj.position.z, collected: false, cellKey });
          continue;
        }

        // gun handling — tracked separately like flashlights
        if (type === 'gun') {
          const cellKey = cx + ',' + cz;
          if (this._collectedGuns.has(cellKey)) continue;
          const obj = createGunPickup();
          const r = hash2(cx * 7, cz * 13, seed);
          const snaps = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -Math.PI / 4, -Math.PI / 2, -3 * Math.PI / 4];
          const angle = r * Math.PI * 2;
          obj.rotation.y = snaps.reduce((p, c) => (Math.abs(angle - c) < Math.abs(angle - p) ? c : p));
          const margin = 0.2;
          const offX = (hash2(cx, cz, seed + 0x111) - 0.5) * (CELL * 0.5 - margin);
          const offZ = (hash2(cx, cz + 99, seed + 0x222) - 0.5) * (CELL * 0.5 - margin);
          obj.position.set(midX + offX, 0.02, midZ + offZ);
          this.scene.add(obj);
          this.guns.push({ mesh: obj, x: obj.position.x, z: obj.position.z, collected: false, cellKey });
          continue;
        }

        const builder = getBuilder(type);
        if (!builder) continue;

        const obj = builder();
        const r = hash2(cx * 7, cz * 13, seed);

        // rotation
        const snaps = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -Math.PI / 4, -Math.PI / 2, -3 * Math.PI / 4];
        const angle = r * Math.PI * 2;
        obj.rotation.y = snaps.reduce((p, c) => (Math.abs(angle - c) < Math.abs(angle - p) ? c : p));

        // position offset from center
        const margin = 0.2;
        const offX = (hash2(cx, cz, seed + 0x111) - 0.5) * (CELL * 0.5 - margin);
        const offZ = (hash2(cx, cz + 99, seed + 0x222) - 0.5) * (CELL * 0.5 - margin);
        obj.position.set(midX + offX, 0, midZ + offZ);

        // wall clipping — subtle intersections
        const clipR = hash2(cx, cz, 0x444);
        if (clipR < 0.12) {
          obj.position.x += (hash2(cx, cz, 0x555) - 0.5) * CELL * 0.2;
          obj.position.z += (hash2(cx, cz, 0x666) - 0.5) * CELL * 0.2;
        }

        // ground clipping — subtle sink
        const sinkR = hash2(cx, cz, 0x777);
        if (sinkR < 0.1) {
          obj.position.y = -(hash2(cx, cz, 0x888)) * 0.1;
        }

        // distortion — subtle stretch
        const distortR = hash2(cx, cz, 0x999);
        if (distortR < 0.1) {
          const sx = 0.8 + hash2(cx, cz, 0xaaa) * 0.6;
          const sy = 0.8 + hash2(cx, cz, 0xbbb) * 0.6;
          const sz = 0.8 + hash2(cx, cz, 0xccc) * 0.6;
          obj.scale.set(sx, sy, sz);
        }

        // random tilt
        const tiltR = hash2(cx, cz, 0xddd);
        if (tiltR < 0.06) {
          obj.rotation.x = (hash2(cx, cz, 0xeee) - 0.5) * 0.25;
          obj.rotation.z = (hash2(cx, cz, 0xfff) - 0.5) * 0.25;
        }

        // tint
        obj.traverse((child) => {
          if (child.isMesh && child.material && child.material.color) {
            child.material.color.multiplyScalar(0.85 + hash2(cx, cz, 0x333) * 0.3);
          }
        });

        // bake this object's meshes into the chunk's merged buckets
        bakeGroup(obj, buckets);
        placed.push({ x: midX, z: midZ, type });
      }
    }

    // collapse each bucket into a single merged, shadow-casting mesh
    for (const key of Object.keys(buckets)) {
      const geos = buckets[key];
      if (!geos.length) continue;
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, SHARED[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    return { group, placed };
  }

  addChunk(ccx, ccz) {
    const { group, placed } = this.buildChunkObjects(ccx, ccz);
    this.scene.add(group);
    this.objects.push({ cx: ccx, cz: ccz, group, placed });
    return group;
  }

  removeChunk(ccx, ccz) {
    const idx = this.objects.findIndex((o) => o.cx === ccx && o.cz === ccz);
    if (idx === -1) return;
    const entry = this.objects[idx];
    this.scene.remove(entry.group);
    entry.group.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => { if (!SHARED_SET.has(m)) m.dispose(); });
        }
      }
    });
    this.objects.splice(idx, 1);

    const cx0 = ccx * CHUNK_CELLS, cz0 = ccz * CHUNK_CELLS;
    const removeInChunk = (arr) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const item = arr[i];
        if (item.collected) continue;
        const [cx, cz] = item.cellKey.split(',').map(Number);
        if (cx >= cx0 && cx < cx0 + CHUNK_CELLS && cz >= cz0 && cz < cz0 + CHUNK_CELLS) {
          this.scene.remove(item.mesh);
          arr.splice(i, 1);
        }
      }
    };
    removeInChunk(this.flashlights);
    removeInChunk(this.guns);
  }

  removeFlashlight(index) {
    const fl = this.flashlights[index];
    if (!fl) return;
    this.scene.remove(fl.mesh);
    this._collectedFlashlights.add(fl.cellKey);
    this.flashlights.splice(index, 1);
  }

  removeGun(index) {
    const fl = this.guns[index];
    if (!fl) return;
    this.scene.remove(fl.mesh);
    this._collectedGuns.add(fl.cellKey);
    this.guns.splice(index, 1);
  }

  clear() {
    for (const o of [...this.objects]) {
      this.scene.remove(o.group);
    }
    this.objects = [];
    for (const fl of this.flashlights) {
      this.scene.remove(fl.mesh);
    }
    this.flashlights = [];
    this._collectedFlashlights.clear();
    for (const fl of this.guns) {
      this.scene.remove(fl.mesh);
    }
    this.guns = [];
    this._collectedGuns.clear();
  }
}
