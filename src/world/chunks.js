// Chunk streaming: builds merged meshes for a CHUNK_CELLS² block of the maze,
// keeps chunks within a radius of the player, disposes the rest. Also owns the
// wall colliders and the fixture registry that lights.js draws from.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, WALL_H, WALL_T, CHUNK_CELLS, CHUNK_SIZE } from '../core/config.js';
import * as gen from './generator.js';

const FIXTURE_W = 1.35, FIXTURE_D = 0.42, FIXTURE_H = 0.09;

// BoxGeometry UVs are 0..1 per face; rescale so the wallpaper tiles every
// ~2 m horizontally and exactly once over the wall height (the texture's
// baseboard strip must land at the floor).
function wallBox(len, alongX, cx, cz) {
  const g = new THREE.BoxGeometry(alongX ? len : WALL_T, WALL_H, alongX ? WALL_T : len);
  const uv = g.attributes.uv;
  const pos = g.attributes.position;
  const normal = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ny = Math.abs(normal.getY(i));
    if (ny > 0.5) continue; // top/bottom hidden anyway
    // horizontal extent of this face decides u scale
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

// almond water: glassy bottle silhouette (body + neck + cap), instanced per chunk
function bottleGeometry() {
  const body = new THREE.CylinderGeometry(0.05, 0.06, 0.24, 10);
  body.translate(0, 0.12, 0);
  const neck = new THREE.CylinderGeometry(0.02, 0.045, 0.08, 8);
  neck.translate(0, 0.28, 0);
  const cap = new THREE.CylinderGeometry(0.023, 0.023, 0.035, 8);
  cap.translate(0, 0.335, 0);
  return mergeGeometries([body, neck, cap]);
}

export class ChunkManager {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.chunks = new Map();   // "cx,cz" -> chunk record
    this.radius = 2;
    this._buildQueue = [];
    this._center = { x: 1e9, z: 1e9 };
    this._objectPlacer = null; // set externally by main.js
    this.drunk = new Set();    // "cx,cz" cells whose bottle was consumed
    this._bottleGeo = bottleGeometry();
    this._bottleMat = new THREE.MeshStandardMaterial({
      color: 0xdfe9ee, roughness: 0.25, metalness: 0,
      transparent: true, opacity: 0.88,
      emissive: 0x3a444b, emissiveIntensity: 0.6,
    });
    this._zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  set objectPlacer(op) { this._objectPlacer = op; }
  get objectPlacer() { return this._objectPlacer; }

  setRadius(r) { this.radius = r; this._center = { x: 1e9, z: 1e9 }; }

  // Ensure chunks around world position; builds at most `budget` per call.
  update(wx, wz, budget = 1) {
    const ccx = Math.floor(wx / CHUNK_SIZE);
    const ccz = Math.floor(wz / CHUNK_SIZE);
    // throttle: only rebuild queue when player moves to a new chunk center
    if (ccx !== this._center.x || ccz !== this._center.z) {
      this._center = { x: ccx, z: ccz };
      // queue missing chunks, nearest first
      this._buildQueue.length = 0;
      for (let dz = -this.radius; dz <= this.radius; dz++) {
        for (let dx = -this.radius; dx <= this.radius; dx++) {
          const k = (ccx + dx) + ',' + (ccz + dz);
          if (!this.chunks.has(k)) this._buildQueue.push({ x: ccx + dx, z: ccz + dz, d: dx * dx + dz * dz });
        }
      }
      this._buildQueue.sort((a, b) => a.d - b.d);
      // unload far chunks
      for (const [k, c] of this.chunks) {
        const [x, z] = k.split(',').map(Number);
        if (Math.max(Math.abs(x - ccx), Math.abs(z - ccz)) > this.radius + 1) {
          this._dispose(c, x, z);
          this.chunks.delete(k);
        }
      }
    }
    let built = 0;
    while (this._buildQueue.length && built < budget) {
      const { x, z } = this._buildQueue.shift();
      const k = x + ',' + z;
      if (!this.chunks.has(k)) {
        this.chunks.set(k, this._build(x, z));
        built++;
      }
    }
    this._lastBuilt = built;        // build frames hitch; the FPS sampler skips them
    return this._buildQueue.length; // pending count (loading screen uses this)
  }

  _build(ccx, ccz) {
    const group = new THREE.Group();
    const x0 = ccx * CHUNK_CELLS, z0 = ccz * CHUNK_CELLS;
    const wx0 = ccx * CHUNK_SIZE, wz0 = ccz * CHUNK_SIZE;

    const wallGeos = [];
    const colliders = [];
    const fixtures = [];
    const bottles = [];

    const addCollider = (cx, cz, hx, hz) => {
      colliders.push({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz });
    };

    for (let lz = 0; lz < CHUNK_CELLS; lz++) {
      for (let lx = 0; lx < CHUNK_CELLS; lx++) {
        const cx = x0 + lx, cz = z0 + lz;
        const ex = (cx + 1) * CELL;            // +X edge plane
        const sz = (cz + 1) * CELL;            // +Z edge plane
        const midX = (cx + 0.5) * CELL, midZ = (cz + 0.5) * CELL;

        if (gen.wallE(cx, cz)) {
          const len = CELL + WALL_T;           // overlap corners
          wallGeos.push(wallBox(len, false, ex, midZ));
          addCollider(ex, midZ, WALL_T / 2, len / 2);
        }
        if (gen.wallS(cx, cz)) {
          const len = CELL + WALL_T;
          wallGeos.push(wallBox(len, true, midX, sz));
          addCollider(midX, sz, len / 2, WALL_T / 2);
        }
        if (gen.pillar(cx, cz)) {
          wallGeos.push(pillarBox(midX, midZ));
          addCollider(midX, midZ, 0.35, 0.35);
        }
        if (gen.bottle(cx, cz)) {
          // nudge off-centre deterministically so rooms don't look gridded
          const ox = (gen.fixtureSteadiness(cx + 31, cz) - 0.5) * CELL * 0.5;
          const oz = (gen.fixtureSteadiness(cx, cz + 57) - 0.5) * CELL * 0.5;
          bottles.push({ x: midX + ox, z: midZ + oz, key: cx + ',' + cz });
        }
        if (gen.fixture(cx, cz)) {
          fixtures.push({
            x: midX, z: midZ, y: WALL_H - FIXTURE_H,
            cx, cz, steadiness: gen.fixtureSteadiness(cx, cz),
            id: cx * 73856093 ^ cz * 19349663,
          });
        }
      }
    }

    if (wallGeos.length) {
      const merged = mergeGeometries(wallGeos);
      wallGeos.forEach((g) => g.dispose());
      const walls = new THREE.Mesh(merged, this.materials.wall);
      walls.castShadow = true;
      walls.receiveShadow = true;
      group.add(walls);
    }

    // floor
    const floorGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    {
      const uv = floorGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (CHUNK_SIZE / 2), uv.getY(i) * (CHUNK_SIZE / 2));
    }
    const floor = new THREE.Mesh(floorGeo, this.materials.carpet);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(wx0 + CHUNK_SIZE / 2, 0, wz0 + CHUNK_SIZE / 2);
    floor.receiveShadow = true;
    group.add(floor);

    // ceiling
    const ceilGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
    {
      const uv = ceilGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (CHUNK_SIZE / 2.4), uv.getY(i) * (CHUNK_SIZE / 2.4));
    }
    const ceil = new THREE.Mesh(ceilGeo, this.materials.ceiling);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(wx0 + CHUNK_SIZE / 2, WALL_H, wz0 + CHUNK_SIZE / 2);
    ceil.receiveShadow = true;
    group.add(ceil);

    // light fixtures: metal frame + glowing diffuser, instanced per chunk
    let glowMesh = null;
    if (fixtures.length) {
      const frameGeo = new THREE.BoxGeometry(FIXTURE_W + 0.1, FIXTURE_H, FIXTURE_D + 0.1);
      const glowGeo = new THREE.BoxGeometry(FIXTURE_W, FIXTURE_H * 0.6, FIXTURE_D);
      const frames = new THREE.InstancedMesh(frameGeo, this.materials.fixtureFrame, fixtures.length);
      glowMesh = new THREE.InstancedMesh(glowGeo, this.materials.fixtureGlow.clone(), fixtures.length);
      const m = new THREE.Matrix4();
      fixtures.forEach((f, i) => {
        m.makeTranslation(f.x, f.y, f.z);
        frames.setMatrixAt(i, m);
        m.makeTranslation(f.x, f.y - FIXTURE_H * 0.25, f.z);
        glowMesh.setMatrixAt(i, m);
        glowMesh.setColorAt(i, new THREE.Color(1, 1, 1));
        f.glowMesh = glowMesh;
        f.instance = i;
      });
      group.add(frames, glowMesh);
    }

    // almond water bottles
    if (bottles.length) {
      const mesh = new THREE.InstancedMesh(this._bottleGeo, this._bottleMat, bottles.length);
      const m = new THREE.Matrix4();
      bottles.forEach((b, i) => {
        b.mesh = mesh;
        b.instance = i;
        if (this.drunk.has(b.key)) mesh.setMatrixAt(i, this._zeroM);
        else { m.makeTranslation(b.x, 0, b.z); mesh.setMatrixAt(i, m); }
      });
      group.add(mesh);
    }

    this.scene.add(group);

    // build decorative objects for this chunk
    if (this._objectPlacer) {
      this._objectPlacer.addChunk(ccx, ccz);
    }

    return { group, colliders, fixtures, bottles, glowMesh };
  }

  // Drink the nearest untouched bottle within `r` of (wx,wz). Returns true if drunk.
  drinkNear(wx, wz, r = 0.75) {
    const r2 = r * r;
    const ccx = Math.floor(wx / CHUNK_SIZE), ccz = Math.floor(wz / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get((ccx + dx) + ',' + (ccz + dz));
        if (!c?.bottles) continue;
        for (const b of c.bottles) {
          if (this.drunk.has(b.key)) continue;
          const ddx = b.x - wx, ddz = b.z - wz;
          if (ddx * ddx + ddz * ddz < r2) {
            this.drunk.add(b.key);
            b.mesh.setMatrixAt(b.instance, this._zeroM);
            b.mesh.instanceMatrix.needsUpdate = true;
            return true;
          }
        }
      }
    }
    return false;
  }

  _dispose(chunk, ccx, ccz) {
    this.scene.remove(chunk.group);
    chunk.group.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry !== this._bottleGeo) o.geometry.dispose();
        if (o.isInstancedMesh && o.material !== this.materials.fixtureFrame && o.material !== this._bottleMat) {
          o.material.dispose();
        }
      }
    });
    // remove decorative objects for this chunk
    if (this._objectPlacer) {
      this._objectPlacer.removeChunk(ccx, ccz);
    }
  }

  // Wall/pillar AABBs near a world position (for player & Clark collision).
  collidersNear(wx, wz) {
    const out = [];
    const ccx = Math.floor(wx / CHUNK_SIZE), ccz = Math.floor(wz / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get((ccx + dx) + ',' + (ccz + dz));
        if (c) out.push(...c.colliders);
      }
    }
    return out;
  }

  // All fixtures within `r` of (wx,wz), for the light pool.
  fixturesNear(wx, wz, r) {
    const out = [];
    const r2 = r * r;
    const ccx = Math.floor(wx / CHUNK_SIZE), ccz = Math.floor(wz / CHUNK_SIZE);
    const cr = Math.ceil(r / CHUNK_SIZE);
    for (let dz = -cr; dz <= cr; dz++) {
      for (let dx = -cr; dx <= cr; dx++) {
        const c = this.chunks.get((ccx + dx) + ',' + (ccz + dz));
        if (!c) continue;
        for (const f of c.fixtures) {
          const ddx = f.x - wx, ddz = f.z - wz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < r2) out.push({ f, d2 });
        }
      }
    }
    out.sort((a, b) => a.d2 - b.d2);
    return out;
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
          // centre inside the box: push out along the thinnest axis
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
