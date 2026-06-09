// textures.js — procedural PBR texture generation
//
// Every surface in the Backrooms is authored here as a matched set of
// {map, normalMap, roughnessMap} so the MeshStandardMaterials in world.js get
// real depth and surface variation instead of a flat painted look. Albedo and a
// grayscale height field are drawn on canvases; the height field is converted to
// a tangent-space normal map with a Sobel pass and to a roughness map by curve.
//
// Everything is generated once at module load (a handful of canvas ops) and the
// resulting THREE.Textures are shared across all room meshes.

import * as THREE from 'three';

const MAX_ANISO = 8;

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toColorTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function toDataTexture(canvas) {
  // Non-color data (normal / roughness): keep linear, no sRGB decode.
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = MAX_ANISO;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Convert a grayscale height canvas → tangent-space normal map canvas (Sobel).
function heightToNormal(heightCanvas, strength = 2.0) {
  const size = heightCanvas.width;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, size, size).data;
  const out = makeCanvas(size);
  const octx = out.getContext('2d');
  const dst = octx.createImageData(size, size);
  const h = (x, y) => {
    // wrap so the map tiles seamlessly
    const xx = (x + size) % size;
    const yy = (y + size) % size;
    return src[(yy * size + xx) * 4] / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      dst.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      dst.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      dst.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

// Roughness from a height field: darker (lower) areas read as worn/rougher.
function heightToRoughness(heightCanvas, lo = 0.55, hi = 0.95) {
  const size = heightCanvas.width;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, size, size).data;
  const out = makeCanvas(size);
  const octx = out.getContext('2d');
  const dst = octx.createImageData(size, size);
  for (let i = 0; i < src.length; i += 4) {
    const v = src[i] / 255;
    const r = (lo + (hi - lo) * (1 - v)) * 255;
    dst.data[i] = dst.data[i + 1] = dst.data[i + 2] = r;
    dst.data[i + 3] = 255;
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

// ---- Yellow wallpaper --------------------------------------------------------

function makeWallpaper(size = 512) {
  const albedo = makeCanvas(size);
  const a = albedo.getContext('2d');
  const height = makeCanvas(size);
  const hctx = height.getContext('2d');

  // base — iconic Backrooms yellow with a faint vertical gradient
  const base = a.createLinearGradient(0, 0, 0, size);
  base.addColorStop(0, '#e9c66a');
  base.addColorStop(1, '#d8b352');
  a.fillStyle = base;
  a.fillRect(0, 0, size, size);

  // height base mid-gray
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, size, size);

  // vertical wallpaper striping (subtle tonal bands + raised texture)
  const stripe = size / 16;
  for (let x = 0; x < size; x += stripe) {
    if (((x / stripe) | 0) % 2 === 0) {
      a.fillStyle = 'rgba(255,240,190,0.06)';
      a.fillRect(x, 0, stripe, size);
      hctx.fillStyle = 'rgba(255,255,255,0.10)';
      hctx.fillRect(x, 0, stripe / 2, size);
      hctx.fillStyle = 'rgba(0,0,0,0.10)';
      hctx.fillRect(x + stripe / 2, 0, stripe / 2, size);
    }
  }

  // mottled water stains
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = size * (0.04 + Math.random() * 0.12);
    const grad = a.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(96, 66, 16, 0.40)');
    grad.addColorStop(0.7, 'rgba(110, 80, 24, 0.12)');
    grad.addColorStop(1, 'rgba(110, 80, 24, 0)');
    a.fillStyle = grad;
    a.beginPath(); a.arc(x, y, r, 0, Math.PI * 2); a.fill();
  }

  // fine grain noise on both albedo and height
  const grain = a.getImageData(0, 0, size, size);
  const gd = grain.data;
  const hd = hctx.getImageData(0, 0, size, size);
  for (let i = 0; i < gd.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    gd[i] += n; gd[i + 1] += n; gd[i + 2] += n * 0.6;
    const hn = (Math.random() - 0.5) * 30;
    hd.data[i] += hn; hd.data[i + 1] += hn; hd.data[i + 2] += hn;
  }
  a.putImageData(grain, 0, 0);
  hctx.putImageData(hd, 0, 0);

  // scuffs / scratches into the height field
  hctx.strokeStyle = 'rgba(40,40,40,0.5)';
  hctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    hctx.beginPath();
    hctx.moveTo(Math.random() * size, Math.random() * size);
    hctx.lineTo(Math.random() * size, Math.random() * size);
    hctx.stroke();
  }

  return {
    map: toColorTexture(albedo),
    normalMap: toDataTexture(heightToNormal(height, 1.4)),
    roughnessMap: toDataTexture(heightToRoughness(height, 0.6, 0.92)),
  };
}

