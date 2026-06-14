// Moon surfaces: a heightfield terrain with the landing pad flattened at the
// origin, scattered rocks/dead trees, the facility's exterior door, and — on
// the Company moon — the sell counter. Also owns the orbit starfield and the
// sun/sky rig driven by the day clock.

import * as THREE from 'three';
import { valueNoise, mulberry32, clamp, lerp } from '../core/utils.js';
import { MOONS, COMPANY_IDX, DAY_START_H } from '../core/config.js';

const TERRAIN_SIZE = 460;
const TERRAIN_SEGS = 120;
const PAD_R = 15;          // flattened radius around the ship
const DOOR_R = 11;         // flattened radius around the facility door
export const PAD_Y = -0.45; // terrain height at the pad (ship floor is 0)

export class MoonWorld {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.group = null;
    this.moonIdx = -1;
    this.seed = 1;
    this.facDoorPos = null;     // {x,z} exterior facility door
    this.counterPos = null;     // {x,z} company sell counter
    this.bellPos = null;
    this.colliders = [];
    this.isCompany = false;

    // sky rig lives permanently in the scene
    this.sun = new THREE.DirectionalLight(0xfff1d8, 0);
    this.sun.position.set(60, 90, 30);
    this.hemi = new THREE.HemisphereLight(0x9aa5a0, 0x2a2620, 0);
    this.ambient = new THREE.AmbientLight(0x404040, 0.12);
    scene.add(this.sun, this.hemi, this.ambient);

