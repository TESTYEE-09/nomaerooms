// Decorative objects placed procedurally throughout the Backrooms.
// Uses procedural geometry (boxes, cylinders) with fallback to Sketchfab models
// if a Sketchfab API key is configured via VITE_SKETCHFAB_API_KEY.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { hash2 } from '../core/utils.js';
import { CELL, CHUNK_SIZE, CHUNK_CELLS } from '../core/config.js';
import * as gen from './generator.js';

const SKETCHFAB_API_KEY = '84d6a90e9b714fc59e27f54f38e2b275';
const SKETCHFAB_DOWNLOAD_URL = 'https://api.sketchfab.com/v3/models';

// Replace UIDs with real Sketchfab model IDs.
// Search sketchfab.com for "office chair", "filing cabinet", "vending machine" etc.
// Click a model → the UID is in the URL: sketchfab.com/3d-models/abc123def456
const SKETCHFAB_CATALOG = [
  // { uid: 'abc123def456', name: 'office-chair' },
  // { uid: '789ghi012jkl', name: 'desk' },
  // { uid: '345mno678pqr', name: 'filing-cabinet' },
  // { uid: '901stu234vwx', name: 'vending-machine' },
];

const OBJECT_DENSITY = 0.12; // not used directly; see pickObjectType for effective density

// -------- Realistic materials with wear and tear --------

function wornMat(baseColor, roughness, metalness, wearAmount = 0.15) {
  const c = new THREE.Color(baseColor);
  // subtract a bit of saturation/variance for realism
  return new THREE.MeshStandardMaterial({
    color: c,
    roughness: roughness + (Math.random() - 0.5) * wearAmount * 0.3,
    metalness: Math.max(0, metalness + (Math.random() - 0.5) * wearAmount),
  });
}

const woodMat = (c) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.7 + Math.random() * 0.15, metalness: 0.0,
});
const metalMat = (c) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.35 + Math.random() * 0.2, metalness: 0.6,
});
const plasticMat = (c) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.55 + Math.random() * 0.2, metalness: 0.0,
});
const fabricMat = (c) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.9, metalness: 0.0,
});
const dirtyPlasticMat = (c) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.7, metalness: 0.0,
});

// -------- Office Chair (more detailed) --------
function createOfficeChair() {
  const g = new THREE.Group();
  const frameMat = metalMat(0x3a3a3a);
  const seatMat = fabricMat(0x1a1a2e);
  const wheelMat = dirtyPlasticMat(0x1a1a1a);

  // 5-wheel base
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.14), frameMat);
    arm.position.set(Math.sin(a) * 0.15, 0.01, Math.cos(a) * 0.15);
    arm.rotation.y = -a;
    g.add(arm);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.015, 5), wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(Math.sin(a) * 0.22, 0.01, Math.cos(a) * 0.22);
    g.add(wheel);
  }

  // center hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.03, 6), frameMat);
  hub.position.y = 0.015;
  g.add(hub);

  // gas cylinder
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.35, 6), metalMat(0x888888));
  cyl.position.y = 0.2;
  g.add(cyl);

  // seat cover
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 10), seatMat);
  seat.position.y = 0.38;
  g.add(seat);

  // seat cushion
  const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.03, 10), seatMat);
  cushion.position.y = 0.41;
  cushion.scale.y = 0.5;
  g.add(cushion);

  // armrests
  for (const side of [-1, 1]) {
    const armPost = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.15, 0.025), dirtyPlasticMat(0x222222));
    armPost.position.set(side * 0.22, 0.48, -0.02);
    g.add(armPost);
    const armPad = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.1), seatMat);
    armPad.position.set(side * 0.22, 0.55, -0.02);
    g.add(armPad);
  }

  // backrest frame
  const backFrame = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.22, 0.005), frameMat);
  backFrame.position.set(0, 0.62, -0.12);
  g.add(backFrame);
  // backrest cushion
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.035), seatMat);
  back.position.set(0, 0.62, -0.14);
  g.add(back);

  return g;
}

