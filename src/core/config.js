// World + gameplay constants shared across modules.

export const CELL = 4;            // metres per maze cell
export const WALL_H = 3.6;        // ceiling height
export const WALL_T = 0.32;      // wall thickness
export const CHUNK_CELLS = 8;     // cells per chunk side
export const CHUNK_SIZE = CELL * CHUNK_CELLS; // 32 m

export const EYE_HEIGHT = 1.62;
export const PLAYER_HEIGHT = 1.8;  // remote-player avatar model height
export const PLAYER_RADIUS = 0.34;
export const WALK_SPEED = 3.5;
export const SPRINT_SPEED = 6.0;
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 22;  // per second sprinting
export const STAMINA_REGEN = 14;  // per second resting

export const CLARK_HEIGHT = 1.9;   // visibly tall, fits in a doorway with a bit of clearance
export const JUMP_SPEED = 4.6;
export const GRAVITY = 13.5;
export const CLARK_SCARE_DIST = 1.9;

export const NET_SEND_HZ = 12;
export const CLARK_NET_HZ = 10;

export const HUNTED_SURVIVE_TIME = 300;   // seconds (5 min)
export const HUNTED_SWAP_RANGE = 8;       // metres to swap
export const HUNTED_SWAP_COOLDOWN = 30;   // seconds between swaps

export const FLASHLIGHT_PICKUP_DIST = 2.5;
export const FLASHLIGHT_RANGE = 18;

export const WEAPON_STUN_DURATION = 4;
export const WEAPON_RANGE = 20;
export const WEAPON_PICKUP_DIST = 2.5;
export const WEAPON_USER_COOLDOWN = 10;

export const QUALITY = {
  low:    { chunkRadius: 1, lights: 5,  shadowLights: 0, shadowMap: 512,  bloom: true, pixelRatio: 0.85, fogDensity: 0.075 },
  medium: { chunkRadius: 2, lights: 8,  shadowLights: 2, shadowMap: 768,  bloom: true, pixelRatio: 1.0,  fogDensity: 0.055 },
  high:   { chunkRadius: 2, lights: 12, shadowLights: 3, shadowMap: 1024, bloom: true, pixelRatio: 1.5,  fogDensity: 0.05 },
};