    // orbit starfield
    const starGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(900 * 3);
    const rng = mulberry32(0x57a25);
    for (let i = 0; i < 900; i++) {
      const a = rng() * Math.PI * 2, b = Math.acos(rng() * 2 - 1);
      const r = 320;
      pos[i * 3] = r * Math.sin(b) * Math.cos(a);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(b)) - 40;
      pos[i * 3 + 2] = r * Math.sin(b) * Math.sin(a);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xcfd8ff, size: 1.4, sizeAttenuation: false, fog: false,
    }));
    this.stars.visible = false;
    scene.add(this.stars);
  }

  // ---- heightfield (must match the visual mesh — used for walking) ----

  groundY(x, z) {
    if (this.moonIdx < 0) return PAD_Y;
    const s = this.seed;
    let h = valueNoise(x / 46 + s % 97, z / 46 - s % 53, s ^ 0x7e44) * 9
          + valueNoise(x / 11, z / 11, s ^ 0x123) * 1.6
          - 4.2;
    // bowl rim so you can't walk off the map
    const dEdge = Math.hypot(x, z);
    if (dEdge > 170) h += (dEdge - 170) * 0.35;
    // flatten the pad
    const dPad = Math.hypot(x, z);
    h = lerp(PAD_Y, h, smooth(clamp((dPad - 6) / PAD_R, 0, 1)));
    // flatten around the facility door
    if (this.facDoorPos) {
      const dd = Math.hypot(x - this.facDoorPos.x, z - this.facDoorPos.z);
      h = lerp(this.facDoorPos.y, h, smooth(clamp((dd - 3) / DOOR_R, 0, 1)));
    }
    // flatten around the company counter
    if (this.counterPos) {
      const dc = Math.hypot(x - this.counterPos.x, z - this.counterPos.z);
      h = lerp(PAD_Y, h, smooth(clamp((dc - 5) / 12, 0, 1)));
    }
    return h;
  }

  /** Build the surface for a moon. Deterministic from (moonIdx, seed). */
  build(moonIdx, seed) {
    this.dispose();
    this.moonIdx = moonIdx;
    this.seed = seed | 0;
    this.isCompany = moonIdx === COMPANY_IDX;
    const M = MOONS[moonIdx];
    const rng = mulberry32((this.seed ^ 0x6d00) | 0);
    const group = new THREE.Group();
    this.colliders = [];

    // facility door location (before terrain so groundY flattens correctly)
    if (!this.isCompany) {
      const ang = (hashAngle(this.seed) % 360) * Math.PI / 180;
      const fx = Math.cos(ang) * M.facDist;
      const fz = Math.sin(ang) * M.facDist;
      this.facDoorPos = { x: fx, z: fz, y: 0 };
      this.facDoorPos.y = this._rawHeight(fx, fz);
    } else {
      this.facDoorPos = null;
      this.counterPos = { x: 0, z: -26 };
    }

    // terrain
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGS, TERRAIN_SEGS);
    geo.rotateX(-Math.PI / 2);
    const posA = geo.attributes.position;
    for (let i = 0; i < posA.count; i++) {
      const x = posA.getX(i), z = posA.getZ(i);
      posA.setY(i, this.groundY(x, z));
    }
    geo.computeVertexNormals();
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 60, uv.getY(i) * 60);
    const mat = this.materials.moonGround.clone();
    mat.color = new THREE.Color(M.ground).multiplyScalar(1.9);
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    group.add(terrain);
    this._terrainMat = mat;

    // ---- props: rocks + dead trees (instanced) ----
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(M.ground).multiplyScalar(1.25), roughness: 1 });
    const nRocks = 90;
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, nRocks);
    const m4 = new THREE.Matrix4();
    let placed = 0, guard = 0;
    while (placed < nRocks && guard++ < 800) {
      const x = (rng() - 0.5) * 360, z = (rng() - 0.5) * 360;
      if (Math.hypot(x, z) < PAD_R + 6) continue;
      if (this.facDoorPos && Math.hypot(x - this.facDoorPos.x, z - this.facDoorPos.z) < DOOR_R + 4) continue;
      if (this.counterPos && Math.hypot(x - this.counterPos.x, z - this.counterPos.z) < 16) continue;
      const s = 0.4 + rng() * 2.4;
      m4.compose(
        new THREE.Vector3(x, this.groundY(x, z) + s * 0.25, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3)),
        new THREE.Vector3(s, s * (0.6 + rng() * 0.5), s)
      );
      rocks.setMatrixAt(placed, m4);
      if (s > 1.2) this.colliders.push({ minX: x - s * 0.7, maxX: x + s * 0.7, minZ: z - s * 0.7, maxZ: z + s * 0.7 });
      placed++;
    }
    rocks.count = placed;
    rocks.castShadow = true;
    group.add(rocks);

    // dead trees: tapered trunks with a few jutting branches
    if (!this.isCompany) {
      const trunkGeo = new THREE.CylinderGeometry(0.06, 0.22, 6, 5);
      trunkGeo.translate(0, 3, 0);
      const treeMat = new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 1 });
      const nTrees = 60;
      const trees = new THREE.InstancedMesh(trunkGeo, treeMat, nTrees);
      let tp = 0; guard = 0;
      while (tp < nTrees && guard++ < 600) {
        const x = (rng() - 0.5) * 360, z = (rng() - 0.5) * 360;
        if (Math.hypot(x, z) < PAD_R + 8) continue;
        if (this.facDoorPos && Math.hypot(x - this.facDoorPos.x, z - this.facDoorPos.z) < DOOR_R + 5) continue;
        const s = 0.7 + rng() * 1.1;
        m4.compose(
          new THREE.Vector3(x, this.groundY(x, z) - 0.1, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.18, rng() * Math.PI, (rng() - 0.5) * 0.18)),
          new THREE.Vector3(s, s, s)
        );
        trees.setMatrixAt(tp, m4);
        this.colliders.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 });
        tp++;
      }
      trees.count = tp;
      trees.castShadow = true;
      group.add(trees);
    }

    // ---- facility exterior: concrete bunker face + door ----
    if (this.facDoorPos) {
      const f = this.facDoorPos;
      const face = new THREE.Mesh(new THREE.BoxGeometry(7, 4.6, 2.2), this.materials.facWall);
      // door faces the pad: rotate the bunker so its front (+z local) points at origin
      const yaw = Math.atan2(0 - f.x, 0 - f.z);
      face.position.set(f.x, f.y + 2.0, f.z);
      face.rotation.y = yaw;
      face.castShadow = true;
      group.add(face);
      // door slab on the pad-facing side
      const doorMat = new THREE.MeshStandardMaterial({
        color: 0x6e2018, roughness: 0.55, metalness: 0.5,
        emissive: 0x300c06, emissiveIntensity: 0.9,
      });
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.6, 0.25), doorMat);
      const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
      door.position.set(f.x + fwd.x * 1.2, f.y + 1.3, f.z + fwd.z * 1.2);
      door.rotation.y = yaw;
      group.add(door);
      const lamp = new THREE.PointLight(0xffd9a0, 6, 14, 1.6);
      lamp.position.set(f.x + fwd.x * 2.2, f.y + 3.2, f.z + fwd.z * 2.2);
      group.add(lamp);
      // lit ENTRANCE sign over the door
      const sTex = makeSignTex('ENTRANCE', '#1a0c06', '#ffb45a');
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 0.62),
        new THREE.MeshBasicMaterial({ map: sTex })
      );
      sign.position.set(f.x + fwd.x * 1.32, f.y + 3.0, f.z + fwd.z * 1.32);
      sign.rotation.y = yaw;
      group.add(sign);
      // tall beacon mast with a pulsing orb — findable from the landing pad
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.14, 9, 6),
        new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7, metalness: 0.6 })
      );
      mast.position.set(f.x - fwd.x * 1.2, f.y + 4.5, f.z - fwd.z * 1.2);
      group.add(mast);
      const beaconOrb = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 14, 12),
        new THREE.MeshBasicMaterial({ color: 0xff7a3a })
      );
      beaconOrb.position.set(f.x - fwd.x * 1.2, f.y + 9.2, f.z - fwd.z * 1.2);
      group.add(beaconOrb);
      const beaconLight = new THREE.PointLight(0xff7a3a, 8, 60, 1.4);
      beaconLight.position.copy(beaconOrb.position);
      group.add(beaconLight);
      this.entranceBeacon = { orb: beaconOrb, light: beaconLight };
      this.facDoorEnter = { x: f.x + fwd.x * 1.8, z: f.z + fwd.z * 1.8 };
      // bunker collider (rough box around it; the door interaction teleports)
      this.colliders.push({ minX: f.x - 3.6, maxX: f.x + 3.6, minZ: f.z - 3.6, maxZ: f.z + 3.6 });
    }

    // ---- the Company: sell counter ----
    if (this.isCompany) {
      const c = this.counterPos;
      const kiosk = new THREE.Group();
      const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 1.4), this.materials.shipWall);
      counter.position.set(0, 0.55, 0);
      kiosk.add(counter);
      const back = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 1), this.materials.facWall);
      back.position.set(0, 2, -2.2);
      kiosk.add(back);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.3, 4.4), this.materials.facCeiling);
      roof.position.set(0, 3.9, -0.6);
      kiosk.add(roof);
      // bell
      const bell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.2, 0.14, 12),
        new THREE.MeshStandardMaterial({ color: 0xd8b94a, metalness: 0.9, roughness: 0.25, emissive: 0x584410, emissiveIntensity: 0.4 })
      );
      bell.position.set(1.6, 1.18, 0);
      kiosk.add(bell);
      // sign
      const sc = document.createElement('canvas');
      sc.width = 512; sc.height = 96;
      const sx = sc.getContext('2d');
      sx.fillStyle = '#181512'; sx.fillRect(0, 0, 512, 96);
      sx.fillStyle = '#d8c270'; sx.font = 'bold 52px monospace';
      sx.textAlign = 'center'; sx.textBaseline = 'middle';
      sx.fillText('THE COMPANY', 256, 50);
      const signTex = new THREE.CanvasTexture(sc);
      signTex.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(5.4, 1.0),
        new THREE.MeshBasicMaterial({ map: signTex })
      );
      sign.position.set(0, 3.1, 0.45);
      kiosk.add(sign);
      const lamp = new THREE.PointLight(0xffe2b0, 7, 16, 1.5);
      lamp.position.set(0, 3.4, 1.4);
      kiosk.add(lamp);

      kiosk.position.set(c.x, PAD_Y, c.z);
      group.add(kiosk);
      this.bellPos = { x: c.x + 1.6, z: c.z };
      this.colliders.push({ minX: c.x - 3, maxX: c.x + 3, minZ: c.z - 0.7, maxZ: c.z + 0.7 });
      this.colliders.push({ minX: c.x - 3.5, maxX: c.x + 3.5, minZ: c.z - 2.7, maxZ: c.z - 1.7 });
    }

    this.scene.add(group);
    this.group = group;
  }

  _rawHeight(x, z) {
    const s = this.seed;
    return valueNoise(x / 46 + s % 97, z / 46 - s % 53, s ^ 0x7e44) * 9
         + valueNoise(x / 11, z / 11, s ^ 0x123) * 1.6
         - 4.2;
  }

  /**
   * Per-frame sky + env targets. hour: 8..24 while landed; pass null in orbit.
   * Returns {fog, density, sky} for graphics.setEnv.
   */
  updateSky(hour) {
    // pulse the entrance beacon so the facility door is findable across terrain
    if (this.entranceBeacon) {
      const p = 0.5 + 0.5 * Math.sin(performance.now() * 0.004);
      this.entranceBeacon.light.intensity = 5 + p * 7;
      this.entranceBeacon.orb.scale.setScalar(0.85 + p * 0.4);
    }
    if (hour === null || this.moonIdx < 0) {
      // orbit: black void + stars
      this.stars.visible = true;
      this.sun.intensity = 0;
      this.hemi.intensity = 0.06;
      return { fog: 0x05060a, density: 0.002, sky: 0x04050a };
    }
    this.stars.visible = false;
    const M = MOONS[this.moonIdx];
    // daylight 1 at 13:00 → 0 by 22:30
    const dayK = clamp(1 - Math.max(0, hour - 17) / 5.2, 0.02, 1)
               * clamp((hour - 5) / 3, 0, 1);
    this.sun.intensity = 2.4 * dayK;
    this.sun.color.setHex(hour > 17.5 ? 0xff9a5c : 0xfff1d8);
    const a = ((hour - 6) / 14) * Math.PI;
    this.sun.position.set(Math.cos(a) * 80, Math.max(8, Math.sin(a) * 90), 30);
    this.hemi.intensity = 0.18 + 0.65 * dayK;

    const fog = new THREE.Color(M.fog).multiplyScalar(0.12 + 0.88 * dayK);
    const sky = new THREE.Color(M.sky).multiplyScalar(0.08 + 0.92 * dayK);
    const density = M.fogDay * (1 + (1 - dayK) * 0.9);
    return { fog: fog.getHex(), density, sky: sky.getHex() };
  }

  collidersNear(wx, wz, r = 6) {
    const out = [];
    for (const c of this.colliders) {
      if (c.minX > wx + r || c.maxX < wx - r || c.minZ > wz + r || c.maxZ < wz - r) continue;
      out.push(c);
    }
    return out;
  }

  dispose() {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        o.geometry?.dispose();
        if (o.material?.map && o.material.map.isCanvasTexture) o.material.map.dispose();
        if (o.material !== this.materials.facWall && o.material !== this.materials.shipWall &&
            o.material !== this.materials.facCeiling) o.material?.dispose();
      }
    });
    this.group = null;
    this.moonIdx = -1;
    this.facDoorPos = null;
    this.counterPos = null;
    this.bellPos = null;
    this.colliders = [];
    this.entranceBeacon = null;
  }
}

function makeSignTex(label, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 256, 64);
  x.strokeStyle = fg; x.lineWidth = 4; x.strokeRect(4, 4, 248, 56);
  x.fillStyle = fg; x.font = 'bold 34px monospace';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(label, 128, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smooth(t) { return t * t * (3 - 2 * t); }
function hashAngle(seed) {
  let h = (seed * 2654435761) | 0;
  h ^= h >>> 13;
  return Math.abs(h);
}
