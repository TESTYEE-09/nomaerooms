// The three entities, all host-simulated and broadcast to guests:
//   Crawler — facility. Roams the maze, A*-chases on line of sight. Fast.
//   Stalker — facility. Creeps toward you only while nobody is looking at it.
//   Hound   — surface, after dark. Hunts by sound: sprinting carries far.
// Guests interpolate from 10 Hz snapshots, exactly like Clark did.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { CELL } from '../core/config.js';
import { clamp, damp } from '../core/utils.js';
import * as gen from '../world/generator.js';
import * as facMod from '../world/facility.js';

const KILL_R = { crawler: 1.5, stalker: 1.4, hound: 1.8, coil: 1.6 };

async function loadNormalized(file, height) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(import.meta.env.BASE_URL + 'models/lethal/' + file);
  const root = gltf.scene;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const scale = height / Math.max(size.y, 1e-6);
  root.scale.setScalar(scale);
  box.setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -box.min.y, -center.z);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  return { root, animations: gltf.animations };
}

class Monster {
  constructor(scene, kind) {
    this.scene = scene;
    this.kind = kind;
    // which world the entity lives in; coils set this per-instance (fac or moon)
    this.zone = kind === 'hound' ? 'moon' : 'fac';
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.state = 0;            // 0 roam/idle, 1 chase/creep
    this.active = false;
    this.moveAmount = 0;
    this.t = Math.random() * 10;
    // net interp
    this.netFrom = new THREE.Vector3();
    this.netTo = new THREE.Vector3();
    this.netT = 1;
    this.netHeadingTo = 0;
    this.mixer = null;
    this.actions = {};
  }

  attach(model, animations, animMap) {
    this.model = model;
    this.group.add(model);
    if (animations?.length) {
      this.mixer = new THREE.AnimationMixer(model);
      for (const [key, name] of Object.entries(animMap)) {
        const clip = animations.find((a) => a.name === name) || animations[0];
        if (clip) this.actions[key] = this.mixer.clipAction(clip);
      }
      (this.actions.move || Object.values(this.actions)[0])?.play();
    }
  }

  spawnAt(x, y, z) {
    this.pos.set(x, y, z);
    this.group.position.copy(this.pos);
    this.netFrom.copy(this.pos);
    this.netTo.copy(this.pos);
    this.active = true;
    this.group.visible = true;
  }

  despawn() {
    this.active = false;
    this.group.visible = false;
  }

  netState() {
    return {
      p: [+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2)],
      h: +this.heading.toFixed(2), s: this.state, mv: +this.moveAmount.toFixed(2),
      a: this.active ? 1 : 0,
    };
  }

  applyNet(msg, lerpTime) {
    if (!msg.a) { this.despawn(); return; }
    if (!this.active) this.spawnAt(msg.p[0], msg.p[1], msg.p[2]);
    this.netFrom.copy(this.group.position);
    this.netTo.set(msg.p[0], msg.p[1], msg.p[2]);
    this.netT = 0;
    this.netLerpTime = lerpTime;
    this.netHeadingTo = msg.h;
    this.state = msg.s;
    this.moveAmount = msg.mv;
  }

  guestUpdate(dt) {
    if (!this.active) return;
    this.t += dt;
    this.netT = Math.min(1, this.netT + dt / (this.netLerpTime || 0.12));
    this.group.position.lerpVectors(this.netFrom, this.netTo, this.netT);
    this.pos.copy(this.group.position);
    let dh = this.netHeadingTo - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += dh * Math.min(1, dt * 10);
    this._animate(dt);
  }

  _animate(dt) {
    this.group.rotation.y = this.heading;
    if (this.mixer) {
      const speedK = this.kind === 'crawler' ? 1.6 : 1.0;
      this.mixer.timeScale = 0.4 + this.moveAmount * speedK;
      this.mixer.update(dt);
    } else if (this.model) {
      this.model.position.y = Math.abs(Math.sin(this.t * (4 + this.moveAmount * 5))) * 0.12 * this.moveAmount;
    }
  }

  /** steer + advance with collision against AABBs */
  _move(dt, tx, tz, speed, colliders) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const want = Math.atan2(dx, dz);
    let dh = want - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += clamp(dh, -5 * dt, 5 * dt);
    this.pos.x += Math.sin(this.heading) * speed * dt;
    this.pos.z += Math.cos(this.heading) * speed * dt;
    if (colliders) facMod.resolveCollision(this.pos, 0.4, colliders);
    this.moveAmount = damp(this.moveAmount, clamp(speed / 4.5, 0.25, 1.2), 6, dt);
  }

  fearFor(px, pz, pzone) {
    if (!this.active) return 0;
    if (pzone !== this.zone) return 0;
    const d = Math.hypot(px - this.pos.x, pz - this.pos.z);
    let f = clamp(1 - d / 24, 0, 1);
    if (this.state === 1) f = Math.max(f, clamp(1 - d / 32, 0, 1)) * 1.15;
    return clamp(f, 0, 1);
  }
}

