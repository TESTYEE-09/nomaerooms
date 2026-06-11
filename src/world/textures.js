// Procedural PBR texture set, painted once at boot on canvases.
// Wallpaper (green damask, grime, baseboard), damp carpet, ceiling tiles.
// Each material gets color + roughness + normal maps derived from a height pass.

import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';

const SIZE = 1024;
const DENS = (SIZE / 512) ** 2; // scale point-detail counts with resolution

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

// ---- Classic Backrooms yellow wallpaper ------------------------------------
// One texture tile = 2 m wide x WALL_H tall on the wall. A baseboard is painted
// into the bottom ~7% so wall bases read as wood trim without extra geometry.

function damaskMotif(ctx, cx, cy, s, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.06;
  // central bud
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.16, s * 0.30, 0, 0, Math.PI * 2);
  ctx.fill();
  // four curling fronds
  for (const m of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.28);
    ctx.bezierCurveTo(m * s * 0.42, -s * 0.46, m * s * 0.52, s * 0.05, m * s * 0.18, s * 0.34);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, s * 0.30);
    ctx.bezierCurveTo(m * s * 0.30, s * 0.48, m * s * 0.44, s * 0.18, m * s * 0.30, -s * 0.05);
    ctx.stroke();
    // leaf dots
    ctx.beginPath();
    ctx.ellipse(m * s * 0.34, -s * 0.30, s * 0.07, s * 0.12, m * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(m * s * 0.30, s * 0.32, s * 0.06, s * 0.10, -m * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // crown flourish
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.42, s * 0.08, s * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function makeWallpaper() {
  const rng = mulberry32(0x57a11);
  const c = makeCanvas();
  const ctx = c.getContext('2d');

  // base: iconic Backrooms yellow-beige with vertical tonal streaks
  ctx.fillStyle = '#c9b06b';
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let x = 0; x < SIZE; x += 2) {
    ctx.fillStyle = `rgba(${160 + rng() * 35 | 0},${140 + rng() * 30 | 0},${80 + rng() * 25 | 0},${0.06 + rng() * 0.09})`;
    ctx.fillRect(x, 0, 2, SIZE);
  }

  // damask lattice: motifs on a diamond grid (4 cols, offset rows)
  const step = SIZE / 4;
  for (let row = -1; row < 10; row++) {
    for (let col = -1; col < 5; col++) {
      const ox = col * step + (row % 2 ? step / 2 : 0);
      const oy = row * step * 0.62;
      // layered motif: dark brown base, mid yellow-brown, faint highlight
      damaskMotif(ctx, ox + 2, oy + 3, step * 0.52, 'rgba(90, 72, 38, 0.85)');
      damaskMotif(ctx, ox, oy, step * 0.52, 'rgba(140, 115, 65, 0.9)');
      damaskMotif(ctx, ox - 1, oy - 2, step * 0.46, 'rgba(200, 180, 120, 0.35)');
    }
  }

  noiseOverlay(ctx, rng, 12000, 0.12);
  noiseOverlay(ctx, rng, 4000, 0.06, false);

  // damp grime climbing from the bottom
  const g = ctx.createLinearGradient(0, SIZE, 0, SIZE * 0.55);
  g.addColorStop(0, 'rgba(50, 42, 28, 0.5)');
  g.addColorStop(1, 'rgba(50, 42, 28, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // occasional drip stains
  for (let i = 0; i < 10; i++) {
    const x = rng() * SIZE, w = 4 + rng() * 20, h = 50 + rng() * 200;
    const dg = ctx.createLinearGradient(0, SIZE - h, 0, SIZE);
    dg.addColorStop(0, 'rgba(55, 45, 25,0)');
    dg.addColorStop(1, 'rgba(55, 45, 25,0.4)');
    ctx.fillStyle = dg;
    ctx.fillRect(x, SIZE - h, w, h);
  }

  // broad water damage patches
  for (let i = 0; i < 4; i++) {
    const x = rng() * SIZE, y = rng() * SIZE * 0.6, r = 50 + rng() * 120;
    const wg = ctx.createRadialGradient(x, y, 0, x, y, r);
    wg.addColorStop(0, 'rgba(100, 80, 40, 0.2)');
    wg.addColorStop(0.7, 'rgba(80, 62, 30, 0.15)');
    wg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // baseboard: dark varnished wood strip at the bottom of the tile
  const bbH = SIZE * 0.07;
  ctx.fillStyle = '#4a3824';
  ctx.fillRect(0, SIZE - bbH, SIZE, bbH);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(${35 + rng() * 35 | 0},${26 + rng() * 24 | 0},${16 + rng() * 18 | 0},0.35)`;
    ctx.fillRect(rng() * SIZE, SIZE - bbH + rng() * bbH, 20 + rng() * 60, 1 + rng() * 2);
  }
  ctx.fillStyle = 'rgba(255,240,200,0.10)';
  ctx.fillRect(0, SIZE - bbH, SIZE, 2);

  // height map for the normal: motifs are slightly embossed, baseboard raised
  const hc = makeCanvas();
  const hctx = hc.getContext('2d');
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, SIZE, SIZE);
  for (let row = -1; row < 10; row++) {
    for (let col = -1; col < 5; col++) {
      const ox = col * step + (row % 2 ? step / 2 : 0);
      const oy = row * step * 0.62;
      damaskMotif(hctx, ox, oy, step * 0.52, 'rgba(255,255,255,0.5)');
    }
  }
  const hrng = mulberry32(0xbeef);
  noiseOverlay(hctx, hrng, 15000, 0.2);
  hctx.fillStyle = '#b0b0b0';
  hctx.fillRect(0, SIZE - bbH, SIZE, bbH);

  // roughness: grime is glossier (damp), paper is matte
  const rc = makeCanvas();
  const rctx = rc.getContext('2d');
  rctx.fillStyle = '#e8e8e8';
  rctx.fillRect(0, 0, SIZE, SIZE);
  const rg = rctx.createLinearGradient(0, SIZE, 0, SIZE * 0.55);
  rg.addColorStop(0, 'rgba(110,110,110,0.8)');
  rg.addColorStop(1, 'rgba(110,110,110,0)');
  rctx.fillStyle = rg;
  rctx.fillRect(0, 0, SIZE, SIZE);
  rctx.fillStyle = '#707070';
  rctx.fillRect(0, SIZE - bbH, SIZE, bbH);

  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(normalFromHeight(hc, 2.0), THREE.NoColorSpace),
    roughnessMap: canvasTexture(rc, THREE.NoColorSpace),
  };
}

// ---- Damp carpet (more realistic) -------------------------------------------
// One tile = 2 m x 2 m. Simulates loop-pile commercial carpet with visible
// fibre tufts, worn footpaths, water damage, and edge curling.

function makeCarpet() {
  const rng = mulberry32(0xca59e7);
  const c = makeCanvas();
  const ctx = c.getContext('2d');

  // base colour — deep greenish-brown (classic backrooms)
  ctx.fillStyle = '#4a4434';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // fibre tufts (small dashes in a slight directional grain)
  for (let i = 0; i < 35000 * DENS; i++) {
    const v = 50 + rng() * 45;
    const bright = rng() < 0.5;
    const r = bright ? v * 1.05 : v * 0.85;
    const g = bright ? v : v * 0.88;
    const b = bright ? v * 0.65 : v * 0.55;
    ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.2 + rng() * 0.35})`;
    const fx = rng() * SIZE, fy = rng() * SIZE;
    // fibre direction: slight horizontal bias
    const flen = 1 + rng() * 3, fw = 1;
    ctx.fillRect(fx, fy, flen, fw);
  }

  // pile direction grain (subtle horizontal streaks)
  for (let y = 0; y < SIZE; y += 3) {
    ctx.fillStyle = `rgba(80,74,56,${0.01 + rng() * 0.02})`;
    ctx.fillRect(0, y, SIZE, 1);
  }

  // wide worn footpaths (lighter, flattened areas)
  for (let i = 0; i < 18; i++) {
    const x = rng() * SIZE, y = rng() * SIZE;
    const rx = 40 + rng() * 120, ry = 10 + rng() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
    g.addColorStop(0, 'rgba(130,124,100,0.12)');
    g.addColorStop(0.5, 'rgba(100,94,80,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.3 + rng() * 0.3);
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // dark damp stains with feathery edges
  for (let i = 0; i < 12; i++) {
    const x = rng() * SIZE, y = rng() * SIZE;
    const rd = 20 + rng() * 60;
    ctx.fillStyle = `rgba(18,16,8,${0.15 + rng() * 0.25})`;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const r = rd * (0.6 + rng() * 0.5);
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // inner darker core
    const innerR = rd * 0.3;
    ctx.fillStyle = `rgba(14,12,6,${0.1 + rng() * 0.15})`;
    ctx.beginPath();
    ctx.arc(x + (rng() - 0.5) * 10, y + (rng() - 0.5) * 10, innerR, 0, Math.PI * 2);
    ctx.fill();
  }

  // mould spots (tiny dark clusters near damp areas)
  for (let i = 0; i < 30; i++) {
    const x = rng() * SIZE, y = rng() * SIZE;
    for (let j = 0; j < 5 + rng() * 15; j++) {
      ctx.fillStyle = `rgba(25,30,20,${0.4 + rng() * 0.5})`;
      ctx.fillRect(x + (rng() - 0.5) * 12, y + (rng() - 0.5) * 12, 1, 1);
    }
  }

  // edge curling / scuff marks near walls (mimics poor installation)
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < 10; i++) {
      const pos = rng() * SIZE;
      const sx = side === 0 ? 2 + rng() * 8 : side === 1 ? SIZE - 2 - rng() * 8 : rng() * SIZE;
      const sy = side === 2 ? 2 + rng() * 8 : side === 3 ? SIZE - 2 - rng() * 8 : rng() * SIZE;
      ctx.fillStyle = `rgba(28,24,16,${0.1 + rng() * 0.15})`;
      ctx.fillRect(sx - 1, sy - 1, 3, 3);
    }
  }

  // height map: fibre noise + worn paths are lower, damp areas slightly raised
  const hc = makeCanvas();
  const hctx = hc.getContext('2d');
  hctx.fillStyle = '#909090';
  hctx.fillRect(0, 0, SIZE, SIZE);
  // fibre noise
  const hrng = mulberry32(0xfeed);
  for (let i = 0; i < 40000 * DENS; i++) {
    const v = 60 + hrng() * 70;
    hctx.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},${0.3 + hrng() * 0.5})`;
    hctx.fillRect(hrng() * SIZE, hrng() * SIZE, 1 + hrng() * 2, 1);
  }
  // worn paths are flatter (darker in height map)
  for (let i = 0; i < 15; i++) {
    const x = hrng() * SIZE, y = hrng() * SIZE, r = 30 + hrng() * 80;
    const g = hctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(60,60,60,0.7)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    hctx.fillStyle = g;
    hctx.save();
    hctx.translate(x, y);
    hctx.scale(1, 0.3 + hrng() * 0.3);
    hctx.beginPath();
    hctx.arc(0, 0, r, 0, Math.PI * 2);
    hctx.fill();
    hctx.restore();
  }

  // roughness: damp areas are shinier, worn paths are smoother
  const rc = makeCanvas();
  const rctx = rc.getContext('2d');
  rctx.fillStyle = '#e8e8e8';
  rctx.fillRect(0, 0, SIZE, SIZE);
  // damp stain gloss
  const rrng = mulberry32(0xd44b);
  for (let i = 0; i < 12; i++) {
    const x = rrng() * SIZE, y = rrng() * SIZE, r = 20 + rrng() * 60;
    const g = rctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(80,80,80,0.75)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    rctx.fillStyle = g;
    rctx.beginPath();
    rctx.arc(x, y, r, 0, Math.PI * 2);
    rctx.fill();
  }
  // worn paths are slightly polished
  for (let i = 0; i < 10; i++) {
    const x = rrng() * SIZE, y = rrng() * SIZE, r = 40 + rrng() * 70;
    const g = rctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(60,60,60,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    rctx.fillStyle = g;
    rctx.save();
    rctx.translate(x, y);
    rctx.scale(1, 0.3 + rrng() * 0.3);
    rctx.beginPath();
    rctx.arc(0, 0, r, 0, Math.PI * 2);
    rctx.fill();
    rctx.restore();
  }

  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(normalFromHeight(hc, 1.2), THREE.NoColorSpace),
    roughnessMap: canvasTexture(rc, THREE.NoColorSpace),
  };
}

// ---- Ceiling tiles ----------------------------------------------------------
// One texture tile = 2.4 m (4 drop tiles of 0.6 m).

function makeCeiling() {
  const rng = mulberry32(0xce111);
  const c = makeCanvas();
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8d8a78';
  ctx.fillRect(0, 0, SIZE, SIZE);
  noiseOverlay(ctx, rng, 16000, 0.12);
  noiseOverlay(ctx, rng, 6000, 0.08, false);

  // tile pinholes
  for (let i = 0; i < 2600 * DENS; i++) {
    ctx.fillStyle = `rgba(40,38,30,${0.2 + rng() * 0.4})`;
    const x = rng() * SIZE, y = rng() * SIZE;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  // water stains
  for (let i = 0; i < 5; i++) {
    const x = rng() * SIZE, y = rng() * SIZE, r = 24 + rng() * 70;
    const g = ctx.createRadialGradient(x, y, r * 0.4, x, y, r);
    g.addColorStop(0, 'rgba(96,80,44,0.18)');
    g.addColorStop(0.85, 'rgba(96,72,36,0.34)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // T-bar grid (4 tiles per texture)
  const q = SIZE / 4;
  ctx.fillStyle = '#5c594c';
  for (let i = 0; i <= 4; i++) {
    ctx.fillRect(i * q - 2, 0, 4, SIZE);
    ctx.fillRect(0, i * q - 2, SIZE, 4);
  }

  const hc = makeCanvas();
  const hctx = hc.getContext('2d');
  hctx.fillStyle = '#909090';
  hctx.fillRect(0, 0, SIZE, SIZE);
  hctx.fillStyle = '#404040';
  for (let i = 0; i <= 4; i++) {
    hctx.fillRect(i * q - 2, 0, 4, SIZE);
    hctx.fillRect(0, i * q - 2, SIZE, 4);
  }
  const hrng = mulberry32(0x9a7);
  noiseOverlay(hctx, hrng, 9000, 0.25);

  return {
    map: canvasTexture(c),
    normalMap: canvasTexture(normalFromHeight(hc, 1.6), THREE.NoColorSpace),
  };
}

// ---- Materials --------------------------------------------------------------

export function buildMaterials() {
  const wp = makeWallpaper();
  const cp = makeCarpet();
  const cl = makeCeiling();

  const wall = new THREE.MeshStandardMaterial({
    map: wp.map,
    normalMap: wp.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: wp.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
  });

  const carpet = new THREE.MeshStandardMaterial({
    map: cp.map,
    normalMap: cp.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: cp.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
  });

  const ceiling = new THREE.MeshStandardMaterial({
    map: cl.map,
    normalMap: cl.normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.95,
    metalness: 0.0,
  });

  // fluorescent diffuser: unlit, instance colors pushed past 1.0 drive both
  // the flicker and the bloom (instanceColor multiplies the base color)
  const fixtureGlow = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const fixtureFrame = new THREE.MeshStandardMaterial({
    color: 0x9a9a92, roughness: 0.5, metalness: 0.6,
  });

  return { wall, carpet, ceiling, fixtureGlow, fixtureFrame };
}