// -------- Desk (more detailed with edge trim) --------
function createDesk() {
  const g = new THREE.Group();
  const desktopMat = woodMat(0x6a5238);
  const legMat = metalMat(0x5a5a5a);

  // tabletop with bevel edge
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.5), desktopMat);
  top.position.y = 0.72;
  g.add(top);

  // edge trim
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.01, 0.025), woodMat(0x4a3828));
  trim.position.set(0, 0.74, 0.25);
  g.add(trim);
  const trim2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.01, 0.025), woodMat(0x4a3828));
  trim2.position.set(0, 0.74, -0.25);
  g.add(trim2);
  const trim3 = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.01, 0.5), woodMat(0x4a3828));
  trim3.position.set(0.45, 0.74, 0);
  g.add(trim3);
  const trim4 = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.01, 0.5), woodMat(0x4a3828));
  trim4.position.set(-0.45, 0.74, 0);
  g.add(trim4);

  // 4 legs with crossbar
  for (const [dx, dz] of [[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.7, 0.025), legMat);
    leg.position.set(dx, 0.35, dz);
    g.add(leg);
  }

  // crossbar
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.015, 0.015), legMat);
  bar.position.set(0, 0.25, -0.22);
  g.add(bar);
  const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.015, 0.015), legMat);
  bar2.position.set(0, 0.25, 0.22);
  g.add(bar2);

  return g;
}

// -------- Filing Cabinet (more detailed with drawers) --------
function createFilingCabinet() {
  const g = new THREE.Group();
  const bodyMat = metalMat(0x5a6a5a);
  const handleMat = metalMat(0x3a3a3a);
  const labelMat = new THREE.MeshStandardMaterial({ color: 0xd4c8a0, roughness: 0.6 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.75, 0.45), bodyMat);
  body.position.y = 0.375;
  g.add(body);

  // drawer fronts
  for (let i = 0; i < 3; i++) {
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.01), bodyMat);
    drawer.position.set(0, 0.15 + i * 0.22, 0.225);
    g.add(drawer);
    // handle
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4), handleMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(0, 0.15 + i * 0.22, 0.235);
    g.add(handle);
    // label
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.005), labelMat);
    label.position.set(0, 0.15 + i * 0.22 + 0.06, 0.232);
    g.add(label);
  }

  return g;
}

// -------- Box (reinforced with tape detail) --------
function createBox() {
  const g = new THREE.Group();
  const sizes = [
    [0.35, 0.28, 0.3],
    [0.3, 0.22, 0.38],
    [0.38, 0.32, 0.28],
    [0.25, 0.3, 0.25],
    [0.4, 0.2, 0.35],
  ];
  const s = sizes[(Math.random() * sizes.length) | 0];
  const shade = 0x6a + ((Math.random() * 0x40) | 0);
  const c = (shade << 16) | (shade << 8) | (shade * 0.7);
  const boxMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0xc8b88a, roughness: 0.5 });

  const box = new THREE.Mesh(new THREE.BoxGeometry(...s), boxMat);
  box.position.y = s[1] / 2;
  box.rotation.y = Math.random() * Math.PI;
  g.add(box);

  // tape strips
  const tw = s[0] * 0.4, td = s[2] * 0.4;
  const tape1 = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.005, 0.02), tapeMat);
  tape1.position.set(0, s[1] / 2, s[2] / 2 + 0.005);
  tape1.rotation.y = box.rotation.y;
  g.add(tape1);
  const tape2 = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.005, 0.02), tapeMat);
  tape2.position.set(0, s[1] / 2, -s[2] / 2 - 0.005);
  tape2.rotation.y = box.rotation.y;
  g.add(tape2);

  return g;
}