// ---- host brains ----

class Crawler extends Monster {
  constructor(scene) { super(scene, 'crawler'); this.path = []; this.repathT = 0; this.roamTarget = null; }

  hostUpdate(dt, players, facility) {
    if (!this.active) return;
    this.t += dt;
    const facPlayers = players.filter((p) => p.zone === 'fac');
    if (!facPlayers.length) { this.moveAmount = damp(this.moveAmount, 0, 4, dt); this._animate(dt); return; }

    let nd = Infinity, np = facPlayers[0];
    for (const p of facPlayers) {
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d < nd) { nd = d; np = p; }
    }
    const meC = facMod.worldToCell(this.pos.x, this.pos.z);
    const npC = facMod.worldToCell(np.x, np.z);

    const seen = nd < 16 && gen.lineOfSight(
      this.pos.x - 5000, this.pos.z - 5000, np.x - 5000, np.z - 5000);
    if (this.state === 0 && seen) this.state = 1;
    else if (this.state === 1 && nd > 26) this.state = 0;

    this.repathT -= dt;
    if (this.repathT <= 0 || !this.path.length) {
      this.repathT = this.state === 1 ? 0.35 : 0.8;
      let goal;
      if (this.state === 0) {
        if (!this.roamTarget || Math.hypot(this.roamTarget.x - this.pos.x, this.roamTarget.z - this.pos.z) < CELL) {
          const cells = facility.openCells;
          const c = cells[(Math.random() * cells.length) | 0];
          const w = facMod.cellToWorld(c.x, c.z);
          this.roamTarget = { x: w.x, z: w.z };
        }
        goal = facMod.worldToCell(this.roamTarget.x, this.roamTarget.z);
      } else {
        goal = npC;
      }
      const path = gen.findPath(meC.x, meC.z, goal.x, goal.z);
      if (path) this.path = path.map((c) => facMod.cellToWorld(c.x, c.z));
      else { this.path = []; this.roamTarget = null; }
    }

    const speed = this.state === 1 ? 4.6 : 1.3;
    let tx, tz;
    if (this.state === 1 && nd < CELL * 1.5) { tx = np.x; tz = np.z; }
    else if (this.path.length) {
      const wp = this.path[0];
      if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.6) this.path.shift();
      const w2 = this.path[0];
      if (w2) { tx = w2.x; tz = w2.z; }
    }
    if (tx !== undefined) this._move(dt, tx, tz, speed, facility.collidersNear(this.pos.x, this.pos.z));
    else this.moveAmount = damp(this.moveAmount, 0, 6, dt);

    this.group.position.copy(this.pos);
    this._animate(dt);
  }
}

class Stalker extends Monster {
  constructor(scene) { super(scene, 'stalker'); this.path = []; this.repathT = 0; }

  hostUpdate(dt, players, facility) {
    if (!this.active) return;
    this.t += dt;
    const facPlayers = players.filter((p) => p.zone === 'fac');
    if (!facPlayers.length) { this._animate(dt); return; }

    let nd = Infinity, np = facPlayers[0];
    for (const p of facPlayers) {
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d < nd) { nd = d; np = p; }
    }

    // observed: any facility player has the stalker in a ~110° cone with LOS
    let observed = false;
    for (const p of facPlayers) {
      const toX = this.pos.x - p.x, toZ = this.pos.z - p.z;
      const dl = Math.hypot(toX, toZ);
      if (dl > 30) continue;
      // player forward from yaw (camera looks down -Z rotated by yaw)
      const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
      const dot = (toX * fx + toZ * fz) / Math.max(dl, 1e-4);
      if (dot > 0.45 && gen.lineOfSight(p.x - 5000, p.z - 5000, this.pos.x - 5000, this.pos.z - 5000)) {
        observed = true;
        break;
      }
    }

