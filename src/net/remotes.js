// Remote players: hazmat-suit avatar tinted with their colour, name label
// sprite, and proximity chat bubbles that fade with distance and age.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { EYE_HEIGHT, PLAYER_HEIGHT } from '../core/config.js';

const BUBBLE_TTL = 7;       // seconds a chat bubble lingers
const BUBBLE_RANGE = 24;    // metres at which bubbles become unreadable

const MODEL_URL = './assets/models/hazmat.glb';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

// Loaded once and shared: every Avatar gets a SkeletonUtils.clone() of this
// (a plain Object3D.clone() doesn't keep skinned-mesh bones in sync).
let _modelPromise = null;
function loadModel() {
  if (!_modelPromise) {
    _modelPromise = new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.setDRACOLoader(dracoLoader);
      loader.load(MODEL_URL, (gltf) => {
        const m = gltf.scene;
        m.traverse((o) => {
          if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; }
        });
        // Normalize by vertical extent so every avatar stands PLAYER_HEIGHT
        // tall with feet at y=0 (same trick as Clark's model).
        const size = new THREE.Vector3();
        new THREE.Box3().setFromObject(m).getSize(size);
        const scale = PLAYER_HEIGHT / size.y;
        m.scale.setScalar(scale);
        const minY = new THREE.Box3().setFromObject(m).min.y;
        m.position.y = -minY;
        resolve(m);
      }, undefined, reject);
    });
  }
  return _modelPromise;
}

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

class Avatar {
  constructor(scene, info) {
    this.scene = scene;
    this.info = info;
    this.group = new THREE.Group();

    this.head = null;   // resolved once the model loads (used for pitch tilt)
    this.model = null;
    loadModel().then((proto) => {
      const m = cloneSkeleton(proto);
      const color = new THREE.Color(info.color || '#7da2ff');
      m.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          o.material.color = color;
        }
      });
      this.model = m;
      this._modelBaseY = m.position.y;
      this.head = m.getObjectByName('Head_1') || null;
      this.group.add(m);
    }).catch((e) => console.warn('[remotes] failed to load avatar model', e));

    this.label = textSprite(info.name || '???', { fg: '#e8ffe8', bg: 'rgba(0,0,0,0.45)' });
    this.label.position.y = EYE_HEIGHT + 0.45;
    this.group.add(this.label);

    this.bubble = null;
    this.bubbleT = 0;

    // interpolation
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
    if (this.head) this.head.rotation.x = -this.pitchTo * 0.6;

    if (this.moving) this.walkPhase += dt * 9;
    if (this.model) {
      const bob = this.moving ? Math.abs(Math.sin(this.walkPhase)) * 0.04 : 0;
      this.model.position.y = this._modelBaseY + bob;
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
      } else if (o.isMesh && !this.model) {
        // capsule/sphere placeholder geometry — owned by this instance
        o.geometry?.dispose();
        o.material?.dispose();
      }
      // model meshes share geometry/textures across avatars (SkeletonUtils
      // clone) and only their per-instance cloned material would be safe to
      // dispose, but it's cheap enough to just leak until the model itself
      // is reloaded (page navigation), so skip it.
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