// -------- Vending Machine (more detailed) --------
function createVendingMachine() {
  const g = new THREE.Group();
  const bodyMat = metalMat(0x3a5a7a);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88bbee, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35,
  });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x88ddff });
  const darkPlastic = dirtyPlasticMat(0x222222);

  // main body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.4, 0.4), bodyMat);
  body.position.y = 0.7;
  g.add(body);

  // top sign panel
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.02), glowMat);
  sign.position.set(0, 1.3, 0.21);
  g.add(sign);

  // glass front (slightly recessed)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.02), glassMat);
  glass.position.set(0, 0.9, 0.21);
  g.add(glass);

  // product rows (simulated with small colored blocks behind glass)
  const prodMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 });
  const colors = [0xcc4444, 0x44aa44, 0x4444cc, 0xccaa44, 0xcc44aa, 0x44cccc];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const prod = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.07, 0.02), prodMat(colors[(row * 4 + col) % colors.length]));
      prod.position.set(-0.16 + col * 0.1, 0.7 + row * 0.15, 0.2);
      g.add(prod);
    }
  }

  // selection panel
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.01), darkPlastic);
  panel.position.set(0, 0.55, 0.21);
  g.add(panel);

  // buttons
  const btnMat = new THREE.MeshStandardMaterial({ color: 0xcc3333 });
  for (let i = 0; i < 6; i++) {
    const btn = new THREE.Mesh(new THREE.CircleGeometry(0.012, 6), btnMat);
    btn.position.set(-0.07 + (i % 3) * 0.07, 0.56 - Math.floor(i / 3) * 0.04, 0.22);
    g.add(btn);
  }

  // coin slot / dispenser area
  const dispenser = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.02), darkPlastic);
  dispenser.position.set(0, 0.4, 0.21);
  g.add(dispenser);

  return g;
}

// -------- Water Cooler (more detailed) --------
function createWaterCooler() {
  const g = new THREE.Group();
  const whiteMat = plasticMat(0xe0e0e0);
  const blueMat = new THREE.MeshStandardMaterial({
    color: 0x4488cc, roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.5,
  });
  const darkMat = dirtyPlasticMat(0x222222);
  const chromeMat = metalMat(0xcccccc);

  // base cabinet
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.3), whiteMat);
  base.position.y = 0.45;
  g.add(base);

  // drip tray
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.12), chromeMat);
  tray.position.set(0, 0.65, 0.12);
  g.add(tray);

  // water jug
  const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.3, 10), blueMat);
  jug.position.y = 0.85;
  g.add(jug);
  // jug cap
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.02, 8), whiteMat);
  cap.position.y = 1.0;
  g.add(cap);

  // top cover
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.15), whiteMat);
  top.position.set(0, 0.7, 0);
  g.add(top);

  // faucet spigots
  for (const side of [-1, 1]) {
    const spigot = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.03, 5), chromeMat);
    spigot.rotation.z = 0.3;
    spigot.position.set(side * 0.08, 0.72, 0.12);
    g.add(spigot);
  }

  return g;
}

const BUILDERS = [createOfficeChair, createDesk, createFilingCabinet, createBox, createVendingMachine, createWaterCooler];

function pickObjectType(cx, cz, seed) {
  const r = hash2(cx, cz, seed);
  // Halls get larger objects; corridors get smaller ones
  const isHallCell = gen.isHall(cx, cz);
  if (isHallCell) {
    if (r < 0.45) return null;
    if (r < 0.58) return 'desk';
    if (r < 0.65) return 'chair';
    if (r < 0.72) return 'filing';
    if (r < 0.78) return 'vending';
    return 'box';
  }
  if (r < 0.94) return null;
  if (r < 0.97) return 'chair';
  if (r < 0.99) return 'box';
  return null;
}

function getBuilder(type) {
  switch (type) {
    case 'chair': return createOfficeChair;
    case 'desk': return createDesk;
    case 'filing': return createFilingCabinet;
    case 'box': return createBox;
    case 'vending': return createVendingMachine;
    case 'cooler': return createWaterCooler;
    default: return null;
  }
}

