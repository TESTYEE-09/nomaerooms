// The facility: a bounded industrial maze built in one pass from the seeded
// generator, offset far from the moon surface at FAC_OFF. Owns wall colliders,
// light fixtures (LightPool reads fixturesNear), the exit door, and the open
// cells scrap can spawn in.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, WALL_H, WALL_T, FAC_OFF, FAC_CELLS } from '../core/config.js';
import { mulberry32 } from '../core/utils.js';
import * as gen from './generator.js';

const FIXTURE_W = 1.35, FIXTURE_D = 0.42, FIXTURE_H = 0.09;

function wallBox(len, alongX, cx, cz) {
  const g = new THREE.BoxGeometry(alongX ? len : WALL_T, WALL_H, alongX ? WALL_T : len);
  const uv = g.attributes.uv;
  const normal = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ny = Math.abs(normal.getY(i));
    if (ny > 0.5) continue;
    const nx = Math.abs(normal.getX(i));
    const faceLen = (nx > 0.5) === alongX ? WALL_T : len;
    uv.setXY(i, uv.getX(i) * (faceLen / 2), uv.getY(i));
  }
  g.translate(cx, WALL_H / 2, cz);
  return g;
}

function pillarBox(cx, cz) {
  const g = new THREE.BoxGeometry(0.7, WALL_H, 0.7);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.35, uv.getY(i));
  g.translate(cx, WALL_H / 2, cz);
  return g;
}

export const cellToWorld = (x, z) => ({
  x: FAC_OFF.x + (x + 0.5) * CELL,
  z: FAC_OFF.z + (z + 0.5) * CELL,
});
export const worldToCell = (wx, wz) => ({
  x: Math.floor((wx - FAC_OFF.x) / CELL),
  z: Math.floor((wz - FAC_OFF.z) / CELL),
});

