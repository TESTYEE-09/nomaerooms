// Clark — the entity. Procedural monster model with optional pirate GLB.
// Tall, gaunt, twitching, with glowing eyes and unsettling movement.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CELL, CLARK_SCARE_DIST } from '../core/config.js';
import { clamp, damp } from '../core/utils.js';
import { settings } from '../core/settings.js';
import * as gen from '../world/generator.js';

export const STATE = { ROAM: 0, STALK: 1, CHASE: 2 };
const SPEEDS = { [STATE.ROAM]: 1.1, [STATE.STALK]: 2.3, [STATE.CHASE]: 4.7 };
const STALK_DIST = 55;
const CHASE_DIST = 18;
const REPATH_S = 0.7;
const TARGET_HEIGHT = 4.0;

export class Clark {
  constructor(scene) {
    console.log('[clark] constructor called');
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.state = STATE.ROAM;
    this.active = false;
    this.t = 0;
    this.moveAmount = 0;

    this.path = [];
    this.repathT = 0;
    this.roamTarget = null;

    this.netFrom = new THREE.Vector3();
    this.netTo = new THREE.Vector3();
    this.netT = 1;
    this.netHeadingTo = 0;

    this._model = null;
    this._pirateGroup = null;
    this._usePirate = false;
  }

  syncModel() {
    this._usePirate = settings.pirateClark && !!this._pirateGroup;
    if (this._model) this._model.visible = !this._usePirate;
    if (this._pirateGroup) this._pirateGroup.visible = this._usePirate;
  }

  async load(onProgress) {
    console.log('[clark] load() — building models');

    // always build procedural model
    this._model = this._createMonsterModel();
    this.group.add(this._model);

    // try loading pirate GLB
    try {
      const loader = new GLTFLoader();
      const gltf = await new Promise((res, rej) => {
        loader.load(import.meta.env.BASE_URL + 'models/captain_clark.glb', res, undefined, rej);
      });
      this._pirateGroup = gltf.scene;
      this._brightenModelMaterial(this._pirateGroup);
      this._pirateGroup.visible = false;
      this._pirateGroup.scale.setScalar(2.0);
      this.group.add(this._pirateGroup);
      console.log('[clark] pirate model loaded');
    } catch (e) {
      console.warn('[clark] pirate model failed to load:', e.message);
    }

    if (onProgress) onProgress({ loaded: 1, total: 1 });
  }

