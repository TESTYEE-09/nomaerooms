// Pirate Clark — the only other thing alive down here.
//
// Model: "Pirate Clark" GLB (Sketchfab, CC BY 4.0). No baked animation clips,
// so the walk is procedural (bob/sway/lean). Normalized to CLARK_HEIGHT with
// feet at y=0.
//
// The HOST runs the brain: A* over the maze cell grid toward the nearest
// player, with escalating states (ROAM → STALK → CHASE). Position streams to
// guests at CLARK_NET_HZ; guests only interpolate. Every client detects its
// own jumpscare locally (distance to its own camera) for zero-latency scares;
// the host then relocates Clark and broadcasts the new spot.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CELL, CLARK_HEIGHT, CLARK_SCARE_DIST } from '../core/config.js';
import { clamp, damp } from '../core/utils.js';
import * as gen from '../world/generator.js';

const MODEL_URL = './assets/models/pirate-clark.glb';

export const STATE = { ROAM: 0, STALK: 1, CHASE: 2 };
const SPEEDS = { [STATE.ROAM]: 1.1, [STATE.STALK]: 2.3, [STATE.CHASE]: 4.7 };
const STALK_DIST = 55;
const CHASE_DIST = 18;
const REPATH_S = 0.7;

export class Clark {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.state = STATE.ROAM;
    this.active = false;
    this.t = 0;
    this.moveAmount = 0;       // 0..1, drives the procedural walk

    // host brain
    this.path = [];
    this.repathT = 0;
    this.roamTarget = null;

    // guest interpolation
    this.netFrom = new THREE.Vector3();
    this.netTo = new THREE.Vector3();
    this.netT = 1;
    this.netHeadingTo = 0;

    this._baseY = 0;
    this._model = null;

