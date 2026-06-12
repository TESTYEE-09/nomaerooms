// World + gameplay constants shared across modules.

export const CELL = 4;            // metres per facility cell
export const WALL_H = 3.4;        // facility ceiling height
export const WALL_T = 0.32;       // wall thickness

export const EYE_HEIGHT = 1.62;
export const PLAYER_HEIGHT = 1.8;  // remote-player avatar model height
export const PLAYER_RADIUS = 0.34;
export const WALK_SPEED = 3.6;
export const SPRINT_SPEED = 6.2;
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 20;  // per second sprinting
export const STAMINA_REGEN = 14;  // per second resting
export const JUMP_SPEED = 4.6;
export const GRAVITY = 13.5;

export const NET_SEND_HZ = 12;
export const ENT_NET_HZ = 10;
export const GM_NET_HZ = 2;

export const INTERACT_DIST = 3.2;
export const INV_SLOTS = 2;
export const FLASHLIGHT_RANGE = 22;

// ---- run economy ----
export const START_MONEY = 60;
export const START_QUOTA = 130;
export const QUOTA_STEP = 125;       // added per fulfilled cycle (+ ramp)
export const QUOTA_DAYS = 3;
export const FLASHLIGHT_PRICE = 15;

// ---- day clock ----
export const DAY_START_H = 8;        // land at 08:00
export const DAY_END_H = 24;         // forced takeoff at midnight
export const DAY_REAL_SECONDS = 660; // a moon day lasts 11 real minutes
export const HOUND_HOUR = 21;        // hounds come out at 21:00

// ---- ship ----
export const SHIP_W = 9;             // interior metres (x)
export const SHIP_D = 5.4;           // interior metres (z)
export const SHIP_H = 2.9;
export const SHIP_FLOOR_Y = 0;
export const TRANSIT_TIME = 9;       // landing / takeoff seconds

// ---- facility ----
export const FAC_OFF = { x: 5000, z: 5000 };  // facility interior world offset
export const FAC_CELLS = 34;                  // bounded maze side, in cells

// ---- moons ----
// Catalogue used by terminal + world builder. companies values are seeds for
// deterministic per-day scrap layouts.
export const MOONS = [
  {
    id: 'vacant', name: 'VACANT', desc: 'quiet test site. low hazard.',
    fog: 0x788272, sky: 0x9aa593, ground: 0x5d6353, fogDay: 0.012,
    scrapMin: 8, scrapMax: 11, valueMul: 1.0,
    crawlers: 1, stalkers: 0, hounds: 1, facDist: 64,
  },
  {
    id: 'marsh', name: 'MARSH', desc: 'waterlogged. the fog never lifts.',
    fog: 0x5e6d5a, sky: 0x6c7a66, ground: 0x44503c, fogDay: 0.028,
    scrapMin: 11, scrapMax: 15, valueMul: 1.15,
    crawlers: 2, stalkers: 1, hounds: 1, facDist: 86,
  },
  {
    id: 'rend', name: 'REND', desc: 'red dusk. high yield. do not linger.',
    fog: 0x4a2e28, sky: 0x57342a, ground: 0x3a2c26, fogDay: 0.02,
    scrapMin: 15, scrapMax: 20, valueMul: 1.45,
    crawlers: 2, stalkers: 2, hounds: 2, facDist: 102,
  },
  {
    id: 'company', name: 'THE COMPANY', desc: 'sell your scrap. meet the quota.',
    fog: 0x6e6a5e, sky: 0x847e6c, ground: 0x55503f, fogDay: 0.015,
    scrapMin: 0, scrapMax: 0, valueMul: 1,
    crawlers: 0, stalkers: 0, hounds: 0, facDist: 0,
  },
];
export const COMPANY_IDX = 3;

// sell rate by days left when ringing the bell (sell late, earn more)
export const SELL_RATE = { 0: 1.0, 1: 0.87, 2: 0.71, 3: 0.55 };

// ---- scrap catalogue ----
// model: file in public/models/lethal/. h: target size (largest dimension, m).
// w: carry weight (slows you). v: [min,max] base value.
export const SCRAP_TYPES = [
  { id: 'duck',     name: 'rubber duck',  model: 'scrap_duck.glb',     h: 0.30, w: 2,  v: [6, 28],   p: 1.0 },
  { id: 'wrench',   name: 'big wrench',   model: 'scrap_wrench.glb',   h: 0.55, w: 14, v: [14, 38],  p: 1.0 },
  { id: 'gameboy',  name: 'handheld',     model: 'scrap_gameboy.glb',  h: 0.28, w: 4,  v: [26, 64],  p: 0.9 },
  { id: 'radio',    name: 'old radio',    model: 'scrap_radio.glb',    h: 0.42, w: 12, v: [22, 56],  p: 0.9 },
  { id: 'skull',    name: 'plastic skull',model: 'scrap_skull.glb',    h: 0.26, w: 3,  v: [16, 44],  p: 0.8 },
  { id: 'jerrycan', name: 'fuel can',     model: 'scrap_jerrycan.glb', h: 0.50, w: 16, v: [18, 48],  p: 0.8 },
  { id: 'horn',     name: 'clown horn',   model: 'scrap_horn.glb',     h: 0.30, w: 3,  v: [32, 78],  p: 0.5 },
  { id: 'goldbar',  name: 'gold bar',     model: 'scrap_goldbar.glb',  h: 0.32, w: 30, v: [85, 160], p: 0.18 },
];

export const QUALITY = {
  low:    { lights: 5,  shadowLights: 0, shadowMap: 512,  bloom: true, pixelRatio: 0.85 },
  medium: { lights: 8,  shadowLights: 2, shadowMap: 768,  bloom: true, pixelRatio: 1.0 },
  high:   { lights: 12, shadowLights: 3, shadowMap: 1024, bloom: true, pixelRatio: 1.5 },
};
