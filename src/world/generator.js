// Deterministic infinite maze. Pure functions of (cell coords, seed) so every
// peer — and the AI, and collision — agrees on the layout without sending it.
//
// Layout language:
//   wallE(x,z)  wall on the +X edge of cell (x,z)
//   wallS(x,z)  wall on the +Z edge of cell (x,z)
//   pillar(x,z) square column at the cell centre
//   fixture(x,z) fluorescent light at the cell centre
// Low-frequency value noise opens up big pillared halls; elsewhere the random
// edge walls form twisting corridors and dead ends.

import { hash3, valueNoise, clamp } from '../core/utils.js';
import { CELL } from '../core/config.js';

let SEED = 1;
export function setSeed(s) { SEED = s | 0; }
export function getSeed() { return SEED; }

// open "hall" field — > 0.60 means a large open room
function hallField(x, z) {
  return valueNoise(x / 11, z / 11, SEED ^ 0x5eed);
}

// local wall density 0.14 .. 0.34
function density(x, z) {
  return 0.14 + 0.20 * valueNoise(x / 23 + 100, z / 23 - 50, SEED ^ 0x77aa);
}

export function isHall(x, z) {
  return hallField(x, z) > 0.60;
}

export function wallE(x, z) {
  if (isHall(x, z) || isHall(x + 1, z)) return false;
  return hash3(x, z, 1, SEED) < density(x, z);
}

export function wallS(x, z) {
  if (isHall(x, z) || isHall(x, z + 1)) return false;
  return hash3(x, z, 2, SEED) < density(x, z);
}

export function pillar(x, z) {
  if (isHall(x, z)) {
    // regular-ish colonnade with gaps
    return ((x % 3) + 3) % 3 === 1 && ((z % 3) + 3) % 3 === 1 && hash3(x, z, 3, SEED) < 0.8;
  }
  return false;
}

export function fixture(x, z) {
  // halls are lit on a loose grid; corridors get sparse, moody coverage
  if (isHall(x, z)) return ((x % 2) + 2) % 2 === 0 && ((z % 2) + 2) % 2 === 0;
  return hash3(x, z, 7, SEED) < 0.24;
}

// flicker personality 0..1 (higher = steadier)
export function fixtureSteadiness(x, z) {
  return hash3(x, z, 8, SEED);
}

// Can an agent walk from cell a to adjacent cell b? (4-connected)
export function passable(x, z, nx, nz) {
  if (pillar(nx, nz)) {
    // pillars only block the centre; cells with pillars are still passable
    // around the edges, so don't treat them as solid for nav — except halls
    // are wide enough that it never matters. Treat as passable.
  }
  if (nx === x + 1) return !wallE(x, z);
  if (nx === x - 1) return !wallE(nx, nz);
  if (nz === z + 1) return !wallS(x, z);
  if (nz === z - 1) return !wallS(nx, nz);
  return false;
}

export const cellCenter = (x, z) => ({ x: (x + 0.5) * CELL, z: (z + 0.5) * CELL });
export const worldToCell = (wx, wz) => ({ x: Math.floor(wx / CELL), z: Math.floor(wz / CELL) });

// A* over the cell grid. Returns array of {x,z} cells (excluding start) or null.
export function findPath(sx, sz, tx, tz, maxNodes = 900) {
  if (sx === tx && sz === tz) return [];
  const key = (x, z) => x + ',' + z;
  const open = [{ x: sx, z: sz, g: 0, f: 0 }];
  const came = new Map();
  const gScore = new Map([[key(sx, sz), 0]]);
  const closed = new Set();
  let visited = 0;

  while (open.length && visited < maxNodes) {
    // smallest f (linear scan is fine at this scale)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.z);
    if (closed.has(ck)) continue;
    closed.add(ck);
    visited++;

    if (cur.x === tx && cur.z === tz) {
      const path = [];
      let k = ck;
      while (came.has(k)) {
        const [px, pz] = k.split(',').map(Number);
        path.push({ x: px, z: pz });
        k = came.get(k);
      }
      return path.reverse();
    }

    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, nz = cur.z + dz;
      if (!passable(cur.x, cur.z, nx, nz)) continue;
      const nk = key(nx, nz);
      if (closed.has(nk)) continue;
      const g = cur.g + 1;
      if (g >= (gScore.get(nk) ?? Infinity)) continue;
      gScore.set(nk, g);
      came.set(nk, ck);
      const h = Math.abs(tx - nx) + Math.abs(tz - nz);
      open.push({ x: nx, z: nz, g, f: g + h });
    }
  }
  return null;
}

// Straight-line visibility between two world points, walking the cell grid.
export function lineOfSight(ax, az, bx, bz) {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.45));
  let { x: px, z: pz } = worldToCell(ax, az);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const wx = ax + (bx - ax) * t;
    const wz = az + (bz - az) * t;
    const { x: cx, z: cz } = worldToCell(wx, wz);
    if (cx !== px || cz !== pz) {
      // moved into a new cell — must be passable from previous (axis steps)
      let ok = true;
      if (cx !== px && cz !== pz) {
        // diagonal hop: require one of the two L-paths open
        ok = (passable(px, pz, cx, pz) && passable(cx, pz, cx, cz)) ||
             (passable(px, pz, px, cz) && passable(px, cz, cx, cz));
      } else {
        ok = passable(px, pz, cx, cz);
      }
      if (!ok) return false;
      px = cx; pz = cz;
    }
  }
  return true;
}

// Find a spawnable open cell near (cx,cz): not a pillar, reasonably connected.
export function findOpenCell(cx, cz, minOpenings = 2) {
  for (let r = 0; r < 24; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz;
        if (pillar(x, z)) continue;
        let openings = 0;
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (passable(x, z, x + ox, z + oz)) openings++;
        }
        if (openings >= minOpenings) return { x, z };
      }
    }
  }
  return { x: cx, z: cz };
}

export { clamp };