// ---- Damp green carpet -------------------------------------------------------

function makeCarpet(size = 512) {
  const albedo = makeCanvas(size);
  const a = albedo.getContext('2d');
  const height = makeCanvas(size);
  const hctx = height.getContext('2d');

  a.fillStyle = '#59673a';
  a.fillRect(0, 0, size, size);
  hctx.fillStyle = '#7a7a7a';
  hctx.fillRect(0, 0, size, size);

  // dense fiber speckle
  const img = a.getImageData(0, 0, size, size);
  const d = img.data;
  const hd = hctx.getImageData(0, 0, size, size);
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5);
    d[i] += n * 34;          // r
    d[i + 1] += n * 40;      // g
    d[i + 2] += n * 22;      // b
    const hn = (Math.random() - 0.5) * 70;
    hd.data[i] += hn; hd.data[i + 1] += hn; hd.data[i + 2] += hn;
  }
  a.putImageData(img, 0, 0);
  hctx.putImageData(hd, 0, 0);

  // damp darker patches (also lower in height → look matted)
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = size * (0.06 + Math.random() * 0.16);
    const g1 = a.createRadialGradient(x, y, 0, x, y, r);
    g1.addColorStop(0, 'rgba(22, 32, 12, 0.5)');
    g1.addColorStop(1, 'rgba(22, 32, 12, 0)');
    a.fillStyle = g1; a.beginPath(); a.arc(x, y, r, 0, Math.PI * 2); a.fill();
    const g2 = hctx.createRadialGradient(x, y, 0, x, y, r);
    g2.addColorStop(0, 'rgba(0,0,0,0.5)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    hctx.fillStyle = g2; hctx.beginPath(); hctx.arc(x, y, r, 0, Math.PI * 2); hctx.fill();
  }

  return {
    map: toColorTexture(albedo),
    // carpet has tight high-frequency detail → stronger normal, fully rough
    normalMap: toDataTexture(heightToNormal(height, 2.4)),
    roughnessMap: toDataTexture(heightToRoughness(height, 0.85, 1.0)),
  };
}

// ---- Drop-ceiling tiles ------------------------------------------------------

function makeCeiling(size = 512) {
  const albedo = makeCanvas(size);
  const a = albedo.getContext('2d');
  const height = makeCanvas(size);
  const hctx = height.getContext('2d');

  a.fillStyle = '#d9cb98';
  a.fillRect(0, 0, size, size);
  hctx.fillStyle = '#b0b0b0';
  hctx.fillRect(0, 0, size, size);

  // 2x2 grid of recessed tiles with bevelled grooves
  const tile = size / 2;
  const groove = Math.max(3, size * 0.012);
  hctx.fillStyle = '#404040';
  for (let i = 0; i <= 2; i++) {
    hctx.fillRect(i * tile - groove / 2, 0, groove, size);
    hctx.fillRect(0, i * tile - groove / 2, size, groove);
  }
  a.strokeStyle = 'rgba(70, 58, 34, 0.55)';
  a.lineWidth = groove;
  for (let i = 0; i <= 2; i++) {
    a.beginPath(); a.moveTo(i * tile, 0); a.lineTo(i * tile, size); a.stroke();
    a.beginPath(); a.moveTo(0, i * tile); a.lineTo(size, i * tile); a.stroke();
  }

  // perforation speckle (acoustic tile dots) on height
  const hd = hctx.getImageData(0, 0, size, size);
  for (let k = 0; k < 1600; k++) {
    const i = (Math.floor(Math.random() * size * size)) * 4;
    hd.data[i] -= 60; hd.data[i + 1] -= 60; hd.data[i + 2] -= 60;
  }
  hctx.putImageData(hd, 0, 0);

  // water stains
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = size * (0.03 + Math.random() * 0.1);
    const grad = a.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(120, 95, 45, 0.5)');
    grad.addColorStop(1, 'rgba(120, 95, 45, 0)');
    a.fillStyle = grad;
    a.beginPath(); a.arc(x, y, r, 0, Math.PI * 2); a.fill();
  }

  return {
    map: toColorTexture(albedo),
    normalMap: toDataTexture(heightToNormal(height, 1.8)),
    roughnessMap: toDataTexture(heightToRoughness(height, 0.7, 0.95)),
  };
}

export const TEX = {
  wallpaper: makeWallpaper(),
  carpet: makeCarpet(),
  ceiling: makeCeiling(),
};
