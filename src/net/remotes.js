// Remote players: hazmat-suit avatar tinted with their colour, name label
// sprite, and proximity chat bubbles that fade with distance and age.
// Procedurally generated — no external model files needed.

import * as THREE from 'three';
import { EYE_HEIGHT, PLAYER_HEIGHT } from '../core/config.js';

const BUBBLE_TTL = 7;
const BUBBLE_RANGE = 24;

function textSprite(text, { font = '600 26px system-ui, sans-serif', pad = 10, bg = null, fg = '#fff' } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const w = Math.min(560, Math.ceil(ctx.measureText(text).width) + pad * 2);
  c.width = w;
  c.height = 44 + pad;
  const ctx2 = c.getContext('2d');
  if (bg) {
    ctx2.fillStyle = bg;
    ctx2.beginPath();
    ctx2.roundRect(0, 0, c.width, c.height, 10);
    ctx2.fill();
  }
  ctx2.font = font;
  ctx2.fillStyle = fg;
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  ctx2.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  const scale = 0.011;
  sp.scale.set(c.width * scale, c.height * scale, 1);
  return sp;
}

function createHazmatModel(color) {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.7,
    metalness: 0.1,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x1a3a5c,
    roughness: 0.1,
    metalness: 0.8,
    transparent: true,
    opacity: 0.6,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x444444,
    roughness: 0.5,
    metalness: 0.3,
  });

  // Scale to PLAYER_HEIGHT
  const scale = PLAYER_HEIGHT / 1.8;

  // Torso
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22 * scale, 0.6 * scale, 4, 8),
    baseMat
  );
  torso.position.y = 1.0 * scale;
  torso.castShadow = true;
  group.add(torso);

  // Head/helmet
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.18 * scale, 8, 8),
    baseMat
  );
  helmet.position.y = 1.55 * scale;
  helmet.scale.set(1, 1.1, 1);
  helmet.castShadow = true;
  group.add(helmet);

  // Visor
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.22 * scale, 0.12 * scale, 0.02 * scale),
    visorMat
  );
  visor.position.set(0, 1.58 * scale, 0.19 * scale);
  group.add(visor);

  // Arms
  const armGeo = new THREE.CapsuleGeometry(0.06 * scale, 0.65 * scale, 4, 8);
  const leftArm = new THREE.Mesh(armGeo, baseMat);
  leftArm.position.set(-0.25 * scale, 1.1 * scale, 0);
  leftArm.rotation.z = 0.2;
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, baseMat);
  rightArm.position.set(0.25 * scale, 1.1 * scale, 0);
  rightArm.rotation.z = -0.2;
  rightArm.castShadow = true;
  group.add(rightArm);

  // Legs
  const legGeo = new THREE.CapsuleGeometry(0.07 * scale, 0.7 * scale, 4, 8);
  const leftLeg = new THREE.Mesh(legGeo, baseMat);
  leftLeg.position.set(-0.09 * scale, 0.4 * scale, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, baseMat);
  rightLeg.position.set(0.09 * scale, 0.4 * scale, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  // Backpack/tank
  const tank = new THREE.Mesh(
    new THREE.BoxGeometry(0.18 * scale, 0.35 * scale, 0.12 * scale),
    accentMat
  );
  tank.position.set(0, 1.1 * scale, -0.22 * scale);
  tank.castShadow = true;
  group.add(tank);

  // Gloves/boots accents
  const gloveMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.4,
    metalness: 0.2,
  });
  const gloveGeo = new THREE.SphereGeometry(0.07 * scale, 6, 6);
  const leftGlove = new THREE.Mesh(gloveGeo, gloveMat);
  leftGlove.position.set(-0.25 * scale, 0.5 * scale, 0);
  group.add(leftGlove);
  const rightGlove = new THREE.Mesh(gloveGeo, gloveMat);
  rightGlove.position.set(0.25 * scale, 0.5 * scale, 0);
  group.add(rightGlove);

  const bootGeo = new THREE.BoxGeometry(0.1 * scale, 0.08 * scale, 0.18 * scale);
  const leftBoot = new THREE.Mesh(bootGeo, gloveMat);
  leftBoot.position.set(-0.09 * scale, 0.04 * scale, 0.02 * scale);
  group.add(leftBoot);
  const rightBoot = new THREE.Mesh(bootGeo, gloveMat);
  rightBoot.position.set(0.09 * scale, 0.04 * scale, 0.02 * scale);
  group.add(rightBoot);

  return { group, leftArm, rightArm, leftLeg, rightLeg };
}