    this.state = observed ? 0 : 1;
    if (!observed) {
      this.repathT -= dt;
      const meC = facMod.worldToCell(this.pos.x, this.pos.z);
      const npC = facMod.worldToCell(np.x, np.z);
      if (this.repathT <= 0 || !this.path.length) {
        this.repathT = 0.4;
        const path = gen.findPath(meC.x, meC.z, npC.x, npC.z);
        this.path = path ? path.map((c) => facMod.cellToWorld(c.x, c.z)) : [];
      }
      let tx, tz;
      if (nd < CELL * 1.5) { tx = np.x; tz = np.z; }
      else if (this.path.length) {
        const wp = this.path[0];
        if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.6) this.path.shift();
        const w2 = this.path[0];
        if (w2) { tx = w2.x; tz = w2.z; }
      }
      if (tx !== undefined) this._move(dt, tx, tz, 3.4, facility.collidersNear(this.pos.x, this.pos.z));
    } else {
      // frozen mid-step, facing you
      this.heading = Math.atan2(np.x - this.pos.x, np.z - this.pos.z);
      this.moveAmount = damp(this.moveAmount, 0, 12, dt);
    }

    this.group.position.copy(this.pos);
    this._animate(dt);
  }

  _animate(dt) {
    this.group.rotation.y = this.heading;
    if (this.mixer) {
      // freeze the clip entirely while observed
      this.mixer.timeScale = this.state === 1 ? 0.5 + this.moveAmount : 0;
      this.mixer.update(dt);
    }
  }
}

class Hound extends Monster {
  constructor(scene) { super(scene, 'hound'); this.wander = null; this.alertT = 0; }

  hostUpdate(dt, players, moonWorld) {
    if (!this.active) return;
    this.t += dt;
    const surface = players.filter((p) => p.zone === 'moon');

    // hearing: moving players make noise; sprint carries much further
    let heard = null, hd = Infinity;
    for (const p of surface) {
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      const hearR = p.sp ? 42 : (p.mv ? 18 : 5);
      if (d < hearR && d < hd) { hd = d; heard = p; }
    }
    if (heard) { this.state = 1; this.alertT = 4; this.lastHeard = { x: heard.x, z: heard.z }; }
    else if (this.alertT > 0) { this.alertT -= dt; if (this.alertT <= 0) this.state = 0; }

    let tx, tz, speed;
    if (this.state === 1 && this.lastHeard) {
      tx = this.lastHeard.x; tz = this.lastHeard.z; speed = 7.2;
      if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 1.2 && !heard) this.state = 0;
    } else {
      if (!this.wander || Math.hypot(this.wander.x - this.pos.x, this.wander.z - this.pos.z) < 3) {
        const a = Math.random() * Math.PI * 2;
        const d = 25 + Math.random() * 50;
        this.wander = {
          x: clamp(this.pos.x + Math.cos(a) * d, -160, 160),
          z: clamp(this.pos.z + Math.sin(a) * d, -160, 160),
        };
      }
      tx = this.wander.x; tz = this.wander.z; speed = 2.4;
    }
    this._move(dt, tx, tz, speed, moonWorld.collidersNear(this.pos.x, this.pos.z));
    this.pos.y = moonWorld.groundY(this.pos.x, this.pos.z);
    this.group.position.copy(this.pos);
    this._animate(dt);
  }
}

// Coil-head: classic "weeping angel" rules. Completely frozen while any player
// has it in their view cone; the instant nobody is looking it rushes straight
// at the nearest victim — fast. Lives in the facility OR out on the surface.
class Coil extends Monster {
  constructor(scene) { super(scene, 'coil'); this.path = []; this.repathT = 0; }

  hostUpdate(dt, players, world) {
    if (!this.active) return;
    this.t += dt;
    const here = players.filter((p) => p.zone === this.zone && !p.dead);
    if (!here.length) { this.moveAmount = damp(this.moveAmount, 0, 8, dt); this._animate(dt); return; }

    let nd = Infinity, np = here[0];
    for (const p of here) {
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d < nd) { nd = d; np = p; }
    }

    // observed: any player has it within a ~100° cone (LOS too, in the maze)
    let observed = false;
    for (const p of here) {
      const toX = this.pos.x - p.x, toZ = this.pos.z - p.z;
      const dl = Math.hypot(toX, toZ);
      if (dl > 36) continue;
      const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
      const dot = (toX * fx + toZ * fz) / Math.max(dl, 1e-4);
      if (dot <= 0.4) continue;
      if (this.zone === 'fac') {
        if (gen.lineOfSight(p.x - 5000, p.z - 5000, this.pos.x - 5000, this.pos.z - 5000)) { observed = true; break; }
      } else { observed = true; break; }
    }

