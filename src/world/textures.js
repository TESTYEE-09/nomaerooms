// Procedural PBR texture set, painted once at boot on canvases.
// Industrial facility (concrete walls, scuffed metal floor, panel ceiling),
// ship interior plating, and moon terrain ground.

import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';

const SIZE = 1024;
const DENS = (SIZE / 512) ** 2;

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return c;
}

function canvasTexture(c, colorSpace = THREE.SRGBColorSpace) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = colorSpace;
  t.anisotropy = 8;
  return t;
}

// Sobel a grayscale canvas into a tangent-space normal map.
function normalFromHeight(heightCanvas, strength = 1.5) {
  const w = SIZE, h = SIZE;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas();
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const px = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (px(x + 1, y) - px(x - 1, y)) * strength;
      const dy = (px(x, y + 1) - px(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function noiseOverlay(ctx, rng, count, alpha, dark = true) {
  count *= DENS;
  for (let i = 0; i < count; i++) {
    const v = dark ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${(rng() * alpha).toFixed(3)})`;
    ctx.fillRect(rng() * SIZE, rng() * SIZE, 1 + rng() * 2, 1 + rng() * 2);
  }
}

// ---- Facility concrete wall (tile = 2 m wide × WALL_H tall) -----------------

function makeConcreteWall() {
  const rng = mulberry32(0xc0c7e7);
  const c = makeCanvas();
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#6b6a62';
  ctx.fillRect(0, 0, SIZE, SIZE);
  // pour bands
  for (let y = 0; y < SIZE; y += SIZE / 5) {
    ctx.fillStyle = `rgba(${70 + rng() * 30 | 0},${70 + rng() * 28 | 0},${62 + rng() * 26 | 0},0.25)`;
    ctx.fillRect(0, y, SIZE, SIZE / 5 - 4);
    ctx.fillStyle = 'rgba(30,30,26,0.5)';
    ctx.fillRect(0, y + SIZE / 5 - 4, SIZE, 3);
  }
  noiseOverlay(ctx, rng, 18000, 0.13);
  noiseOverlay(ctx, rng, 7000, 0.07, false);

  // form-tie holes on a grid
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const x = (gx + 0.5) * SIZE / 4 + (rng() - 0.5) * 12;
      const y = (gy + 0.5) * SIZE / 3 + (rng() - 0.5) * 12;
      ctx.fillStyle = 'rgba(28,27,22,0.85)';
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(120,118,105,0.5)';
      ctx.beginPath(); ctx.arc(x - 2, y - 2, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  // rust streaks dripping from tie holes and the top
  for (let i = 0; i < 16; i++) {
    const x = rng() * SIZE, y0 = rng() * SIZE * 0.6, h = 60 + rng() * 260;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, `rgba(110,60,30,${0.18 + rng() * 0.2})`);
    g.addColorStop(1, 'rgba(110,60,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, 3 + rng() * 10, h);
  }
  // grime rising from the floor
  const g2 = ctx.createLinearGradient(0, SIZE, 0, SIZE * 0.6);
  g2.addColorStop(0, 'rgba(24,22,16,0.55)');
  g2.addColorStop(1, 'rgba(24,22,16,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // hazard stripe remnant at the very bottom
  ctx.save();
  ctx.globalAlpha = 0.28;
  for (let x = -SIZE * 0.2; x < SIZE * 1.2; x += 64) {
    ctx.fillStyle = '#8f7a1e';
    ctx.beginPath();
    ctx.moveTo(x, SIZE); ctx.lineTo(x + 32, SIZE); ctx.lineTo(x + 64, SIZE - 26); ctx.lineTo(x + 32, SIZE - 26);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // height map
  const hc = makeCanvas();
  const hctx = hc.getContext('2d');
  hctx.fillStyle = '#888888';
  hctx.fillRect(0, 0, SIZE, SIZE);
  for (let y = 0; y < SIZE; y += SIZE / 5) {
    hctx.fillStyle = '#404040';
    hctx.fillRect(0, y + SIZE / 5 - 4, SIZE, 3);
  }
  noiseOverlay(hctx, mulberry32(0xbeef), 16000, 0.22);

  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(normalFromHeight(hc, 1.6), THREE.NoColorSpace),
  };
}

// ---- Facility floor: scuffed sealed concrete with metal walkway strips ------

function makeFacilityFloor() {
  const rng = mulberry32(0xf100f);
  const c = makeCanvas();
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#4e4c45';
  ctx.fillRect(0, 0, SIZE, SIZE);
  noiseOverlay(ctx, rng, 26000, 0.14);
  noiseOverlay(ctx, rng, 9000, 0.06, false);

  // expansion joints — tile = 2 m, joint every metre
  ctx.fillStyle = 'rgba(20,20,16,0.7)';
  ctx.fillRect(0, SIZE / 2 - 2, SIZE, 4);
  ctx.fillRect(SIZE / 2 - 2, 0, 4, SIZE);
  // oil stains
  for (let i = 0; i < 9; i++) {
    const x = rng() * SIZE, y = rng() * SIZE, r = 28 + rng() * 80;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(14,13,10,${0.3 + rng() * 0.3})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // scuffs and drag marks
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(${30 + rng() * 40 | 0},${30 + rng() * 38 | 0},${26 + rng() * 30 | 0},${0.15 + rng() * 0.2})`;
    ctx.lineWidth = 1 + rng() * 3;
    ctx.beginPath();
    const x = rng() * SIZE, y = rng() * SIZE, a = rng() * Math.PI;
    const l = 30 + rng() * 130;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }

  const hc = makeCanvas();
  const hctx = hc.getContext('2d');
  hctx.fillStyle = '#909090';
  hctx.fillRect(0, 0, SIZE, SIZE);
  hctx.fillStyle = '#383838';
  hctx.fillRect(0, SIZE / 2 - 2, SIZE, 4);
  hctx.fillRect(SIZE / 2 - 2, 0, 4, SIZE);
  noiseOverlay(hctx, mulberry32(0xfee7), 22000, 0.25);

  // roughness: oil is glossy
  const rc = makeCanvas();
  const rctx = rc.getContext('2d');
  rctx.fillStyle = '#dcdcdc';
  rctx.fillRect(0, 0, SIZE, SIZE);
  const rrng = mulberry32(0x011);
  for (let i = 0; i < 9; i++) {
    const x = rrng() * SIZE, y = rrng() * SIZE, r = 28 + rrng() * 80;
    const g = rctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(70,70,70,0.8)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    rctx.fillStyle = g;
    rctx.beginPath(); rctx.arc(x, y, r, 0, Math.PI * 2); rctx.fill();
  }

  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(normalFromHeight(hc, 1.2), THREE.NoColorSpace),
    roughnessMap: canvasTexture(rc, THREE.NoColorSpace),
  };
}

// ---- Facility ceiling: dark corrugated metal with cable runs ----------------

function makeFacilityCeiling() {
  const rng = mulberry32(0xce1117);
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3b3d3c';
  ctx.fillRect(0, 0, SIZE, SIZE);
  // corrugation stripes
  for (let x = 0; x < SIZE; x += 32) {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, 0, 10, SIZE);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + 20, 0, 8, SIZE);
  }
  noiseOverlay(ctx, rng, 12000, 0.12);
  // cable runs
  for (let i = 0; i < 3; i++) {
    const y = rng() * SIZE;
    ctx.fillStyle = 'rgba(18,18,16,0.8)';
    ctx.fillRect(0, y, SIZE, 7 + rng() * 5);
  }

  const hc = makeCanvas();
  const hctx = hc.getContext('2d');
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, SIZE, SIZE);
  for (let x = 0; x < SIZE; x += 32) {
    hctx.fillStyle = '#a8a8a8';
    hctx.fillRect(x, 0, 10, SIZE);
    hctx.fillStyle = '#585858';
    hctx.fillRect(x + 20, 0, 8, SIZE);
  }

  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(normalFromHeight(hc, 1.8), THREE.NoColorSpace),
  };
}

