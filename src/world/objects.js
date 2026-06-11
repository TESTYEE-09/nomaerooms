import * as THREE from 'three';
import { hash2 } from '../core/utils.js';
import { CELL, CHUNK_SIZE, CHUNK_CELLS } from '../core/config.js';
import * as gen from './generator.js';

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
  const frameMat = metalMat(0x3a3a3a);
  const seatMat = fabricMat(0x1a1a2e);
  const wheelMat = plasticMat(0x1a1a1a);

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

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.03, 6), frameMat);
  hub.position.y = 0.015;
  g.add(hub);

  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.35, 6), metalMat(0x888888));
  cyl.position.y = 0.2;
  g.add(cyl);

  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 10), seatMat);
  seat.position.y = 0.38;
  g.add(seat);

  for (const side of [-1, 1]) {
    const armPost = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.15, 0.025), plasticMat(0x222222));
    armPost.position.set(side * 0.22, 0.48, -0.02);
    g.add(armPost);
    const armPad = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.1), seatMat);
    armPad.position.set(side * 0.22, 0.55, -0.02);
    g.add(armPad);
  }

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.035), seatMat);
  back.position.set(0, 0.62, -0.14);
  g.add(back);

  return g;
}

function createDesk() {
  const g = new THREE.Group();
  const desktopMat = woodMat(0x6a5238);
  const legMat = metalMat(0x5a5a5a);

  const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.5), desktopMat);
  top.position.y = 0.72;
  g.add(top);

  for (const [dx, dz] of [[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.7, 0.025), legMat);
    leg.position.set(dx, 0.35, dz);
    g.add(leg);
  }

  return g;
}

function createFilingCabinet() {
  const g = new THREE.Group();
  const bodyMat = metalMat(0x5a6a5a);
  const handleMat = metalMat(0x3a3a3a);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.75, 0.45), bodyMat);
  body.position.y = 0.375;
  g.add(body);

  for (let i = 0; i < 3; i++) {
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.01), bodyMat);
    drawer.position.set(0, 0.15 + i * 0.22, 0.225);
    g.add(drawer);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4), handleMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(0, 0.15 + i * 0.22, 0.235);
    g.add(handle);
  }

  return g;
}

function createLamp() {
  const g = new THREE.Group();
  const poleMat = metalMat(0x4a4a4a);
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0x2a3a2a, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.025, 8), poleMat);
  base.position.y = 0.015;
  g.add(base);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.6, 6), poleMat);
  pole.position.y = 0.35;
  g.add(pole);

  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.15, 8), shadeMat);
  shade.position.y = 0.7;
  g.add(shade);

  return g;
}

function createShelf() {
  const g = new THREE.Group();
  const shelfMat = woodMat(0x5a4a3a);

  for (const [dx, dz] of [[-0.2, -0.15], [0.2, -0.15], [-0.2, 0.15], [0.2, 0.15]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.6, 0.02), shelfMat);
    leg.position.set(dx, 0.3, dz);
    g.add(leg);
  }

  for (let i = 0; i < 3; i++) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.015, 0.35), shelfMat);
    board.position.set(0, 0.05 + i * 0.2, 0);
    g.add(board);
  }

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
    if (r < 0.6) return null;
    if (r < 0.7) return 'desk';
    if (r < 0.78) return 'chair';
    if (r < 0.85) return 'filing';
    if (r < 0.92) return 'shelf';
    return 'lamp';
  }
  if (r < 0.97) return null;
  if (r < 0.985) return 'chair';
  return 'lamp';
}

function getBuilder(type) {
  switch (type) {
    case 'chair': return createOfficeChair;
    case 'desk': return createDesk;
    case 'filing': return createFilingCabinet;
    case 'lamp': return createLamp;
    case 'shelf': return createShelf;
    default: return null;
  }
}

export class ObjectPlacer {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    this._seed = 0x5eed;
  }

  setSeed(seed) { this._seed = seed; }

  buildChunkObjects(ccx, ccz) {
    const seed = this._seed;
    const x0 = ccx * CHUNK_CELLS, z0 = ccz * CHUNK_CELLS;
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

        // wall clipping — some objects slide into walls
        const clipR = hash2(cx, cz, 0x444);
        if (clipR < 0.25) {
          obj.position.x += (hash2(cx, cz, 0x555) - 0.5) * CELL * 0.4;
          obj.position.z += (hash2(cx, cz, 0x666) - 0.5) * CELL * 0.4;
        }

        // ground clipping — some objects sink into the floor
        const sinkR = hash2(cx, cz, 0x777);
        if (sinkR < 0.2) {
          obj.position.y = -(hash2(cx, cz, 0x888)) * 0.2;
        }

        // distortion — stretch/squash on random axes
        const distortR = hash2(cx, cz, 0x999);
        if (distortR < 0.18) {
          const sx = 0.5 + hash2(cx, cz, 0xaaa) * 1.5;
          const sy = 0.5 + hash2(cx, cz, 0xbbb) * 1.5;
          const sz = 0.5 + hash2(cx, cz, 0xccc) * 1.5;
          obj.scale.set(sx, sy, sz);
        }

        // random tilt
        const tiltR = hash2(cx, cz, 0xddd);
        if (tiltR < 0.12) {
          obj.rotation.x = (hash2(cx, cz, 0xeee) - 0.5) * 0.5;
          obj.rotation.z = (hash2(cx, cz, 0xfff) - 0.5) * 0.5;
        }

        // tint
        obj.traverse((child) => {
          if (child.isMesh && child.material && child.material.color) {
            child.material.color.multiplyScalar(0.85 + hash2(cx, cz, 0x333) * 0.3);
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