    this.state = observed ? 0 : 1;
    if (observed) {
      // frozen mid-stride, head snapped toward the watcher
      this.heading = Math.atan2(np.x - this.pos.x, np.z - this.pos.z);
      this.moveAmount = damp(this.moveAmount, 0, 16, dt);
    } else {
      const speed = this.zone === 'fac' ? 7.0 : 6.0;
      let tx, tz;
      if (this.zone === 'fac') {
        const meC = facMod.worldToCell(this.pos.x, this.pos.z);
        const npC = facMod.worldToCell(np.x, np.z);
        this.repathT -= dt;
        if (this.repathT <= 0 || !this.path.length) {
          this.repathT = 0.3;
          const path = gen.findPath(meC.x, meC.z, npC.x, npC.z);
          this.path = path ? path.map((c) => facMod.cellToWorld(c.x, c.z)) : [];
        }
        if (nd < CELL * 1.5) { tx = np.x; tz = np.z; }
        else if (this.path.length) {
          const wp = this.path[0];
          if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.6) this.path.shift();
          const w2 = this.path[0];
          if (w2) { tx = w2.x; tz = w2.z; }
        }
        if (tx !== undefined) this._move(dt, tx, tz, speed, world.collidersNear(this.pos.x, this.pos.z));
      } else {
        tx = np.x; tz = np.z;
        this._move(dt, tx, tz, speed, world.collidersNear(this.pos.x, this.pos.z));
        this.pos.y = world.groundY(this.pos.x, this.pos.z);
      }
    }
    this.group.position.copy(this.pos);
    this._animate(dt);
  }
}

// procedural coil-head model (no GLB): a coiled spring topped by a pale,
// staring mannequin head. Built so it never depends on a downloaded asset.
function buildCoilModel() {
  const g = new THREE.Group();
  const springMat = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.45, metalness: 0.8 });
  for (let i = 0; i < 9; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 6, 14), springMat);
    ring.position.y = 0.14 + i * 0.15;
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = i * 0.5;
    ring.castShadow = true;
    g.add(ring);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xcabfa6, roughness: 0.7 }));
  neck.position.y = 1.55;
  g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 16),
    new THREE.MeshStandardMaterial({ color: 0xd9d0bd, roughness: 0.85 }));
  head.position.y = 1.82;
  head.scale.set(0.9, 1.05, 0.95);
  head.castShadow = true;
  g.add(head);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3, emissive: 0x120000, emissiveIntensity: 0.5 });
  for (const ex of [-0.09, 0.09]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), eyeMat);
    eye.position.set(ex, 1.86, 0.2);
    g.add(eye);
  }
  // gaping mouth
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x100808 }));
  mouth.position.set(0, 1.74, 0.22);
  g.add(mouth);
  return g;
}

// ---- manager ----