// ---- Ship interior plating ---------------------------------------------------

function makeShipPanel() {
  const rng = mulberry32(0x5417);
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5e6166';
  ctx.fillRect(0, 0, SIZE, SIZE);
  // panel grid with rivets
  const q = SIZE / 4;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const x = gx * q, y = gy * q;
      ctx.fillStyle = `rgba(${88 + rng() * 18 | 0},${92 + rng() * 16 | 0},${98 + rng() * 14 | 0},0.5)`;
      ctx.fillRect(x + 3, y + 3, q - 6, q - 6);
      ctx.strokeStyle = 'rgba(20,22,26,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 2, y + 2, q - 4, q - 4);
      for (const [rx, ry] of [[12, 12], [q - 12, 12], [12, q - 12], [q - 12, q - 12]]) {
        ctx.fillStyle = 'rgba(30,32,36,0.9)';
        ctx.beginPath(); ctx.arc(x + rx, y + ry, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(160,165,175,0.6)';
        ctx.beginPath(); ctx.arc(x + rx - 1.5, y + ry - 1.5, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  noiseOverlay(ctx, rng, 9000, 0.1);
  // worn smudges
  for (let i = 0; i < 14; i++) {
    const x = rng() * SIZE, y = rng() * SIZE, r = 20 + rng() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(28,30,30,${0.12 + rng() * 0.14})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  const hc = makeCanvas();
  const hctx = hc.getContext('2d');
  hctx.fillStyle = '#888888';
  hctx.fillRect(0, 0, SIZE, SIZE);
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      hctx.strokeStyle = '#3a3a3a';
      hctx.lineWidth = 3;
      hctx.strokeRect(gx * q + 2, gy * q + 2, q - 4, q - 4);
    }
  }

  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(normalFromHeight(hc, 1.8), THREE.NoColorSpace),
  };
}

// ---- Ship floor: diamond tread plate -----------------------------------------

function makeTreadPlate() {
  const rng = mulberry32(0x77ead);
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#46484a';
  ctx.fillRect(0, 0, SIZE, SIZE);
  noiseOverlay(ctx, rng, 9000, 0.12);
  const hc = makeCanvas();
  const hctx = hc.getContext('2d');
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, SIZE, SIZE);
  const step = 42;
  for (let y = 0; y < SIZE + step; y += step) {
    for (let x = 0; x < SIZE + step; x += step) {
      const ox = (Math.floor(y / step) % 2) * step / 2;
      for (const rot of [0.6, -0.95]) {
        ctx.save(); hctx.save();
        ctx.translate(x + ox, y); hctx.translate(x + ox, y);
        ctx.rotate(rot); hctx.rotate(rot);
        ctx.fillStyle = 'rgba(120,124,128,0.55)';
        ctx.fillRect(-11, -3, 22, 6);
        hctx.fillStyle = '#c8c8c8';
        hctx.fillRect(-11, -3, 22, 6);
        ctx.restore(); hctx.restore();
      }
    }
  }
  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(normalFromHeight(hc, 2.2), THREE.NoColorSpace),
  };
}