class Avatar {
  constructor(scene, info) {
    this.scene = scene;
    this.info = info;
    this.group = new THREE.Group();

    const model = createHazmatModel(new THREE.Color(info.color || '#e8842c').getHex());
    this.model = model.group;
    this._leftArm = model.leftArm;
    this._rightArm = model.rightArm;
    this._leftLeg = model.leftLeg;
    this._rightLeg = model.rightLeg;
    this._modelBaseY = this.model.position.y;
    this.group.add(this.model);

    this.label = textSprite(info.name || '???', { fg: '#e8ffe8', bg: 'rgba(0,0,0,0.45)' });
    this.label.position.y = EYE_HEIGHT + 0.45;
    this.group.add(this.label);

    this.bubble = null;
    this.bubbleT = 0;

    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.lerpT = 1;
    this.yawTo = 0;
    this.yaw = 0;
    this.pitchTo = 0;
    this.moving = false;
    this.walkPhase = 0;
    this.initialized = false;

    scene.add(this.group);
  }

  applyState(msg) {
    if (!this.initialized) {
      this.group.position.set(msg.p[0], 0, msg.p[1]);
      this.initialized = true;
    }
    this.group.visible = !msg.dead;
    this.from.copy(this.group.position);
    this.to.set(msg.p[0], msg.y || 0, msg.p[1]);
    this.lerpT = 0;
    this.yawTo = msg.ry;
    this.pitchTo = msg.pi || 0;
    this.moving = !!msg.mv;
  }

  say(text) {
    if (this.bubble) {
      this.group.remove(this.bubble);
      this.bubble.material.map.dispose();
      this.bubble.material.dispose();
    }
    this.bubble = textSprite(text, { bg: 'rgba(8,12,6,0.78)', fg: '#eaffea', font: '500 24px system-ui, sans-serif' });
    this.bubble.position.y = EYE_HEIGHT + 0.85;
    this.group.add(this.bubble);
    this.bubbleT = 0;
  }

  update(dt, camPos) {
    this.lerpT = Math.min(1, this.lerpT + dt / 0.12);
    this.group.position.lerpVectors(this.from, this.to, this.lerpT);
    let dy = this.yawTo - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 12);
    this.group.rotation.y = this.yaw;

    if (this.moving) this.walkPhase += dt * 9;
    if (this.model) {
      const bob = this.moving ? Math.abs(Math.sin(this.walkPhase)) * 0.04 : 0;
      this.model.position.y = this._modelBaseY + bob;
      // Animate limbs
      const f = this.walkPhase;
      if (this._leftArm) this._leftArm.rotation.x = Math.sin(f) * 0.3 + 0.2;
      if (this._rightArm) this._rightArm.rotation.x = Math.sin(f + Math.PI) * 0.3 + 0.2;
      if (this._leftLeg) this._leftLeg.rotation.x = Math.sin(f) * 0.5;
      if (this._rightLeg) this._rightLeg.rotation.x = Math.sin(f + Math.PI) * 0.5;
    }

    const dist = camPos.distanceTo(this.group.position);
    this.label.material.opacity = THREE.MathUtils.clamp(1.4 - dist / 18, 0, 1);

    if (this.bubble) {
      this.bubbleT += dt;
      const age = this.bubbleT < BUBBLE_TTL - 1 ? 1 : Math.max(0, BUBBLE_TTL - this.bubbleT);
      const prox = THREE.MathUtils.clamp(1.25 - dist / BUBBLE_RANGE, 0, 1);
      const fadeIn = Math.min(1, this.bubbleT * 4);
      this.bubble.material.opacity = age * prox * fadeIn;
      if (this.bubbleT > BUBBLE_TTL) {
        this.group.remove(this.bubble);
        this.bubble.material.map.dispose();
        this.bubble.material.dispose();
        this.bubble = null;
      }
    }
    return dist;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isSprite) {
        o.material?.map?.dispose();
        o.material?.dispose();
      } else if (o.isMesh) {
        o.geometry?.dispose();
        o.material?.dispose();
      }
    });
  }
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
  }
  add(id, info) {
    if (this.map.has(id)) this.remove(id);
    this.map.set(id, new Avatar(this.scene, info));
  }
  remove(id) {
    this.map.get(id)?.dispose();
    this.map.delete(id);
  }
  applyState(id, msg) { this.map.get(id)?.applyState(msg); }
  say(id, text) { this.map.get(id)?.say(text); }
  distanceTo(id, camPos) {
    const a = this.map.get(id);
    return a ? camPos.distanceTo(a.group.position) : Infinity;
  }
  positions() {
    return [...this.map.entries()].map(([id, a]) => ({ id, x: a.group.position.x, z: a.group.position.z }));
  }
  update(dt, camPos) {
    for (const a of this.map.values()) a.update(dt, camPos);
  }
  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }
}