    // a faint cold light so he reads in dark stretches
    const aura = new THREE.PointLight(0x4a3050, 2.5, 7, 1.8);
    aura.position.y = 2.0;
    this.group.add(aura);
  }

  async load(onProgress) {
    const loader = new GLTFLoader();
    const gltf = await new Promise((res, rej) =>
      loader.load(MODEL_URL, res, onProgress, rej));
    const m = gltf.scene;
    m.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = true;
      }
    });
    const box = new THREE.Box3().setFromObject(m);
    const size = new THREE.Vector3();
    box.getSize(size);
    m.scale.setScalar(CLARK_HEIGHT / Math.max(size.x, size.y, size.z));
    const box2 = new THREE.Box3().setFromObject(m);
    m.position.y = -box2.min.y;
    this._baseY = m.position.y;
    this._model = m;
    this.group.add(m);
  }

  // ---- shared ----

  spawnAt(wx, wz) {
    this.pos.set(wx, 0, wz);
    this.netFrom.copy(this.pos);
    this.netTo.copy(this.pos);
    this.group.position.copy(this.pos);
    this.path = [];
    this.roamTarget = null;
    this.state = STATE.ROAM;
    this.active = true;
    this.group.visible = true;
  }

  // pick a fresh spot 40–70 m from every player (host)
  relocateAway(players) {
    for (let tries = 0; tries < 30; tries++) {
      const ref = players[(Math.random() * players.length) | 0];
      const a = Math.random() * Math.PI * 2;
      const d = 22 + Math.random() * 18;
      const wx = ref.x + Math.cos(a) * d;
      const wz = ref.z + Math.sin(a) * d;
      let ok = true;
      for (const p of players) if (Math.hypot(p.x - wx, p.z - wz) < 16) ok = false;
      if (!ok) continue;
      const c = gen.worldToCell(wx, wz);
      const cell = gen.findOpenCell(c.x, c.z);
      const cc = gen.cellCenter(cell.x, cell.z);
      this.spawnAt(cc.x, cc.z);
      return;
    }
    this.spawnAt(this.pos.x + 50, this.pos.z + 50);
  }

  // ---- host brain ----

  // players: [{x,z}] — every connected player's position
  hostUpdate(dt, players) {
    if (!this.active || !players.length) return;
    this.t += dt;

    // nearest player
    let nd = Infinity, np = players[0];
    for (const p of players) {
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d < nd) { nd = d; np = p; }
    }

    // state machine with hysteresis
    if (this.state !== STATE.CHASE && nd < CHASE_DIST &&
        gen.lineOfSight(this.pos.x, this.pos.z, np.x, np.z)) {
      this.state = STATE.CHASE;
    } else if (this.state === STATE.CHASE && nd > CHASE_DIST + 9) {
      this.state = STATE.STALK;
    } else if (this.state === STATE.ROAM && nd < STALK_DIST) {
      this.state = STATE.STALK;
    } else if (this.state === STATE.STALK && nd > STALK_DIST + 12) {
      this.state = STATE.ROAM;
    }

    // (re)path
    this.repathT -= dt;
    if (this.repathT <= 0 || !this.path.length) {
      this.repathT = this.state === STATE.CHASE ? REPATH_S * 0.5 : REPATH_S;
      const me = gen.worldToCell(this.pos.x, this.pos.z);
      let goal;
      if (this.state === STATE.ROAM) {
        if (!this.roamTarget || Math.hypot(this.roamTarget.x - this.pos.x, this.roamTarget.z - this.pos.z) < CELL) {
          // wander to a cell ~6-14 cells away, biased toward players
          const a = Math.random() * Math.PI * 2;
          const d = (6 + Math.random() * 8) * CELL;
          this.roamTarget = {
            x: this.pos.x * 0.45 + np.x * 0.55 + Math.cos(a) * d,
            z: this.pos.z * 0.45 + np.z * 0.55 + Math.sin(a) * d,
          };
        }
        goal = gen.worldToCell(this.roamTarget.x, this.roamTarget.z);
      } else {
        goal = gen.worldToCell(np.x, np.z);
      }
      const path = gen.findPath(me.x, me.z, goal.x, goal.z);
      if (path) this.path = path.map((c) => gen.cellCenter(c.x, c.z));
      else { this.path = []; this.roamTarget = null; }
    }

    // escalation: chase gets faster the longer it lasts
    let speed = SPEEDS[this.state];
    if (this.state === STATE.CHASE) speed += clamp((CHASE_DIST - nd) / CHASE_DIST, 0, 1) * 0.9;

    // direct pursuit when very close & visible — corners cut, no grid snap
    let tx, tz;
    if (this.state === STATE.CHASE && nd < CELL * 1.6) {
      tx = np.x; tz = np.z;
    } else if (this.path.length) {
      const wp = this.path[0];
      if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.6) this.path.shift();
      const w2 = this.path[0];
      if (w2) { tx = w2.x; tz = w2.z; }
    }

    if (tx !== undefined) {
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const want = Math.atan2(dx, dz);
      let dh = want - this.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      this.heading += clamp(dh, -4.5 * dt, 4.5 * dt);
      this.pos.x += Math.sin(this.heading) * speed * dt;
      this.pos.z += Math.cos(this.heading) * speed * dt;
      this.moveAmount = damp(this.moveAmount, clamp(speed / 4.5, 0.3, 1.2), 6, dt);
    } else {
      this.moveAmount = damp(this.moveAmount, 0, 6, dt);
    }

    this.group.position.copy(this.pos);
    this._animate(dt);
  }

  // ---- guest mirror ----

  netState() {
    return { p: [this.pos.x, this.pos.z], h: this.heading, s: this.state, m: this.moveAmount };
  }

  applyNet(msg, lerpTime) {
    if (!this.active) { this.spawnAt(msg.p[0], msg.p[1]); }
    this.netFrom.copy(this.group.position);
    this.netTo.set(msg.p[0], 0, msg.p[1]);
    this.netT = 0;
    this.netLerpTime = lerpTime;
    this.netHeadingTo = msg.h;
    this.state = msg.s;
    this.moveAmount = msg.m;
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
    if (!this._model) return;
    // procedural stride: bob, sway, forward lean scaled by speed
    const k = this.moveAmount;
    const f = 5.5 + k * 3.5;
    this._model.position.y = this._baseY + Math.abs(Math.sin(this.t * f)) * 0.09 * k;
    this._model.rotation.z = Math.sin(this.t * f) * 0.06 * k;
    this._model.rotation.x = -0.06 * k;
  }

  // fear factor for MY camera: 0 far → 1 about-to-die
  fearFor(px, pz) {
    if (!this.active) return 0;
    const d = Math.hypot(px - this.pos.x, pz - this.pos.z);
    let f = clamp(1 - d / 26, 0, 1);
    if (this.state === STATE.CHASE) f = Math.max(f, clamp(1 - d / 34, 0, 1)) * 1.15;
    return clamp(f, 0, 1);
  }

  isScaring(px, pz) {
    if (!this.active) return false;
    return Math.hypot(px - this.pos.x, pz - this.pos.z) < CLARK_SCARE_DIST;
  }

  // snap to lunge at the camera during a jumpscare
  lungeAt(camera) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    this.group.position.set(
      camera.position.x + dir.x * 1.1,
      0,
      camera.position.z + dir.z * 1.1
    );
    this.heading = Math.atan2(-dir.x, -dir.z);
    this.group.rotation.y = this.heading;
    this.moveAmount = 0;
  }
}
