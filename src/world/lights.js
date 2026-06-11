// Fluorescent lighting: a pool of real PointLights is assigned each frame to
// the fixtures nearest the camera; the nearest few become shadow-casting
// SpotLights aimed at the floor. Every pooled fixture's diffuser panel flickers
// via its InstancedMesh colour. Distant fixtures stay emissive-only.

import * as THREE from 'three';
import { hash2 } from '../core/utils.js';
import { WALL_H } from '../core/config.js';

const TINT = new THREE.Color(0.88, 0.98, 0.82);  // sickly fluorescent yellow-green
const GLOW_BRIGHT = 3.2;                          // HDR panel brightness
const POOL_RANGE = 26;                            // metres considered for real lights

export class LightPool {
  constructor(scene) {
    this.scene = scene;
    this.points = [];
    this.spots = [];
    this.assigned = [];     // fixtures currently owning a light (to reset glow)
    this._tmpColor = new THREE.Color();
    this.ambient = new THREE.AmbientLight(0x3c3826, 0.3);
    this.hemi = new THREE.HemisphereLight(0x4c4434, 0x1c190f, 0.25);
    scene.add(this.ambient, this.hemi);
    this.nearestFlicker = 1;  // exposed for audio buzz
    this.nearestDist = 1e9;
  }

  configure({ lights, shadowLights, shadowMap }) {
    for (const l of [...this.points, ...this.spots]) {
      this.scene.remove(l);
      l.dispose?.();
    }
    this.points = [];
    this.spots = [];
    for (let i = 0; i < shadowLights; i++) {
      const s = new THREE.SpotLight(TINT, 0, 13, 1.15, 0.65, 1.4);
      s.castShadow = true;
      s.shadow.mapSize.setScalar(shadowMap);
      s.shadow.camera.near = 0.4;
      s.shadow.camera.far = 13;
      s.shadow.bias = -0.004;
      s.visible = false;
      this.scene.add(s, s.target);
      this.spots.push(s);
    }
    const plain = Math.max(0, lights - shadowLights);
    for (let i = 0; i < plain; i++) {
      const p = new THREE.PointLight(TINT, 0, 13, 1.5);
      p.visible = false;
      this.scene.add(p);
      this.points.push(p);
    }
  }

  // flicker multiplier for a fixture at time t
  _flicker(f, t) {
    const s = f.steadiness;
    const slot = Math.floor(t * 13);
    const r = hash2(slot, f.id, 1234);
    const r2 = hash2(slot + 1, f.id, 5678);

    if (s < 0.1) {
      // dying tube: mostly off, rare stutter
      if (r < 0.35) return 0.01;
      if (r < 0.5) return 0.2 + r2 * 0.5;
      // occasional longer buzz
      const buzzSlot = Math.floor(t * 3);
      if (hash2(buzzSlot, f.id, 333) < 0.2) return 0.4 + r2 * 0.3;
      return 0.01;
    }
    if (s < 0.25) {
      // flickery tube: strobes rapidly
      if (r < 0.3) return 0.01;
      if (r < 0.45) return 0.15 + r2 * 0.2;
      if (r < 0.7) return 0.6 + 0.3 * hash2(slot, f.id, 99);
      return 0.9 + 0.1 * hash2(slot, f.id + 1, 77);
    }
    if (s < 0.45) {
      // mildly erratic: occasional dips
      const dip = hash2(Math.floor(t * 6), f.id, 444);
      if (dip < 0.08) return 0.1 + r2 * 0.3;
      if (dip < 0.15) return 0.5 + r2 * 0.3;
      return 0.85 + 0.15 * hash2(Math.floor(t * 20), f.id, 7);
    }
    // healthy tube: faint mains shimmer with occasional micro-flicker
    const glitch = hash2(Math.floor(t * 8), f.id, 888);
    if (glitch < 0.02) return 0.3 + r2 * 0.4;
    return 0.88 + 0.12 * hash2(Math.floor(t * 24), f.id, 7);
  }

  update(t, px, pz) {
    // reset panels we brightened last frame
    for (const f of this.assigned) {
      if (f.glowMesh) {
        f.glowMesh.setColorAt(f.instance, this._tmpColor.setScalar(1));
        f.glowMesh.instanceColor.needsUpdate = true;
      }
    }
    this.assigned.length = 0;

    const near = this.chunkManager
      ? this.chunkManager.fixturesNear(px, pz, POOL_RANGE)
      : [];
    let li = 0;
    this.nearestDist = near.length ? Math.sqrt(near[0].d2) : 1e9;
    this.nearestFlicker = near.length ? this._flicker(near[0].f, t) : 0;

    for (const { f } of near) {
      const flick = this._flicker(f, t);
      let light = null;
      if (li < this.spots.length) {
        const s = this.spots[li];
        s.position.set(f.x, f.y - 0.15, f.z);
        s.target.position.set(f.x, 0, f.z);
        s.intensity = 55 * flick;
        s.visible = true;
        light = s;
      } else if (li - this.spots.length < this.points.length) {
        const p = this.points[li - this.spots.length];
        p.position.set(f.x, f.y - 0.3, f.z);
        p.intensity = 20 * flick;
        p.visible = true;
        light = p;
      }
      if (!light) break;
      li++;
      if (f.glowMesh) {
        f.glowMesh.setColorAt(
          f.instance,
          this._tmpColor.setRGB(TINT.r, TINT.g, TINT.b).multiplyScalar(0.15 + GLOW_BRIGHT * flick)
        );
        f.glowMesh.instanceColor.needsUpdate = true;
        this.assigned.push(f);
      }
    }
    // park unused lights
    for (let i = li; i < this.spots.length; i++) this.spots[i].visible = false;
    for (let i = Math.max(0, li - this.spots.length); i < this.points.length; i++) this.points[i].visible = false;
  }
}

export { WALL_H };
