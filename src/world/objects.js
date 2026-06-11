// Decorative objects placed procedurally throughout the Backrooms.
// Uses procedural geometry (boxes, cylinders) with fallback to Sketchfab models
// if a Sketchfab API key is configured via VITE_SKETCHFAB_API_KEY.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { hash2 } from '../core/utils.js';
import { CELL, CHUNK_SIZE, CHUNK_CELLS } from '../core/config.js';
import * as gen from './generator.js';

const SKETCHFAB_API_KEY = import.meta.env?.VITE_SKETCHFAB_API_KEY;
const SKETCHFAB_DOWNLOAD_URL = 'https://api.sketchfab.com/v3/models';

const SKETCHFAB_CATALOG = [
  // 'uid' can be replaced with actual Sketchfab model UIDs
  // Example: { uid: 'abc123', name: 'office-chair' }
  // These are placeholder UIDs — user should replace with real ones
];

const OBJECT_DENSITY = 0.12;

// Procedural object definitions
function createOfficeChair() {
  const g = new THREE.Group();
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.3 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.85 });

  // base with wheels (5-point star simplified to cylinder)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.05, 5), darkMat);
  base.position.y = 0.025;
  g.add(base);

  // center pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6), darkMat);
  pole.position.y = 0.3;
  g.add(pole);

  // seat
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.08, 8), seatMat);
  seat.position.y = 0.55;
  g.add(seat);

  // backrest
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.04), seatMat);
  back.position.set(0, 0.7, -0.13);
  g.add(back);

  return g;
}

function createDesk() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x5c4a32, roughness: 0.7, metalness: 0.05 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 0.4, metalness: 0.6 });

  // tabletop
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.5), mat);
  top.position.y = 0.72;
  g.add(top);

  // legs
  for (const [dx, dz] of [[-0.4, -0.2], [0.4, -0.2], [-0.4, 0.2], [0.4, 0.2]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.7, 4), metalMat);
    leg.position.set(dx, 0.35, dz);
    g.add(leg);
  }

  return g;
}

function createFilingCabinet() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6a7a6a, roughness: 0.5, metalness: 0.4 });
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.3, metalness: 0.7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.75, 0.45), mat);
  body.position.y = 0.375;
  g.add(body);

  // drawer lines
  for (let i = 0; i < 3; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.005, 0.02), handleMat);
    line.position.set(0, 0.15 + i * 0.22, 0.23);
    g.add(line);
  }

  return g;
}

function createBox() {
  const g = new THREE.Group();
  const sizes = [
    [0.3, 0.25, 0.3],
    [0.25, 0.2, 0.35],
    [0.35, 0.3, 0.25],
    [0.22, 0.28, 0.22],
  ];
  const s = sizes[(Math.random() * sizes.length) | 0];
  const shade = 0x5a + ((Math.random() * 0x30) | 0);
  const c = (shade << 16) | (shade << 8) | shade;
  const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(...s), mat);
  box.position.y = s[1] / 2;
  box.rotation.y = Math.random() * Math.PI;
  g.add(box);
  return g;
}

function createVendingMachine() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a5a7a, roughness: 0.4, metalness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88bbee, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.4,
  });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x88ddff });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.4, 0.4), bodyMat);
  body.position.y = 0.7;
  g.add(body);

  // glass front
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.02), glassMat);
  glass.position.set(0, 0.9, 0.21);
  g.add(glass);

  // glow panel
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.02), glowMat);
  glow.position.set(0, 1.25, 0.21);
  g.add(glow);

  // selection buttons
  const btnMat = new THREE.MeshStandardMaterial({ color: 0xcc3333 });
  for (let i = 0; i < 4; i++) {
    const btn = new THREE.Mesh(new THREE.CircleGeometry(0.02, 6), btnMat);
    btn.position.set(-0.12 + i * 0.08, 1.05, 0.21);
    g.add(btn);
  }

  return g;
}

function createWaterCooler() {
  const g = new THREE.Group();
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.3 });
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x4488cc, roughness: 0.2, transparent: true, opacity: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.5, 8), whiteMat);
  body.position.y = 0.6;
  g.add(body);

  const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.25, 8), blueMat);
  jug.position.y = 0.95;
  g.add(jug);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.08, 8), darkMat);
  base.position.y = 0.35;
  g.add(base);

  return g;
}

const BUILDERS = [createOfficeChair, createDesk, createFilingCabinet, createBox, createVendingMachine, createWaterCooler];

function pickObjectType(cx, cz, seed) {
  const r = hash2(cx, cz, seed);
  // Halls get larger objects; corridors get smaller ones
  const isHallCell = gen.isHall(cx, cz);
  if (isHallCell) {
    if (r < 0.2) return null;
    if (r < 0.35) return 'desk';
    if (r < 0.45) return 'chair';
    if (r < 0.58) return 'filing';
    if (r < 0.68) return 'vending';
    if (r < 0.76) return 'cooler';
    return 'box';
  }
  if (r < 0.88) return null; // corridors mostly empty
  if (r < 0.92) return 'chair';
  if (r < 0.96) return 'box';
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