// ---- Moon ground: barren dirt + gravel ----------------------------------------

function makeGround() {
  const rng = mulberry32(0x9a07d);
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a786e';   // tinted per-moon by material colour
  ctx.fillRect(0, 0, SIZE, SIZE);
  noiseOverlay(ctx, rng, 34000, 0.18);
  noiseOverlay(ctx, rng, 12000, 0.1, false);
  // patches of darker soil
  for (let i = 0; i < 22; i++) {
    const x = rng() * SIZE, y = rng() * SIZE, r = 26 + rng() * 110;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(30,28,22,${0.1 + rng() * 0.16})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // gravel
  for (let i = 0; i < 2400 * DENS; i++) {
    const v = 90 + rng() * 90;
    ctx.fillStyle = `rgba(${v | 0},${v * 0.96 | 0},${v * 0.85 | 0},${0.25 + rng() * 0.4})`;
    ctx.fillRect(rng() * SIZE, rng() * SIZE, 1 + rng() * 3, 1 + rng() * 3);
  }

  const hc = makeCanvas();
  const hctx = hc.getContext('2d');
  hctx.fillStyle = '#8a8a8a';
  hctx.fillRect(0, 0, SIZE, SIZE);
  noiseOverlay(hctx, mulberry32(0x9a01), 26000, 0.3);

  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(normalFromHeight(hc, 1.0), THREE.NoColorSpace),
  };
}

// ---- Materials --------------------------------------------------------------

export function buildMaterials() {
  const wall = makeConcreteWall();
  const floor = makeFacilityFloor();
  const ceil = makeFacilityCeiling();
  const panel = makeShipPanel();
  const tread = makeTreadPlate();
  const ground = makeGround();

  const facWall = new THREE.MeshStandardMaterial({
    map: wall.map, normalMap: wall.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.95, metalness: 0.0,
  });
  const facFloor = new THREE.MeshStandardMaterial({
    map: floor.map, normalMap: floor.normalMap, roughnessMap: floor.roughnessMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 1.0, metalness: 0.05,
  });
  const facCeiling = new THREE.MeshStandardMaterial({
    map: ceil.map, normalMap: ceil.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.8, metalness: 0.35,
  });
  const shipWall = new THREE.MeshStandardMaterial({
    map: panel.map, normalMap: panel.normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.55, metalness: 0.55,
  });
  const shipFloor = new THREE.MeshStandardMaterial({
    map: tread.map, normalMap: tread.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.6, metalness: 0.5,
  });
  const moonGround = new THREE.MeshStandardMaterial({
    map: ground.map, normalMap: ground.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 1.0, metalness: 0.0,
  });

  // fluorescent diffuser: unlit, instance colors pushed past 1.0 drive both
  // the flicker and the bloom (instanceColor multiplies the base color)
  const fixtureGlow = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const fixtureFrame = new THREE.MeshStandardMaterial({
    color: 0x9a9a92, roughness: 0.5, metalness: 0.6,
  });

  return { facWall, facFloor, facCeiling, shipWall, shipFloor, moonGround, fixtureGlow, fixtureFrame };
}