function rotateSnap(angle) {
  const snaps = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -Math.PI / 4, -Math.PI / 2, -3 * Math.PI / 4];
  return snaps.reduce((p, c) => (Math.abs(angle - c) < Math.abs(angle - p) ? c : p));
}

// ---- Sketchfab integration ----

const _sketchfabCache = new Map();

async function loadSketchfabModel(uid) {
  if (_sketchfabCache.has(uid)) return _sketchfabCache.get(uid);
  if (!SKETCHFAB_API_KEY) return null;

  try {
    const dlRes = await fetch(`${SKETCHFAB_DOWNLOAD_URL}/${uid}/download?api_key=${SKETCHFAB_API_KEY}`);
    if (!dlRes.ok) {
      console.warn(`[objects] Sketchfab download failed for ${uid}: ${dlRes.status}`);
      return null;
    }
    const dlData = await dlRes.json();
    const gltfUrl = dlData?.gltf?.url || dlData?.resources?.gltf?.url;
    if (!gltfUrl) {
      console.warn(`[objects] No GLTF URL in Sketchfab response for ${uid}`);
      return null;
    }

    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.load(gltfUrl, resolve, undefined, reject);
    });

    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    _sketchfabCache.set(uid, gltf.scene);
    return gltf.scene;
  } catch (e) {
    console.warn(`[objects] Sketchfab load error for ${uid}:`, e);
    return null;
  }
}

export class ObjectPlacer {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    this._cache = new Map();
    this._pendingLoads = new Set();
    this._seed = 0x5eed;
  }

  setSeed(seed) { this._seed = seed; }

  async loadSketchfabModels() {
    if (!SKETCHFAB_API_KEY || !SKETCHFAB_CATALOG.length) return;
    const promises = SKETCHFAB_CATALOG.map(async (entry) => {
      const model = await loadSketchfabModel(entry.uid);
      if (model) {
        this._cache.set(entry.uid, model);
        console.log(`[objects] Loaded Sketchfab model: ${entry.name}`);
      }
    });
    await Promise.allSettled(promises);
  }

  buildChunkObjects(ccx, ccz) {
    const seed = this._seed;
    const x0 = ccx * CHUNK_CELLS, z0 = ccz * CHUNK_CELLS;
    const wx0 = ccx * CHUNK_SIZE, wz0 = ccz * CHUNK_SIZE;
    const group = new THREE.Group();
    const placed = [];

    for (let lz = 0; lz < CHUNK_CELLS; lz++) {
      for (let lx = 0; lx < CHUNK_CELLS; lx++) {
        const cx = x0 + lx, cz = z0 + lz;
        const midX = (cx + 0.5) * CELL, midZ = (cz + 0.5) * CELL;

        if (gen.pillar(cx, cz)) continue;

        const type = pickObjectType(cx, cz, seed);
        if (!type) continue;

        const builder = getBuilder(type);
        if (!builder) continue;

        const obj = builder();
        const margin = 0.25;
        const angle = hash2(cx * 7, cz * 13, seed) * Math.PI * 2;
        obj.rotation.y = rotateSnap(angle);

        // Offset from center so objects aren't perfectly aligned
        const offX = (hash2(cx, cz, seed + 0x111) - 0.5) * (CELL * 0.5 - margin);
        const offZ = (hash2(cx, cz + 99, seed + 0x222) - 0.5) * (CELL * 0.5 - margin);
        obj.position.set(midX + offX, 0, midZ + offZ);

        // Tint variation
        obj.traverse((child) => {
          if (child.isMesh && child.material && child.material.color) {
            const tintAmount = 0.85 + hash2(cx, cz, 0x333) * 0.3;
            child.material.color.multiplyScalar(tintAmount);
          }
        });

        group.add(obj);
        placed.push({ x: midX, z: midZ, type });
      }
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
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      }
    });
    this.objects.splice(idx, 1);
  }

  clear() {
    for (const o of [...this.objects]) {
      this.scene.remove(o.group);
    }
    this.objects = [];
  }
}
