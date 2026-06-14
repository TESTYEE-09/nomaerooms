// Scrap: loading the Sketchfab GLBs, deterministic per-day spawns, and the
// take/drop/ship/sell state machine. Every client generates the identical
// item list from the shared seed; only state transitions travel the wire.
//
// Item state: 0 free (where it spawned) · 1 carried (by a player) ·
// 2 dropped (somewhere) · 3 in the ship · 4 sold/gone.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SCRAP_TYPES, MOONS, FAC_OFF, SHIP_W, SHIP_D } from '../core/config.js';
import { mulberry32 } from '../core/utils.js';
import * as facMod from '../world/facility.js';

export const ST = { FREE: 0, CARRIED: 1, DROPPED: 2, SHIP: 3, GONE: 4 };

export class ScrapManager {
  constructor(scene) {
    this.scene = scene;
    this.templates = new Map();   // typeId -> normalized THREE.Group
    this.items = [];              // [{id, type, value, weight, state, by, pos:Vector3, zone, obj}]
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  async load(onProgress) {
    const loader = new GLTFLoader();
    let done = 0;
    await Promise.all(SCRAP_TYPES.map(async (t) => {
      try {
        const gltf = await loader.loadAsync(import.meta.env.BASE_URL + 'models/lethal/' + t.model);
        const root = gltf.scene;
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const scale = t.h / Math.max(size.x, size.y, size.z, 1e-6);
        root.scale.setScalar(scale);
        box.setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        root.position.set(-center.x, -box.min.y, -center.z); // sit on origin
        // faint self-glow so loot reads in dark corridors (the facility is
        // lit like a cave; pure PBR scrap would be invisible)
        root.traverse((o) => {
          if (o.isMesh && o.material) {
            o.material = o.material.clone();
            if (o.material.emissive !== undefined) {
              const base = o.material.color?.clone() || new THREE.Color(0x888888);
              o.material.emissive = base.multiplyScalar(0.32);
              o.material.emissiveMap = o.material.map || null;
            }
          }
        });
        const wrap = new THREE.Group();
        wrap.add(root);
        this.templates.set(t.id, wrap);
      } catch (e) {
        console.warn('[scrap] failed to load', t.model, e?.message);
      }
      onProgress?.(++done / SCRAP_TYPES.length);
    }));
  }

  /**
   * Deterministic spawn list for (seed, moonIdx, day). Positions come from the
   * facility's open cells plus a couple of surface finds near the bunker.
   */
  spawnForMoon(seed, moonIdx, day, facility, moonWorld) {
    // preserve anything currently stowed in the ship across the rebuild, so a
    // re-spawn (new moon, new day, late join) never deletes the crew's loot
    this._captureShip();
    this.clear();
    const M = MOONS[moonIdx];
    if (!M.scrapMax) { this._appendCarryOver(); this._buildMeshes(); return; }
    const rng = mulberry32((seed ^ (moonIdx * 7349) ^ (day * 52361)) | 0);
    const count = M.scrapMin + ((rng() * (M.scrapMax - M.scrapMin + 1)) | 0);

    // weighted type picker
    const totalP = SCRAP_TYPES.reduce((s, t) => s + t.p, 0);
    const pickType = () => {
      let r = rng() * totalP;
      for (const t of SCRAP_TYPES) { r -= t.p; if (r <= 0) return t; }
      return SCRAP_TYPES[0];
    };

    // all scrap spawns *inside* the facility — never out on the surface
    const cells = facility.pickCells((seed ^ 0x5c4a9) | 0, count);

    for (let i = 0; i < cells.length; i++) {
      const t = pickType();
      const value = Math.round((t.v[0] + rng() * (t.v[1] - t.v[0])) * M.valueMul);
      const w = facMod.cellToWorld(cells[i].x, cells[i].z);
      const pos = new THREE.Vector3(
        w.x + (rng() - 0.5) * 1.6, 0, w.z + (rng() - 0.5) * 1.6);
      // id is always the array index so apply()/snapshot() stay in sync
      this.items.push({
        id: this.items.length, type: t, value, weight: t.w,
        state: ST.FREE, by: null, pos, zone: 'fac', obj: null,
      });
    }
    this._appendCarryOver();
    this._buildMeshes();
  }

  /** Snapshot whatever is currently in the ship into the carry-over buffer. */
  _captureShip() {
    const ship = this.items.filter((it) => it.state === ST.SHIP);
    if (ship.length) {
      this._carryOver = ship.map((it) => ({
        type: it.type, value: it.value, weight: it.weight,
        pos: [+it.pos.x.toFixed(2), +it.pos.y.toFixed(2), +it.pos.z.toFixed(2)],
      }));
    }
  }

  /** Scrap already stowed in the ship rides along to the next moon. */
  _appendCarryOver() {
    for (const c of (this._carryOver || [])) {
      this.items.push({
        id: this.items.length, type: c.type, value: c.value, weight: c.weight,
        state: ST.SHIP, by: null,
        pos: new THREE.Vector3(c.pos[0], c.pos[1], c.pos[2]),
        zone: 'ship', obj: null,
      });
    }
  }

  _buildMeshes() {
    for (const it of this.items) {
      const tpl = this.templates.get(it.type.id);
      if (!tpl) {
        // fallback: glowing box
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.3, 0.3),
          new THREE.MeshStandardMaterial({ color: 0x88ff88, emissive: 0x224422 }));
        it.obj = m;
      } else {
        it.obj = tpl.clone(true);
      }
      it.obj.position.copy(it.pos);
      it.obj.rotation.y = (it.id * 2.39996) % (Math.PI * 2);
      this.group.add(it.obj);
    }
  }

  /** Nearest takeable item to a world position in the same zone. */
  nearestTakeable(x, z, zone, r = 2.4) {
    let best = null, bd = r * r;
    for (const it of this.items) {
      if (it.state !== ST.FREE && it.state !== ST.DROPPED && it.state !== ST.SHIP) continue;
      if (it.zone !== zone && !(it.zone === 'ship' && zone === 'ship')) continue;
      const dx = it.pos.x - x, dz = it.pos.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = it; }
    }
    return best;
  }

  /** Apply a state transition (host decision or relayed event). */
  apply(ev) {
    const it = this.items[ev.id];
    if (!it) return;
    switch (ev.k) {
      case 'take':
        it.state = ST.CARRIED;
        it.by = ev.by;
        if (it.obj) it.obj.visible = false;
        break;
      case 'drop': {
        it.by = null;
        it.pos.set(ev.p[0], ev.p[1], ev.p[2]);
        it.zone = ev.zone;
        it.state = ev.zone === 'ship' ? ST.SHIP : ST.DROPPED;
        if (it.obj) {
          it.obj.visible = true;
          it.obj.position.copy(it.pos);
        }
        break;
      }
      case 'sell':
        it.state = ST.GONE;
        it.by = null;
        if (it.obj) it.obj.visible = false;
        break;
    }
  }

  carriedBy(pid) {
    return this.items.filter((it) => it.state === ST.CARRIED && it.by === pid);
  }

  /** Items dropped near the company counter (what the bell sells). */
  atCounter(counterPos, r = 5) {
    return this.items.filter((it) => {
      if (it.state !== ST.DROPPED || it.zone !== 'moon') return false;
      return Math.hypot(it.pos.x - counterPos.x, it.pos.z - counterPos.z) < r;
    });
  }

  shipValue() {
    return this.items
      .filter((it) => it.state === ST.SHIP)
      .reduce((s, it) => s + it.value, 0);
  }

  remainingValue() {
    return this.items
      .filter((it) => it.state === ST.FREE || it.state === ST.DROPPED)
      .reduce((s, it) => s + it.value, 0);
  }

  /** On takeoff: scrap in the ship survives, everything else is left behind.
   *  Runs identically on every client at the phase change. */
  keepShipOnly() {
    this._carryOver = this.items
      .filter((it) => it.state === ST.SHIP)
      .map((it) => ({
        type: it.type, value: it.value, weight: it.weight,
        pos: [+it.pos.x.toFixed(2), +it.pos.y.toFixed(2), +it.pos.z.toFixed(2)],
      }));
    this.clear();
    this._appendCarryOver();
    this._buildMeshes();
  }

  /** Fresh run: drop everything including ship stock. */
  reset() {
    this._carryOver = [];
    this.clear();
  }

  /** Ship contents as plain JSON for the save file. */
  exportShip() {
    const ship = this.items.filter((it) => it.state === ST.SHIP);
    const src = ship.length
      ? ship.map((it) => ({ t: it.type.id, v: it.value, w: it.weight }))
      : (this._carryOver || []).map((c) => ({ t: c.type.id, v: c.value, w: c.weight }));
    return src;
  }

  /** Restore ship contents from a save file (seeds the carry-over buffer).
   *  Items are laid out in a tidy row near the storage shelf. */
  importShip(list) {
    this._carryOver = (list || []).map((d, i) => ({
      type: SCRAP_TYPES.find((t) => t.id === d.t) || SCRAP_TYPES[0],
      value: d.v, weight: d.w,
      pos: [SHIP_W / 2 - 1.0 - (i % 3) * 0.45, 0, SHIP_D / 2 - 1.6 + ((i / 3) | 0) * 0.45],
    }));
  }

  /** Build meshes for the carry-over buffer now (used to show a loaded run's
   *  cargo while still in orbit, before any landing). */
  materializeShip() {
    this.clear();
    this._appendCarryOver();
    this._buildMeshes();
  }

  /** Serialize all item states (for late joiners). */
  snapshot() {
    return this.items.map((it) => ({
      id: it.id, s: it.state, by: it.by,
      p: [+it.pos.x.toFixed(2), +it.pos.y.toFixed(2), +it.pos.z.toFixed(2)],
      z: it.zone,
    }));
  }

  applySnapshot(snap) {
    for (const s of snap) {
      const it = this.items[s.id];
      if (!it) continue;
      it.state = s.s;
      it.by = s.by;
      it.pos.set(s.p[0], s.p[1], s.p[2]);
      it.zone = s.z;
      if (it.obj) {
        it.obj.visible = it.state === ST.FREE || it.state === ST.DROPPED || it.state === ST.SHIP;
        it.obj.position.copy(it.pos);
      }
    }
  }

  clear() {
    for (const it of this.items) {
      if (it.obj) this.group.remove(it.obj);
    }
    this.items = [];
  }
}