  _brightenModelMaterial(root) {
    root.traverse((child) => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.roughness = 0.7;
        child.material.metalness = 0.0;
        child.material.color.multiplyScalar(3.5);
        child.material.needsUpdate = true;
        child.castShadow = true;
      }
    });
  }

  _createMonsterModel() {
    const group = new THREE.Group();

    const skin = new THREE.MeshStandardMaterial({
      color: 0x1a0f1e, roughness: 0.85, metalness: 0.05,
    });
    const darkSkin = new THREE.MeshStandardMaterial({
      color: 0x0d0510, roughness: 0.9, metalness: 0.0,
    });
    const eyeGlow = new THREE.MeshBasicMaterial({ color: 0xff2266 });
    const innerGlow = new THREE.MeshBasicMaterial({ color: 0x661133, transparent: true, opacity: 0.6 });

    // ---- torso - long gaunt body ----
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.35, 1.8, 8), skin);
    torso.position.y = 2.2; torso.castShadow = true; group.add(torso);

    // ribs - exposed bone-like rings
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x2a1a18, roughness: 0.9, metalness: 0.0 });
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.4 + i * 0.02, 0.025, 4, 8), ribMat);
      rib.position.y = 1.5 + i * 0.3;
      rib.rotation.x = Math.PI / 2;
      rib.scale.set(1, 1, 0.3 + i * 0.05);
      group.add(rib);
    }

    // spine ridges
    for (let i = 0; i < 7; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12 + (6 - i) * 0.025, 4), darkSkin);
      spike.position.set(0, 1.4 + i * 0.3, -0.3);
      spike.rotation.x = 0.3;
      group.add(spike);
    }

    // ---- head - elongated skull ----
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x0d0510, roughness: 0.6, metalness: 0.1,
    });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 10), headMat);
    head.position.y = 3.3;
    head.scale.set(0.9, 1.6, 0.8);
    head.castShadow = true;
    group.add(head);

    // jaw
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.25), headMat);
    jaw.position.set(0, 3.0, 0.25);
    group.add(jaw);

    // teeth
    const toothMat = new THREE.MeshStandardMaterial({ color: 0xeee8d0, roughness: 0.4 });
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 4), toothMat);
      tooth.position.set(i * 0.06, 3.05, 0.32);
      tooth.rotation.x = 0.3;
      group.add(tooth);
    }

    // eyes - hollow glowing pits
    const eyeSockMat = new THREE.MeshStandardMaterial({ color: 0x050005, roughness: 0.0, metalness: 0.5 });
    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), eyeSockMat);
      socket.position.set(side * 0.13, 3.45, 0.28);
      socket.scale.set(1, 0.7, 0.6);
      group.add(socket);

      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), eyeGlow);
      glow.position.set(side * 0.13, 3.45, 0.32);
      group.add(glow);

      const inner = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 4), innerGlow);
      inner.position.set(side * 0.13, 3.44, 0.35);
      group.add(inner);
    }

    // ---- arms - long, spindly ----
    const armMat = new THREE.MeshStandardMaterial({ color: 0x15091a, roughness: 0.8, metalness: 0.05 });
    for (const side of [-1, 1]) {
      const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.0, 6), armMat);
      upperArm.position.set(side * 0.6, 2.4, 0);
      upperArm.rotation.z = side * 0.4;
      upperArm.castShadow = true;
      group.add(upperArm);
      this[side === -1 ? '_leftArmUpper' : '_rightArmUpper'] = upperArm;

      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.2, 6), armMat);
      forearm.position.set(side * 0.7, 1.6, 0);
      forearm.rotation.z = side * 0.15;
      forearm.castShadow = true;
      group.add(forearm);
      this[side === -1 ? '_leftArmLower' : '_rightArmLower'] = forearm;

      // clawed hand
      const handMat = new THREE.MeshStandardMaterial({ color: 0x220a10, roughness: 0.7 });
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 5), handMat);
      hand.position.set(side * 0.85, 1.1, 0);
      hand.scale.set(1, 0.6, 0.8);
      group.add(hand);

      // claws
      const clawMat = new THREE.MeshStandardMaterial({ color: 0x332222, roughness: 0.5 });
      for (let c = -1; c <= 1; c++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.12, 4), clawMat);
        claw.position.set(side * 0.9, 1.0, c * 0.04);
        claw.rotation.x = 0.5;
        group.add(claw);
      }
    }

    // ---- legs - long, jointed backward ----
    const legMat = new THREE.MeshStandardMaterial({ color: 0x100617, roughness: 0.85, metalness: 0.0 });
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 1.3, 6), legMat);
      thigh.position.set(side * 0.18, 1.0, 0);
      thigh.rotation.z = side * 0.05;
      thigh.castShadow = true;
      group.add(thigh);
      this[side === -1 ? '_leftThigh' : '_rightThigh'] = thigh;

      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.05, 1.5, 6), legMat);
      shin.position.set(side * 0.18, 0.15, 0);
      shin.rotation.z = side * 0.08;
      shin.castShadow = true;
      group.add(shin);
      this[side === -1 ? '_leftShin' : '_rightShin'] = shin;

      // foot / hoof
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.2), darkSkin);
      foot.position.set(side * 0.18, 0.0, 0.08);
      group.add(foot);
    }

    // ---- aura/glow ----
    const aura = new THREE.PointLight(0x441144, 3.0, 9, 1.8);
    aura.position.y = 2.5;
    group.add(aura);

    this._eyeGlows = [];
    group.traverse((child) => {
      if (child.isMesh && child.material === eyeGlow) {
        this._eyeGlows.push(child);
      }
    });

    return group;
  }

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
    this.syncModel();
  }

  teleport(wx, wz) {
    this.pos.set(wx, 0, wz);
    this.group.position.copy(this.pos);
    this.path = [];
    this.roamTarget = null;
  }

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

  hostUpdate(dt, players, huntedPos) {
    if (!this.active || !players.length) return;
    this.t += dt;

    // If hunted mode is active, Clark always prefers the hunted player
    let nd = Infinity, np = players[0];
    if (huntedPos) {
      const d = Math.hypot(huntedPos.x - this.pos.x, huntedPos.z - this.pos.z);
      nd = d;
      np = huntedPos;
    }
    // Also evaluate nearest for stalk/roam transitions
    let nearestDist = nd, nearestP = np;
    for (const p of players) {
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d < nearestDist) { nearestDist = d; nearestP = p; }
    }
    // Use nearest for state transitions, but hunted for targeting
    nd = nearestDist;

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

    this.repathT -= dt;
    if (this.repathT <= 0 || !this.path.length) {
      this.repathT = this.state === STATE.CHASE ? REPATH_S * 0.5 : REPATH_S;
      const me = gen.worldToCell(this.pos.x, this.pos.z);
      let goal;
      if (this.state === STATE.ROAM) {
        if (!this.roamTarget || Math.hypot(this.roamTarget.x - this.pos.x, this.roamTarget.z - this.pos.z) < CELL) {
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

    let speed = SPEEDS[this.state];
    if (this.state === STATE.CHASE) speed += clamp((CHASE_DIST - nd) / CHASE_DIST, 0, 1) * 0.9;

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

  netState() {
    return { p: [this.pos.x, this.pos.z], h: this.heading, s: this.state, mv: this.moveAmount };
  }

  applyNet(msg, lerpTime) {
    if (!this.active) { this.spawnAt(msg.p[0], msg.p[1]); }
    this.netFrom.copy(this.group.position);
    this.netTo.set(msg.p[0], 0, msg.p[1]);
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
    this.group.rotation.y = this.heading - Math.PI / 2;
    if (!this._model) return;

    // pirate model uses simple bob
    if (this._usePirate && this._pirateGroup) {
      const k = this.moveAmount;
      const moving = k > 0.08;
      const speed = moving ? 5.5 + k * 3.5 : 1.2;
      this._pirateGroup.position.y = moving ? Math.abs(Math.sin(this.t * speed)) * 0.15 * k : 0;
      return;
    }

    const k = this.moveAmount;
    const moving = k > 0.08;
    const speed = moving ? 5.5 + k * 3.5 : 1.2;

    // leg animation - loping gait
    if (this._leftThigh) this._leftThigh.rotation.x = Math.sin(this.t * speed) * 0.5 * k;
    if (this._rightThigh) this._rightThigh.rotation.x = Math.sin(this.t * speed + Math.PI) * 0.5 * k;
    if (this._leftShin) this._leftShin.rotation.x = Math.abs(Math.sin(this.t * speed)) * 0.3 * k;
    if (this._rightShin) this._rightShin.rotation.x = Math.abs(Math.sin(this.t * speed + Math.PI)) * 0.3 * k;

    // arm animation - swinging, predatory
    if (this._leftArmUpper) this._leftArmUpper.rotation.x = Math.sin(this.t * speed + Math.PI) * 0.6 * k + 0.3;
    if (this._rightArmUpper) this._rightArmUpper.rotation.x = Math.sin(this.t * speed) * 0.6 * k + 0.3;
    if (this._leftArmLower) this._leftArmLower.rotation.x = Math.sin(this.t * speed + Math.PI + 0.5) * 0.5 * k + 0.2;
    if (this._rightArmLower) this._rightArmLower.rotation.x = Math.sin(this.t * speed + 0.5) * 0.5 * k + 0.2;

    // idle twitch - subtle random movements even when still
    const idleJitter = (1 - k) * 0.02;
    if (!moving) {
      if (this._leftArmUpper) this._leftArmUpper.rotation.x += Math.sin(this.t * 3.7) * 0.04;
      if (this._rightArmUpper) this._rightArmUpper.rotation.x += Math.sin(this.t * 4.1 + 1) * 0.04;
      if (this._leftThigh) this._leftThigh.rotation.x += Math.sin(this.t * 2.3) * 0.03;
      if (this._rightThigh) this._rightThigh.rotation.x += Math.sin(this.t * 2.7 + 2) * 0.03;
    }

    // body sway / bob
    this._model.position.y = moving ? Math.abs(Math.sin(this.t * speed)) * 0.12 * k : Math.sin(this.t * 0.5) * 0.02;

    // lean forward when moving
    this._model.rotation.x = -0.1 * k;

    // head bob / tilt
    const head = this._model.children.find((c) => c.position.y > 3 && c.position.y < 3.5 && c.type === 'Mesh');
    if (head) {
      head.rotation.z = Math.sin(this.t * (moving ? speed * 0.5 : 1.8)) * 0.05;
      head.rotation.x = Math.sin(this.t * (moving ? speed * 0.3 : 2.2)) * 0.03 - (moving ? 0.05 : 0);
    }

    // eye glow pulse
    for (const g of (this._eyeGlows || [])) {
      const pulse = 0.7 + 0.3 * Math.sin(this.t * 3 + g.position.x);
      g.scale.setScalar(pulse);
      g.material.opacity = g.material.opacity || 1;
    }
  }

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

  beginScare(camera) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    this._scareDir = dir.clone();
    this._scareT = 0;
    this.group.position.set(
      camera.position.x + dir.x * 1.5,
      0,
      camera.position.z + dir.z * 1.5
    );
    this.pos.copy(this.group.position);
    this.heading = Math.atan2(-dir.x, -dir.z);
    this.group.rotation.y = this.heading - Math.PI / 2;
    this.moveAmount = 0;
  }

  scareUpdate(dt, camera) {
    this._scareT += dt;
    this.t += dt;
    const t = this._scareT;
    const k = Math.min(1, t / 1.2);
    let d = 1.5 - 1.15 * (k * k);
    for (const bite of [0.15, 0.5, 0.85]) {
      const bt = t - bite;
      if (bt > 0 && bt < 0.18) d -= 0.2 * Math.sin((bt / 0.18) * Math.PI);
    }
    this.group.position.set(
      camera.position.x + this._scareDir.x * d,
      0,
      camera.position.z + this._scareDir.z * d
    );
    this.pos.copy(this.group.position);
    if (this._model) {
      this._model.rotation.x = -0.35 * k;
      this._animate(dt);
    }
  }
}
