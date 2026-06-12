// The crew ship, styled after the Lethal Company cabin: autopilot console
// with the START lever and a monitor bank at the front, terminal desk with a
// CRT and chair, bunks and lockers at the back, storage shelf for scrap, and
// the sliding door + ramp on +Z. Props are Sketchfab GLBs (CC-BY, see
// CREDITS.json); the cabin shell is procedural.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SHIP_W, SHIP_D, SHIP_H } from '../core/config.js';
import { damp } from '../core/utils.js';

const DOOR_W = 1.9;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Ship {
  constructor(scene, materials) {
    this.scene = scene;
    this.materials = materials;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.doorOpen = 0;
    this.doorTarget = 0;
    // lever on the console at the front wall, terminal desk in the left-front corner
    this.leverPos = new THREE.Vector3(1.2, 1.0, -SHIP_D / 2 + 0.75);
    this.terminalPos = new THREE.Vector3(-SHIP_W / 2 + 1.1, 1.0, -SHIP_D / 2 + 0.85);
    this.doorPos = new THREE.Vector3(0, 1, SHIP_D / 2);

    this._build();
  }

  _build() {
    const g = this.group;
    const W = SHIP_W, D = SHIP_D, H = SHIP_H;
    const wallMat = this.materials.shipWall;
    const floorMat = this.materials.shipFloor;
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.6, metalness: 0.6 });
    const consoleMetal = new THREE.MeshStandardMaterial({ color: 0x3a3e36, roughness: 0.55, metalness: 0.5 });

    // ---- shell ----
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), floorMat);
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    g.add(floor);
    // ceiling, with a skylight hole over the middle of the cabin so the
    // starfield (in orbit) or sky (on a moon) is visible from inside
    const sky = { x0: -0.8, x1: 1.1, z0: -0.9, z1: 0.9 };
    const mkCeil = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), wallMat);
      m.position.set(x, H + 0.1, z);
      g.add(m);
    };
    mkCeil(W, sky.z0 + D / 2, 0, (-D / 2 + sky.z0) / 2);             // front strip
    mkCeil(W, D / 2 - sky.z1, 0, (sky.z1 + D / 2) / 2);              // back strip
    mkCeil(sky.x0 + W / 2, sky.z1 - sky.z0, (-W / 2 + sky.x0) / 2, (sky.z0 + sky.z1) / 2); // left strip
    mkCeil(W / 2 - sky.x1, sky.z1 - sky.z0, (sky.x1 + W / 2) / 2, (sky.z0 + sky.z1) / 2);  // right strip

    // skylight frame (hangs slightly into the cabin)
    const frameMatSky = new THREE.MeshStandardMaterial({ color: 0x2a2e32, roughness: 0.6, metalness: 0.6 });
    const cx = (sky.x0 + sky.x1) / 2, cz = (sky.z0 + sky.z1) / 2;
    const fw = sky.x1 - sky.x0, fd = sky.z1 - sky.z0;
    for (const [w, d, x, z] of [
      [fw + 0.2, 0.1, cx, sky.z0], [fw + 0.2, 0.1, cx, sky.z1],
      [0.1, fd + 0.2, sky.x0, cz], [0.1, fd + 0.2, sky.x1, cz],
    ]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), frameMatSky);
      f.position.set(x, H - 0.04, z);
      g.add(f);
    }

    // glass pane sealing the hole — lets the real sky/stars show through
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fd),
      new THREE.MeshPhysicalMaterial({
        color: 0x3a5a7a, transparent: true, opacity: 0.12, roughness: 0.05,
        metalness: 0, side: THREE.DoubleSide, depthWrite: false,
      })
    );
    glass.rotation.x = Math.PI / 2;
    glass.position.set(cx, H + 0.08, cz);
    g.add(glass);

    // faint cool light spilling down from the skylight
    const skyLight = new THREE.PointLight(0x6a8fd0, 0.6, 6, 1.6);
    skyLight.position.set(cx, H - 0.3, cz);
    g.add(skyLight);

    const mkWall = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return m;
    };
    mkWall(0.2, H, D, -W / 2, H / 2, 0);
    mkWall(0.2, H, D, W / 2, H / 2, 0);
    mkWall(W, H, 0.2, 0, H / 2, -D / 2);
    const sideW = (W - DOOR_W) / 2;
    mkWall(sideW, H, 0.2, -(DOOR_W + sideW) / 2, H / 2, D / 2);
    mkWall(sideW, H, 0.2, (DOOR_W + sideW) / 2, H / 2, D / 2);
    mkWall(DOOR_W, H - 2.2, 0.2, 0, 2.2 + (H - 2.2) / 2, D / 2);

    // hazard stripes framing the doorway
    const hazardTex = canvasTex(128, 512, (x) => {
      x.fillStyle = '#b89418';
      x.fillRect(0, 0, 128, 512);
      x.fillStyle = '#1a1a16';
      for (let y = -128; y < 512; y += 64) {
        x.beginPath();
        x.moveTo(0, y + 32); x.lineTo(128, y); x.lineTo(128, y + 32); x.lineTo(0, y + 64);
        x.closePath(); x.fill();
      }
    });
    const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.8 });
    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.06), hazardMat);
      strip.position.set(sx * (DOOR_W / 2 + 0.16), 1.1, D / 2 - 0.16);
      g.add(strip);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.5, 0.16, 0.06), hazardMat);
    lintel.position.set(0, 2.28, D / 2 - 0.16);
    g.add(lintel);

    // sliding door
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x6a6e74, roughness: 0.45, metalness: 0.7 });
    this.doorL = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W / 2, 2.2, 0.14), doorMat);
    this.doorR = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W / 2, 2.2, 0.14), doorMat);
    this.doorL.position.set(-DOOR_W / 4, 1.1, D / 2 - 0.17);
    this.doorR.position.set(DOOR_W / 4, 1.1, D / 2 - 0.17);
    g.add(this.doorL, this.doorR);
    // door control panel
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.07), darkMetal);
    panel.position.set(DOOR_W / 2 + 0.55, 1.35, D / 2 - 0.16);
    g.add(panel);
    for (const [dy, col] of [[0.07, 0xd23b2a], [-0.05, 0x3bd24a]]) {
      const btn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6 }));
      btn.rotation.x = Math.PI / 2;
      btn.position.set(DOOR_W / 2 + 0.55, 1.35 + dy, D / 2 - 0.21);
      g.add(btn);
    }

    // ramp
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.4, 0.12, 2.4), floorMat);
    ramp.position.set(0, -0.28, D / 2 + 1.1);
    ramp.rotation.x = 0.18;
    ramp.receiveShadow = true;
    g.add(ramp);

    // ---- autopilot console (front wall, holds the lever) ----
    const consoleGrp = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.92, 0.78), consoleMetal);
    base.position.set(0, 0.46, 0);
    consoleGrp.add(base);
    // sloped control top
    const slope = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 0.62), darkMetal);
    slope.position.set(0, 0.97, 0.06);
    slope.rotation.x = -0.32;
    consoleGrp.add(slope);
    // buttons & switches on the slope
    const btnRng = (i) => (Math.sin(i * 127.3) * 0.5 + 0.5);
    for (let i = 0; i < 14; i++) {
      const col = [0xd2452a, 0x3bd24a, 0xd2b32a, 0x3a8ad2][i % 4];
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.04, 0.07),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: btnRng(i) > 0.5 ? 0.9 : 0.15 }));
      b.position.set(-1.45 + (i % 7) * 0.28 + (i > 6 ? 0.1 : 0), 1.0 + ((i / 7) | 0) * -0.09, 0.18 + ((i / 7) | 0) * 0.16);
      b.rotation.x = -0.32;
      consoleGrp.add(b);
    }
    consoleGrp.position.set(0.7, 0, -D / 2 + 0.6);
    g.add(consoleGrp);

    // the START lever, mounted on the console
    this.leverArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.5, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xb8b8c0, roughness: 0.3, metalness: 0.8 })
    );
    this.leverArm.geometry.translate(0, 0.25, 0);
    this.leverArm.position.set(1.2, 1.02, -D / 2 + 0.72);
    this.leverArm.rotation.x = -0.7;
    g.add(this.leverArm);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xd23b2a, roughness: 0.35, emissive: 0x551108, emissiveIntensity: 0.6 })
    );
    knob.position.y = 0.5;
    this.leverArm.add(knob);
    const leverPlate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.5), darkMetal);
    leverPlate.position.set(1.2, 0.99, -D / 2 + 0.72);
    g.add(leverPlate);

    // ---- monitor bank above the console ----
    const mkScreen = (w, h, tex) => new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    const camsTex = canvasTex(256, 192, (x, w, h) => {
      x.fillStyle = '#0a0f0a'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const v = Math.random() * 90 | 0;
        x.fillStyle = `rgb(${v},${v + 8},${v})`;
        x.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      x.fillStyle = '#9be8a0'; x.font = 'bold 22px monospace';
      x.fillText('CAM 01 — NO SIGNAL', 18, 100);
    });
    const mapTex = canvasTex(256, 192, (x, w, h) => {
      x.fillStyle = '#06140a'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#1e5a2e';
      for (let i = 0; i < w; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
      for (let i = 0; i < h; i += 16) { x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke(); }
      x.strokeStyle = '#4be86a'; x.lineWidth = 2;
      x.beginPath(); x.arc(w / 2, h / 2, 36, 0, Math.PI * 2); x.stroke();
      x.fillStyle = '#9be8a0'; x.font = 'bold 16px monospace';
      x.fillText('RADAR', 12, 22);
      x.fillStyle = '#e8e16a';
      x.beginPath(); x.arc(w / 2, h / 2, 4, 0, Math.PI * 2); x.fill();
    });
    // quota board is redrawn by setQuotaBoard()
    this._quotaCanvas = document.createElement('canvas');
    this._quotaCanvas.width = 256; this._quotaCanvas.height = 128;
    this._quotaTex = new THREE.CanvasTexture(this._quotaCanvas);
    this._quotaTex.colorSpace = THREE.SRGBColorSpace;
    this.setQuotaBoard({ q: 130, sold: 0, dl: 3 });

    const m1 = mkScreen(0.82, 0.62, camsTex);
    m1.position.set(-0.15, 1.95, -D / 2 + 0.13);
    m1.rotation.x = 0.12;
    const m2 = mkScreen(0.82, 0.62, mapTex);
    m2.position.set(0.75, 1.95, -D / 2 + 0.13);
    m2.rotation.x = 0.12;
    const m3 = mkScreen(0.82, 0.42, this._quotaTex);
    m3.position.set(1.65, 1.88, -D / 2 + 0.13);
    m3.rotation.x = 0.12;
    // bezels
    for (const [m, w, h] of [[m1, 0.92, 0.74], [m2, 0.92, 0.74], [m3, 0.92, 0.54]]) {
      const bez = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), darkMetal);
      bez.position.copy(m.position);
      bez.position.z -= 0.06;
      bez.rotation.x = 0.12;
      g.add(bez, m);
    }
    const screenGlow = new THREE.PointLight(0x77e88a, 2.2, 4.5, 1.4);
    screenGlow.position.set(0.7, 1.9, -D / 2 + 0.7);
    g.add(screenGlow);

    // ---- bunks (right-back corner, stacked) ----
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7, metalness: 0.5 });
    const mattressMat = new THREE.MeshStandardMaterial({ color: 0x4e4d3c, roughness: 0.95 });
    for (const y of [0.42, 1.32]) {
      const bunkFrame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.9), frameMat);
      bunkFrame.position.set(W / 2 - 1.1, y, -D / 2 + 0.55);
      g.add(bunkFrame);
      const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.8), mattressMat);
      mattress.position.set(W / 2 - 1.1, y + 0.1, -D / 2 + 0.55);
      g.add(mattress);
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.55), new THREE.MeshStandardMaterial({ color: 0x6e6c62, roughness: 1 }));
      pillow.position.set(W / 2 - 0.45, y + 0.18, -D / 2 + 0.55);
      g.add(pillow);
    }
    for (const px of [W / 2 - 2.05, W / 2 - 0.18]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.9, 0.07), frameMat);
      post.position.set(px, 0.95, -D / 2 + 0.95);
      g.add(post);
    }

    // ---- charging station (glowing yellow alcove by the door) ----
    const chargeBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), darkMetal);
    chargeBox.position.set(-W / 2 + 0.4, 1.5, D / 2 - 0.55);
    g.add(chargeBox);
    const chargeGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.5, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffd24a })
    );
    chargeGlow.position.set(-W / 2 + 0.4, 1.5, D / 2 - 0.38);
    g.add(chargeGlow);
    const chargeLight = new THREE.PointLight(0xffd24a, 1.6, 3.5, 1.5);
    chargeLight.position.set(-W / 2 + 0.6, 1.5, D / 2 - 0.5);
    g.add(chargeLight);

    // ---- ceiling fixtures (fluorescent frames like the facility) ----
    for (const fx of [-1.8, 1.8]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.4), frameMat);
      frame.position.set(fx, H - 0.06, 0.2);
      g.add(frame);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.32), new THREE.MeshBasicMaterial({ color: 0xfff2cf }));
      glow.position.set(fx, H - 0.1, 0.2);
      g.add(glow);
    }

    // interior lights
    const l1 = new THREE.PointLight(0xffe9c4, 26, 13, 1.2);
    l1.position.set(1.8, H - 0.45, 0.2);
    l1.castShadow = true;
    l1.shadow.mapSize.setScalar(512);
    g.add(l1);
    const l2 = new THREE.PointLight(0xffe9c4, 18, 12, 1.25);
    l2.position.set(-1.8, H - 0.45, 0.2);
    g.add(l2);

    // red alarm light
    this.alarmLight = new THREE.PointLight(0xff2418, 0, 9, 1.4);
    this.alarmLight.position.set(0, H - 0.4, D / 2 - 1);
    g.add(this.alarmLight);

    // ---- terminal desk placeholder (GLBs land in load()) ----
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.85), frameMat);
    desk.position.set(this.terminalPos.x, 0.84, this.terminalPos.z + 0.12);
    g.add(desk);
    for (const [lx, lz] of [[-0.7, -0.32], [0.7, -0.32], [-0.7, 0.32], [0.7, 0.32]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.84, 0.06), frameMat);
      leg.position.set(this.terminalPos.x + lx, 0.42, this.terminalPos.z + 0.12 + lz);
      g.add(leg);
    }
    this._termAnchor = new THREE.Group();
    this._termAnchor.position.set(this.terminalPos.x - 0.25, 0.87, this.terminalPos.z + 0.12);
    g.add(this._termAnchor);

    // extra colliders for the furniture
    this._extraColliders = [
      // console
      { minX: 0.7 - 1.7, maxX: 0.7 + 1.7, minZ: -D / 2 + 0.2, maxZ: -D / 2 + 1.05 },
      // bunks
      { minX: W / 2 - 2.1, maxX: W / 2, minZ: -D / 2 + 0.1, maxZ: -D / 2 + 1.0 },
      // desk
      { minX: this.terminalPos.x - 0.85, maxX: this.terminalPos.x + 0.85, minZ: this.terminalPos.z - 0.35, maxZ: this.terminalPos.z + 0.6 },
    ];
  }

  /** Redraw the quota monitor (called by main on gm changes). */
  setQuotaBoard({ q, sold, dl }) {
    const x = this._quotaCanvas.getContext('2d');
    x.fillStyle = '#140a06';
    x.fillRect(0, 0, 256, 128);
    x.fillStyle = '#e8843c';
    x.font = 'bold 20px monospace';
    x.fillText('PROFIT QUOTA', 16, 30);
    x.font = 'bold 26px monospace';
    x.fillText(`$${sold} / $${q}`, 16, 66);
    x.font = 'bold 18px monospace';
    x.fillStyle = dl <= 1 ? '#e84a3c' : '#e8c43c';
    x.fillText(`${Math.max(0, dl)} DAYS LEFT`, 16, 102);
    if (this._quotaTex) this._quotaTex.needsUpdate = true;
  }

  async load() {
    const loader = new GLTFLoader();

    const place = async (file, { size, x, y = 0, z, rotY = 0, sizeAxis = 'y' }) => {
      const gltf = await loader.loadAsync(import.meta.env.BASE_URL + 'models/lethal/' + file);
      const root = gltf.scene;
      const box = new THREE.Box3().setFromObject(root);
      const dims = box.getSize(new THREE.Vector3());
      const scale = size / Math.max(dims[sizeAxis], 1e-6);
      root.scale.setScalar(scale);
      box.setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      const wrap = new THREE.Group();
      root.position.set(-center.x, -box.min.y, -center.z);
      wrap.add(root);
      wrap.position.set(x, y, z);
      wrap.rotation.y = rotY;
      wrap.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(wrap);
      return wrap;
    };

    const D = SHIP_D, W = SHIP_W;
    const jobs = [
      // exterior hull
      (async () => {
        const gltf = await loader.loadAsync(import.meta.env.BASE_URL + 'models/lethal/dropship.glb');
        const hull = gltf.scene;
        const box = new THREE.Box3().setFromObject(hull);
        const size = box.getSize(new THREE.Vector3());
        const scale = (SHIP_W + 3.5) / Math.max(size.x, size.z);
        hull.scale.setScalar(scale);
        box.setFromObject(hull);
        const center = box.getCenter(new THREE.Vector3());
        hull.position.sub(center);
        hull.position.y += (box.max.y - box.min.y) / 2 + SHIP_H - 0.15;
        hull.position.z -= 0.6;
        hull.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            if (o.material) {
              o.material = o.material.clone();
              o.material.color?.multiplyScalar(2.2);
              if (o.material.emissive) o.material.emissiveIntensity = 1.6;
            }
          }
        });
        this.hull = hull;
        this.hull.visible = false;
        this.group.add(hull);
      })(),
      // terminal on the desk
      (async () => {
        const w = await place('terminal.glb', { size: 0.8, x: this.terminalPos.x - 0.25, y: 0.87, z: this.terminalPos.z + 0.12, rotY: Math.PI * 0.06 });
        w.traverse((o) => {
          if (o.isMesh && o.material?.emissive) o.material.emissiveIntensity = 1.4;
        });
      })(),
      // CRT beside it
      place('prop_crt.glb', { size: 0.42, x: this.terminalPos.x + 0.45, y: 0.87, z: this.terminalPos.z + 0.1, rotY: -0.3 }),
      // chair at the desk
      place('prop_chair.glb', { size: 0.95, x: this.terminalPos.x + 0.1, y: 0, z: this.terminalPos.z + 1.05, rotY: Math.PI + 0.3 }),
      // lockers along the left wall
      place('prop_locker.glb', { size: 1.95, x: -W / 2 + 0.55, y: 0, z: -0.4, rotY: Math.PI / 2 }),
      // storage shelf (scrap cupboard) right of the door
      place('prop_shelf.glb', { size: 1.8, x: W / 2 - 0.6, y: 0, z: D / 2 - 0.85, rotY: -Math.PI / 2 }),
      // crates under the console
      place('prop_crate.glb', { size: 0.62, x: -1.1, y: 0, z: -D / 2 + 0.75, rotY: 0.4 }),
      place('prop_crate.glb', { size: 0.5, x: -1.75, y: 0, z: -D / 2 + 0.7, rotY: -0.2 }),
      // fire extinguisher near the door
      place('prop_extinguisher.glb', { size: 0.55, x: -DOOR_W / 2 - 0.55, y: 0.02, z: D / 2 - 0.35 }),
    ];
    const results = await Promise.allSettled(jobs);
    for (const r of results) {
      if (r.status === 'rejected') console.warn('[ship] prop failed:', r.reason?.message);
    }
    // collider for lockers + shelf
    this._extraColliders.push(
      { minX: -W / 2, maxX: -W / 2 + 0.95, minZ: -1.5, maxZ: 0.7 },
      { minX: W / 2 - 1.05, maxX: W / 2, minZ: D / 2 - 1.35, maxZ: D / 2 },
    );
  }

  setHullVisible(v) { if (this.hull) this.hull.visible = v; }
  setDoor(open) { this.doorTarget = open ? 1 : 0; }
  setLever(pulled) { this._leverTarget = pulled ? 0.7 : -0.7; }

  update(dt) {
    this.doorOpen = damp(this.doorOpen, this.doorTarget, 5, dt);
    const slide = this.doorOpen * (DOOR_W / 2 + 0.05);
    this.doorL.position.x = -DOOR_W / 4 - slide;
    this.doorL.position.z = SHIP_D / 2 - 0.17;
    this.doorR.position.x = DOOR_W / 4 + slide;
    this.doorR.position.z = SHIP_D / 2 - 0.17;
    this.leverArm.rotation.x = damp(this.leverArm.rotation.x, this._leverTarget ?? -0.7, 8, dt);
  }

  colliders() {
    const W = SHIP_W, D = SHIP_D;
    const out = [
      { minX: -W / 2 - 0.2, maxX: -W / 2 + 0.1, minZ: -D / 2, maxZ: D / 2 },
      { minX: W / 2 - 0.1, maxX: W / 2 + 0.2, minZ: -D / 2, maxZ: D / 2 },
      { minX: -W / 2, maxX: W / 2, minZ: -D / 2 - 0.2, maxZ: -D / 2 + 0.1 },
      { minX: -W / 2, maxX: -DOOR_W / 2, minZ: D / 2 - 0.1, maxZ: D / 2 + 0.2 },
      { minX: DOOR_W / 2, maxX: W / 2, minZ: D / 2 - 0.1, maxZ: D / 2 + 0.2 },
      ...this._extraColliders,
    ];
    if (this.doorOpen < 0.6) {
      out.push({ minX: -DOOR_W / 2, maxX: DOOR_W / 2, minZ: D / 2 - 0.1, maxZ: D / 2 + 0.15 });
    }
    return out;
  }

  contains(x, z, margin = 0) {
    return Math.abs(x) < SHIP_W / 2 + margin && Math.abs(z) < SHIP_D / 2 + margin;
  }

  floorYAt(x, z) {
    if (this.contains(x, z, 0.2)) return 0;
    if (Math.abs(x) < (DOOR_W + 0.4) / 2 && z > SHIP_D / 2 && z < SHIP_D / 2 + 2.6) {
      const t = (z - SHIP_D / 2) / 2.6;
      return -0.45 * t;
    }
    return null;
  }
}
