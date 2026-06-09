// pirate-clark.js — the antagonist
//
// Pirate Clark is a tall, gangly humanoid that stalks the player through the
// Backrooms. He's spawned at a random distant room and path-finds toward the
// player using simple straight-line pursuit with obstacle avoidance.
//
// Two rendering modes:
//  1. PROXY MODEL: built procedurally from Three primitives. Always works.
//     This is the default and ships in the bundle.
//  2. GLTF MODEL: if you place a GLTF at /assets/models/pirate-clark.glb, the
//     loader will swap to it. Set USE_GLTF = true.
//
// License: the Sketchfab model referenced in the README is CC-BY-4.0
// (Slightlyoversizedsweater) and ships in the bundle under
// /assets/models/pirate-clark.glb. The credit is shown in the in-game
// "credits" overlay (key: C). Set USE_GLTF = false to fall back to the
// procedural proxy model (used during development when the GLB isn't
// available yet).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getColliders } from '../world/world.js';

const USE_GLTF = true; // the GLB ships in the bundle
const MODEL_URL = './assets/models/pirate-clark.glb';

// ---- AI tuning ----
const SPEED = 2.6;
const SIGHT_RANGE = 80;
const HEAR_RANGE = 30;
const STUCK_TIMEOUT = 4.0;
const JUMPSCARE_DIST = 2.5;
const MAX_TURN_PER_SEC = 1.4; // radians
const HEIGHT = 2.6;            // visual height
const RADIUS = 0.45;

export class PirateClark {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.alive = false;
    this.heading = 0;
    this.targetHeading = 0;
    this.lastMoveT = 0;
    this.lastSeenPlayerPos = new THREE.Vector3();
    this.t = 0;
    this.jumpscare = false;
    this._gltfTried = false;
    this._gltfMesh = null;

