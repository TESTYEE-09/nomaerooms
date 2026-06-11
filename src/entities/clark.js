// Pirate Clark — the entity. Now loads a GLB model (Captain Clark from the Backrooms).
// Falls back to procedural geometry if the model fails to load.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CELL, CLARK_SCARE_DIST } from '../core/config.js';
import { clamp, damp } from '../core/utils.js';
import * as gen from '../world/generator.js';

export const STATE = { ROAM: 0, STALK: 1, CHASE: 2 };
const SPEEDS = { [STATE.ROAM]: 1.1, [STATE.STALK]: 2.3, [STATE.CHASE]: 4.7 };
const STALK_DIST = 55;
const CHASE_DIST = 18;
const REPATH_S = 0.7;
const TARGET_HEIGHT = 2.0;

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

    this._mixer = null;
    this._model = null;
    this._glbLoaded = false;

    // aura light
    const aura = new THREE.PointLight(0x4a3050, 2.5, 7, 1.8);
    aura.position.y = 1.9;
    this.group.add(aura);
  }

  async load(onProgress) {
    console.log('[clark] load() — attempting GLB');
    try {
      const loader = new GLTFLoader();
      const gltf = await new Promise((resolve, reject) => {
        loader.load(
          `${import.meta.env.BASE_URL}models/captain_clark.glb`,
          resolve,
          (ev) => { if (onProgress) onProgress(ev); },
          reject
        );
      });

      const model = gltf.scene;

      // Skinned meshes can't be measured with Box3.setFromObject — the
      // vertices are positioned by bones on the GPU. Compute each mesh's
      // local-to-model-root matrix and apply it to the geometry bounds.
      model.updateMatrixWorld(true);
      const rootInv = model.matrixWorld.clone().invert();
      const box = new THREE.Box3();
      model.traverse((child) => {
        if (child.isMesh && child.geometry?.attributes?.position) {
          child.geometry.computeBoundingBox();
          const b = child.geometry.boundingBox.clone();
          const localMat = rootInv.clone().multiply(child.matrixWorld);
          b.applyMatrix4(localMat);
          box.union(b);
        }
      });
      if (box.isEmpty()) box.setFromObject(model);

      const h = box.max.y - box.min.y;
      const scale = TARGET_HEIGHT / (h || 1);
      model.scale.setScalar(scale);

      // recenter horizontally, plant feet on ground
      model.position.set(
        -(box.min.x + box.max.x) / 2 * scale,
        -box.min.y * scale,
        -(box.min.z + box.max.z) / 2 * scale,
      );

      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.frustumCulled = false;
        }
      });

      this._model = model;
      this.group.add(model);
      this._glbLoaded = true;

      // set up animation mixer if the model has animations
      if (gltf.animations?.length) {
        this._mixer = new THREE.AnimationMixer(model);
        this._walkAction = this._mixer.clipAction(gltf.animations[0]);
        this._walkAction.play();
        this._walkAction.paused = true;
      }

      console.log('[clark] GLB loaded, scaled to', TARGET_HEIGHT, 'm');
    } catch (e) {
      console.warn('[clark] GLB failed, using procedural fallback:', e);
      this._model = this._createFallbackModel();
      this.group.add(this._model);
      if (onProgress) onProgress({ loaded: 1, total: 1 });
    }
  }

  _createFallbackModel() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a1a2e, roughness: 0.8, metalness: 0.1 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x663388 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.0, 4, 8), mat);
    torso.position.y = 1.3; torso.castShadow = true; group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), mat);
    head.position.y = 2.05; head.scale.set(1, 1.3, 1); head.castShadow = true; group.add(head);

    const eyeGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const leftEye = new THREE.Mesh(eyeGeo, glowMat);
    leftEye.position.set(-0.06, 2.1, 0.18); group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, glowMat);
    rightEye.position.set(0.06, 2.1, 0.18); group.add(rightEye);

    const armGeo = new THREE.CapsuleGeometry(0.07, 1.1, 4, 8);
    const leftArm = new THREE.Mesh(armGeo, mat);
    leftArm.position.set(-0.35, 1.2, 0); leftArm.rotation.z = 0.3; leftArm.castShadow = true; group.add(leftArm);
    this._leftArm = leftArm;
    const rightArm = new THREE.Mesh(armGeo, mat);
    rightArm.position.set(0.35, 1.2, 0); rightArm.rotation.z = -0.3; rightArm.castShadow = true; group.add(rightArm);
    this._rightArm = rightArm;

    const legGeo = new THREE.CapsuleGeometry(0.09, 0.85, 4, 8);
    const leftLeg = new THREE.Mesh(legGeo, mat);
    leftLeg.position.set(-0.12, 0.45, 0); leftLeg.castShadow = true; group.add(leftLeg);
    this._leftLeg = leftLeg;
    const rightLeg = new THREE.Mesh(legGeo, mat);
    rightLeg.position.set(0.12, 0.45, 0); rightLeg.castShadow = true; group.add(rightLeg);
    this._rightLeg = rightLeg;

    const flapGeo = new THREE.PlaneGeometry(0.3, 0.7);
    const flapMat = new THREE.MeshStandardMaterial({ color: 0x1a0a1e, roughness: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const flap = new THREE.Mesh(flapGeo, flapMat);
      const angle = (i - 1.5) * 0.5;
      flap.position.set(Math.sin(angle) * 0.25, 1.0, Math.cos(angle) * 0.25);
      flap.rotation.y = angle;
      group.add(flap);
    }
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

  hostUpdate(dt, players) {
    if (!this.active || !players.length) return;
    this.t += dt;
    if (this._mixer) this._mixer.update(dt);

    let nd = Infinity, np = players[0];
    for (const p of players) {
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d < nd) { nd = d; np = p; }
    }

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
    if (this._mixer) this._mixer.update(dt);
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

    // GLB models use the animation mixer; animate walk speed
    if (this._glbLoaded && this._walkAction) {
      this._walkAction.paused = this.moveAmount < 0.05;
      this._walkAction.timeScale = 0.5 + this.moveAmount * 1.5;
      return;
    }

    // procedural fallback animation
    if (!this._model) return;
    const k = this.moveAmount;
    const f = 5.5 + k * 3.5;
    if (this._leftLeg) this._leftLeg.rotation.x = Math.sin(this.t * f) * 0.6 * k;
    if (this._rightLeg) this._rightLeg.rotation.x = Math.sin(this.t * f + Math.PI) * 0.6 * k;
    if (this._leftArm) this._leftArm.rotation.x = Math.sin(this.t * f + Math.PI) * 0.4 * k + 0.3;
    if (this._rightArm) this._rightArm.rotation.x = Math.sin(this.t * f) * 0.4 * k + 0.3;
    this._model.position.y = Math.abs(Math.sin(this.t * f)) * 0.05 * k;
    this._model.rotation.x = -0.05 * k;
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
    if (this._mixer) this._mixer.update(dt);
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
    if (this._model) this._model.rotation.x = -0.35 * k;
  }
}