export class Facility {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.group = null;
    this.colliders = [];
    this.fixtures = [];
    this.openCells = [];     // [{x,z}] candidates for scrap / monster spawns
    this.entrance = null;    // world pos {x,z} just inside the exit door
    this.exitDoor = null;    // mesh, interactable
    this.built = false;
  }

  /** (Re)build the whole maze for the current generator seed. */
  build() {
    this.dispose();
    gen.setBounds(0, 0, FAC_CELLS - 1, FAC_CELLS - 1);

    const group = new THREE.Group();
    const wallGeos = [];
    this.colliders = [];
    this.fixtures = [];
    this.openCells = [];

    const addCollider = (cx, cz, hx, hz) => {
      this.colliders.push({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz });
    };

    for (let z = 0; z < FAC_CELLS; z++) {
      for (let x = 0; x < FAC_CELLS; x++) {
        const w = cellToWorld(x, z);
        const ex = FAC_OFF.x + (x + 1) * CELL;       // +X edge plane
        const sz = FAC_OFF.z + (z + 1) * CELL;       // +Z edge plane

        if (gen.wallE(x, z)) {
          const len = CELL + WALL_T;
          wallGeos.push(wallBox(len, false, ex, w.z));
          addCollider(ex, w.z, WALL_T / 2, len / 2);
        }
        if (gen.wallS(x, z)) {
          const len = CELL + WALL_T;
          wallGeos.push(wallBox(len, true, w.x, sz));
          addCollider(w.x, sz, len / 2, WALL_T / 2);
        }
        // west/north boundary columns for edge cells
        if (x === 0) {
          const wx = FAC_OFF.x;
          wallGeos.push(wallBox(CELL + WALL_T, false, wx, w.z));
          addCollider(wx, w.z, WALL_T / 2, (CELL + WALL_T) / 2);
        }
        if (z === 0) {
          const wz = FAC_OFF.z;
          wallGeos.push(wallBox(CELL + WALL_T, true, w.x, wz));
          addCollider(w.x, wz, (CELL + WALL_T) / 2, WALL_T / 2);
        }
        if (gen.pillar(x, z)) {
          wallGeos.push(pillarBox(w.x, w.z));
          addCollider(w.x, w.z, 0.35, 0.35);
        } else {
          this.openCells.push({ x, z });
        }
        if (gen.fixture(x, z) || (x % 3 === 1 && z % 3 === 1 && !gen.isHall(x, z))) {
          this.fixtures.push({
            x: w.x, z: w.z, y: WALL_H - FIXTURE_H,
            steadiness: gen.fixtureSteadiness(x, z),
            id: x * 73856093 ^ z * 19349663,
          });
        }
      }
    }

    const merged = mergeGeometries(wallGeos);
    wallGeos.forEach((g) => g.dispose());
    const walls = new THREE.Mesh(merged, this.materials.facWall);
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    const SIDE = FAC_CELLS * CELL;
    const floorGeo = new THREE.PlaneGeometry(SIDE, SIDE);
    {
      const uv = floorGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (SIDE / 2), uv.getY(i) * (SIDE / 2));
    }
    const floor = new THREE.Mesh(floorGeo, this.materials.facFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(FAC_OFF.x + SIDE / 2, 0, FAC_OFF.z + SIDE / 2);
    floor.receiveShadow = true;
    group.add(floor);

    const ceilGeo = new THREE.PlaneGeometry(SIDE, SIDE);
    {
      const uv = ceilGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (SIDE / 2.4), uv.getY(i) * (SIDE / 2.4));
    }
    const ceil = new THREE.Mesh(ceilGeo, this.materials.facCeiling);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(FAC_OFF.x + SIDE / 2, WALL_H, FAC_OFF.z + SIDE / 2);
    ceil.receiveShadow = true;
    group.add(ceil);

    // light fixtures: metal frame + glowing diffuser, one InstancedMesh each
    if (this.fixtures.length) {
      const frameGeo = new THREE.BoxGeometry(FIXTURE_W + 0.1, FIXTURE_H, FIXTURE_D + 0.1);
      const glowGeo = new THREE.BoxGeometry(FIXTURE_W, FIXTURE_H * 0.6, FIXTURE_D);
      const frames = new THREE.InstancedMesh(frameGeo, this.materials.fixtureFrame, this.fixtures.length);
      const glowMesh = new THREE.InstancedMesh(glowGeo, this.materials.fixtureGlow.clone(), this.fixtures.length);
      const m = new THREE.Matrix4();
      this.fixtures.forEach((f, i) => {
        m.makeTranslation(f.x, f.y, f.z);
        frames.setMatrixAt(i, m);
        m.makeTranslation(f.x, f.y - FIXTURE_H * 0.25, f.z);
        glowMesh.setMatrixAt(i, m);
        glowMesh.setColorAt(i, new THREE.Color(1, 1, 1));
        f.glowMesh = glowMesh;
        f.instance = i;
      });
      group.add(frames, glowMesh);
      this._glowMesh = glowMesh;
    }

    // entrance: middle of the south (z=0) edge. The exit door is a glowing
    // metal slab set into the boundary wall — E teleports outside.
    const entCell = { x: (FAC_CELLS / 2) | 0, z: 0 };
    const entW = cellToWorld(entCell.x, entCell.z);
    this.entrance = { x: entW.x, z: FAC_OFF.z + 1.4, cell: entCell };
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x8a2f23, roughness: 0.6, metalness: 0.5,
      emissive: 0x401008, emissiveIntensity: 0.8,
    });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.5, 0.22), doorMat);
    door.position.set(entW.x, 1.25, FAC_OFF.z + WALL_T / 2 + 0.05);
    group.add(door);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.35),
      new THREE.MeshBasicMaterial({ color: 0x35d04a })
    );
    sign.position.set(entW.x, 2.8, FAC_OFF.z + WALL_T / 2 + 0.2);
    group.add(sign);
    const exitLight = new THREE.PointLight(0x4bff66, 6, 9, 1.6);
    exitLight.position.set(entW.x, 2.6, FAC_OFF.z + 1.4);
    group.add(exitLight);
    this.exitDoor = door;

    this.scene.add(group);
    this.group = group;
    this.built = true;
  }

  /** Wall/pillar AABBs near a world position. */
  collidersNear(wx, wz, r = 6) {
    const out = [];
    for (const c of this.colliders) {
      if (c.minX > wx + r || c.maxX < wx - r || c.minZ > wz + r || c.maxZ < wz - r) continue;
      out.push(c);
    }
    return out;
  }

  /** Fixtures within r of a world position, nearest first (LightPool API). */
  fixturesNear(wx, wz, r) {
    const out = [];
    const r2 = r * r;
    for (const f of this.fixtures) {
      const dx = f.x - wx, dz = f.z - wz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r2) out.push({ f, d2 });
    }
    out.sort((a, b) => a.d2 - b.d2);
    return out;
  }

  /** Deterministically pick n distinct open cells using a seeded rng. */
  pickCells(rngSeed, n, minCellDistFromEntrance = 4) {
    const rng = mulberry32(rngSeed);
    const ent = this.entrance.cell;
    const pool = this.openCells.filter((c) =>
      Math.abs(c.x - ent.x) + Math.abs(c.z - ent.z) >= minCellDistFromEntrance);
    const picked = [];
    const used = new Set();
    let guard = 0;
    while (picked.length < n && guard++ < 4000 && pool.length) {
      const c = pool[(rng() * pool.length) | 0];
      const k = c.x + ',' + c.z;
      if (used.has(k)) continue;
      used.add(k);
      picked.push(c);
    }
    return picked;
  }

  isInside(wx, wz) {
    return wx > FAC_OFF.x - 50 && wz > FAC_OFF.z - 50;
  }

  dispose() {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        if (o.material !== this.materials.facWall && o.material !== this.materials.facFloor &&
            o.material !== this.materials.facCeiling && o.material !== this.materials.fixtureFrame) {
          o.material?.dispose();
        }
      }
    });
    this.group = null;
    this.built = false;
    this.fixtures = [];
    this.colliders = [];
  }
}

// Circle-vs-AABB slide resolution. Mutates and returns pos {x,z}.
export function resolveCollision(pos, radius, colliders) {
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2);
          pos.x = nx + (dx / d) * radius;
          pos.z = nz + (dz / d) * radius;
        } else {
          const pushL = pos.x - (c.minX - radius), pushR = (c.maxX + radius) - pos.x;
          const pushU = pos.z - (c.minZ - radius), pushD = (c.maxZ + radius) - pos.z;
          const m = Math.min(pushL, pushR, pushU, pushD);
          if (m === pushL) pos.x = c.minX - radius;
          else if (m === pushR) pos.x = c.maxX + radius;
          else if (m === pushU) pos.z = c.minZ - radius;
          else pos.z = c.maxZ + radius;
        }
      }
    }
  }
  return pos;
}