    this._buildProxy();
    scene.add(this.group);
    this._tryLoadGLTF();
  }

  async _tryLoadGLTF() {
    if (!USE_GLTF || this._gltfTried) return;
    this._gltfTried = true;
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(MODEL_URL);
      const m = gltf.scene;
      m.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = false;
          // Enable shadows for any standard materials
          if (o.material) {
            o.material.side = THREE.FrontSide;
          }
        }
      });
      // Normalize scale to HEIGHT
      const box = new THREE.Box3().setFromObject(m);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const s = HEIGHT / maxDim;
      m.scale.setScalar(s);
      // Recompute box after scale to position the model so its feet are at y=0
      const box2 = new THREE.Box3().setFromObject(m);
      m.position.y = -box2.min.y; // feet on the floor
      this._gltfMesh = m;
      this._gltfAnimations = gltf.animations || [];
      this._gltfMixer = null;
      if (this._gltfAnimations.length > 0) {
        this._gltfMixer = new THREE.AnimationMixer(m);
        // play the first clip (usually a walk/idle) looped
        const action = this._gltfMixer.clipAction(this._gltfAnimations[0]);
        action.play();
      }
      this.group.add(m);
      this._gltfMesh.visible = false;
      console.log(`[clark] loaded GLB: ${this._gltfAnimations.length} animation(s)`);
    } catch (e) {
      console.warn('[clark] GLTF not found — using proxy model.', e?.message);
    }
  }

  _buildProxy() {
    // Tall gaunt figure: dark coat, pale skin, no face detail (liminal).
    const g = this.group;

    const coatMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92, metalness: 0.0 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x5a4838, roughness: 0.8, metalness: 0.0 });
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.7, metalness: 0.1 });
    // emissive eyes — pushed above the bloom threshold so they glow
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xff1414, emissiveIntensity: 5.0, roughness: 1.0,
    });
    this._eyeMat = eyeMat;
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 0.6, metalness: 0.15 });

    const proxy = new THREE.Group();
    this._proxy = proxy;
    g.add(proxy);

    // a dim red light at the head so he casts a faint bloody wash on nearby walls
    const menace = new THREE.PointLight(0xff1a1a, 1.2, 5, 2.0);
    menace.position.set(0, 2.45, 0.15);
    proxy.add(menace);
    this._menace = menace;

    // Torso (long coat) — tapered
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.55, 1.8, 8),
      coatMat
    );
    torso.position.y = 1.4;
    proxy.add(torso);

    // Belt
    const belt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.56, 0.56, 0.1, 8),
      beltMat
    );
    belt.position.y = 0.95;
    proxy.add(belt);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      skinMat
    );
    head.position.y = 2.45;
    head.scale.set(1, 1.15, 1);
    proxy.add(head);

    // Pirate hat
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.12, 10),
      hatMat
    );
    hat.position.y = 2.6;
    proxy.add(hat);
    const hatBrim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.04, 10),
      hatMat
    );
    hatBrim.position.y = 2.55;
    proxy.add(hatBrim);

    // Eyes (glowing red dots)
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat);
    eyeL.position.set(-0.07, 2.48, 0.2);
    proxy.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.07;
    proxy.add(eyeR);
    this._eyeL = eyeL;
    this._eyeR = eyeR;

    // Arms (long, dangling)
    const armGeom = new THREE.CylinderGeometry(0.07, 0.05, 1.2, 6);
    const armL = new THREE.Mesh(armGeom, coatMat);
    armL.position.set(-0.38, 1.5, 0);
    armL.rotation.z = 0.15;
    proxy.add(armL);
    const armR = armL.clone();
    armR.position.x = 0.38;
    armR.rotation.z = -0.15;
    proxy.add(armR);
    this._armL = armL;
    this._armR = armR;

    // Legs
    const legGeom = new THREE.CylinderGeometry(0.1, 0.08, 0.7, 6);
    const legL = new THREE.Mesh(legGeom, coatMat);
    legL.position.set(-0.15, 0.4, 0);
    proxy.add(legL);
    const legR = legL.clone();
    legR.position.x = 0.15;
    proxy.add(legR);
    this._legL = legL;
    this._legR = legR;

    proxy.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this._proxy = proxy;
  }

  spawn(spawnPos) {
    // Spawn 50–80 units away from the player, in a random direction
    const a = Math.random() * Math.PI * 2;
    const d = 50 + Math.random() * 30;
    this.group.position.set(
      spawnPos.x + Math.cos(a) * d,
      0,
      spawnPos.z + Math.sin(a) * d
    );
    this.heading = a + Math.PI; // facing player
    this.targetHeading = this.heading;
    this.lastSeenPlayerPos.copy(spawnPos);
    this.alive = true;
    this.jumpscare = false;
    this.lastMoveT = 0;
    this.group.visible = true;
    if (this._gltfMesh) this._gltfMesh.visible = true;
    if (this._proxy) this._proxy.visible = false;
  }

  despawn() {
    this.alive = false;
    this.group.visible = false;
  }

  update(dt, playerPos) {
    if (!this.alive) return;

    this.t += dt;

    // Advance GLTF animations if loaded
    if (this._gltfMixer) this._gltfMixer.update(dt);

    // Eye glow pulse (only if proxy model — GLB doesn't have these refs)
    if (this._eyeMat) {
      const pulse = 0.7 + 0.3 * Math.sin(this.t * 3.0);
      this._eyeMat.emissiveIntensity = 5.0 * pulse;
      if (this._menace) this._menace.intensity = 1.2 * pulse;
    }

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.group.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    this.lastSeenPlayerPos.copy(playerPos);

    // smooth turn toward player
    const desired = Math.atan2(toPlayer.x, toPlayer.z);
    let delta = desired - this.targetHeading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const turn = Math.sign(delta) * Math.min(Math.abs(delta), MAX_TURN_PER_SEC * dt);
    this.targetHeading += turn;
    this.heading = this.targetHeading;

    // step
    if (dist > JUMPSCARE_DIST) {
      const forward = new THREE.Vector3(Math.sin(this.targetHeading), 0, Math.cos(this.targetHeading));
      const step = forward.multiplyScalar(SPEED * dt);
      this.group.position.add(step);
      this.lastMoveT += dt;
    } else {
      this.jumpscare = true;
    }

    // collision: simple AABB test vs colliders; push back if intersecting
    const myBox = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(this.group.position.x, 1.3, this.group.position.z),
      new THREE.Vector3(RADIUS * 2, HEIGHT, RADIUS * 2)
    );
    const colliders = getColliders();
    for (const c of colliders) {
      if (myBox.intersectsBox(c.box)) {
        // push out the shortest axis
        const cx = (c.box.min.x + c.box.max.x) / 2;
        const cz = (c.box.min.z + c.box.max.z) / 2;
        const dx = this.group.position.x - cx;
        const dz = this.group.position.z - cz;
        if (Math.abs(dx) > Math.abs(dz)) {
          this.group.position.x = cx + Math.sign(dx) * (RADIUS + (c.box.max.x - c.box.min.x) / 2);
        } else {
          this.group.position.z = cz + Math.sign(dz) * (RADIUS + (c.box.max.z - c.box.min.z) / 2);
        }
        // turn slightly when stuck
        this.targetHeading += 0.5;
        this.lastMoveT = 0;
      }
    }

    // anim
    this.group.rotation.y = this.targetHeading;
    if (this._proxy) {
      const swing = Math.sin(this.t * 4) * 0.6;
      this._armL.rotation.x = swing;
      this._armR.rotation.x = -swing;
      this._legL.rotation.x = -swing * 0.5;
      this._legR.rotation.x = swing * 0.5;
      // tilt head occasionally
      this._proxy.children[2].rotation.z = Math.sin(this.t * 0.6) * 0.06;
    }

    return { dist, jumpscare: this.jumpscare };
  }
}

export { JUMPSCARE_DIST };