export class Monsters {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this._assets = {};
  }

  async load(onProgress) {
    const specs = [
      ['crawler', 'monster_crawler.glb', 1.1],
      ['stalker', 'monster_stalker.glb', 2.1],
      ['hound', 'monster_hound.glb', 1.6],
    ];
    let done = 0;
    await Promise.all(specs.map(async ([kind, file, h]) => {
      try { this._assets[kind] = await loadNormalized(file, h); }
      catch (e) { console.warn('[monsters] failed to load', file, e?.message); }
      onProgress?.(++done / specs.length);
    }));
  }

  _make(kind) {
    const m = kind === 'crawler' ? new Crawler(this.scene)
            : kind === 'stalker' ? new Stalker(this.scene)
            : kind === 'coil' ? new Coil(this.scene)
            : new Hound(this.scene);
    if (kind === 'coil') {
      // procedural model — no GLB dependency
      const model = buildCoilModel();
      m.model = model;
      m.group.add(model);
      this.list.push(m);
      return m;
    }
    const a = this._assets[kind];
    if (a) {
      // SkinnedMesh clones need SkeletonUtils to rebind bones
      const clone = skeletonClone(a.root);
      m.attach(clone, a.animations, kind === 'crawler'
        ? { move: 'Armature|Crawl', idle: 'Armature|Idle' }
        : kind === 'stalker' ? { move: 'mental_skeleton|animation' }
        : { move: 'Idle' });
    } else {
      const ph = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 1.8, 6),
        new THREE.MeshStandardMaterial({ color: 0x661111 }));
      ph.position.y = 0.9;
      m.model = ph;
      m.group.add(ph);
    }
    this.list.push(m);
    return m;
  }

  /** Host: spawn the set for a landing. Roster order is fixed (crawlers,
   *  stalkers, coils, hounds, surface-coils) so guests index-match the stream.
   *  Hounds are built dormant and wake at dark via releaseHounds(). */
  spawnForMoon(M, facility, moonWorld) {
    this.clearAll();
    this._facility = facility;
    this._moonWorld = moonWorld;
    const facCell = (minD) => facility.pickCells((Math.random() * 1e9) | 0, 1, minD)[0];

    for (let i = 0; i < M.crawlers; i++) {
      const m = this._make('crawler');
      const c = facCell(10);
      if (c) { const w = facMod.cellToWorld(c.x, c.z); m.spawnAt(w.x, 0, w.z); }
    }
    for (let i = 0; i < M.stalkers; i++) {
      const m = this._make('stalker');
      const c = facCell(14);
      if (c) { const w = facMod.cellToWorld(c.x, c.z); m.spawnAt(w.x, 0, w.z); }
    }
    for (let i = 0; i < (M.coils || 0); i++) {
      const m = this._make('coil');
      m.zone = 'fac';
      const c = facCell(12);
      if (c) { const w = facMod.cellToWorld(c.x, c.z); m.spawnAt(w.x, 0, w.z); }
    }
    // hounds: dormant slots, woken after dark
    this._hounds = [];
    for (let i = 0; i < M.hounds; i++) this._hounds.push(this._make('hound'));
    // surface coils: roam outside, active from landing (a daytime threat)
    for (let i = 0; i < (M.coilsOut || 0); i++) {
      const m = this._make('coil');
      m.zone = 'moon';
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 80;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      m.spawnAt(x, moonWorld.groundY(x, z), z);
    }
  }

  /** Guest: build the same roster in the same order (inactive until net). */
  buildRoster(M) {
    this.clearAll();
    for (let i = 0; i < M.crawlers; i++) this._make('crawler');
    for (let i = 0; i < M.stalkers; i++) this._make('stalker');
    for (let i = 0; i < (M.coils || 0); i++) { const m = this._make('coil'); m.zone = 'fac'; }
    for (let i = 0; i < M.hounds; i++) this._make('hound');
    for (let i = 0; i < (M.coilsOut || 0); i++) { const m = this._make('coil'); m.zone = 'moon'; }
  }

  releaseHounds() {
    const hounds = this._hounds || [];
    if (!hounds.length) return false;
    for (const m of hounds) {
      const a = Math.random() * Math.PI * 2;
      const d = 90 + Math.random() * 60;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      m.spawnAt(x, this._moonWorld.groundY(x, z), z);
    }
    this._hounds = [];
    return true;
  }

  hostUpdate(dt, players, facility, moonWorld) {
    for (const m of this.list) {
      if (m.kind === 'hound') m.hostUpdate(dt, players, moonWorld);
      else if (m.kind === 'coil') m.hostUpdate(dt, players, m.zone === 'moon' ? moonWorld : facility);
      else m.hostUpdate(dt, players, facility);
    }
  }

  guestUpdate(dt) {
    for (const m of this.list) m.guestUpdate(dt);
  }

  /** Host: returns the pid of any player a monster reached, or null. */
  checkKills(players) {
    for (const m of this.list) {
      if (!m.active) continue;
      const zone = m.zone;
      for (const p of players) {
        if (p.zone !== zone || p.dead) continue;
        if (Math.hypot(p.x - m.pos.x, p.z - m.pos.z) < KILL_R[m.kind]) {
          return { pid: p.id, kind: m.kind };
        }
      }
    }
    return null;
  }

  netStates() { return this.list.map((m) => m.netState()); }

  applyNetStates(states, lerpTime) {
    for (let i = 0; i < states.length; i++) {
      if (this.list[i]) this.list[i].applyNet(states[i], lerpTime);
    }
  }

  maxFear(px, pz, zone) {
    let f = 0;
    for (const m of this.list) f = Math.max(f, m.fearFor(px, pz, zone));
    return f;
  }

  nearestActive(px, pz, zone) {
    let best = null, bd = Infinity;
    for (const m of this.list) {
      if (!m.active) continue;
      if (m.zone !== zone) continue;
      const d = Math.hypot(px - m.pos.x, pz - m.pos.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best ? { m: best, d: bd } : null;
  }

  clearAll() {
    for (const m of this.list) {
      m.despawn();
      this.scene.remove(m.group);
    }
    this.list = [];
    this._hounds = [];
  }
}
