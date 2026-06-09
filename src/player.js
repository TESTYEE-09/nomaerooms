// player.js — first-person controller
//
// Pointer-lock + WASD + sprint + jump + head-bob + stamina + sanity.
// Sanity drains faster in the dark and when Clark is near. Used by the
// sanity bar in the HUD.

import * as THREE from 'three';
import { resolveCollision } from './world/world.js';

const EYE_H = 1.6;
const HALF_W = 0.35;
const HALF_H = 0.9;

const WALK_SPEED = 4.0;
const SPRINT_SPEED = 6.8;
const JUMP_VEL = 6.5;
const GRAVITY = 18.0;
const STAMINA_DRAIN = 18;     // per second sprinting
const STAMINA_RECOVER = 12;   // per second resting
const SANITY_DRAIN_DARK = 0.6;  // per second in deep dark
const SANITY_DRAIN_CLARK = 5.0; // per second when Clark is near

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.pos = new THREE.Vector3(0, EYE_H, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.stamina = 100;
    this.sanity = 100;
    this.bobT = 0;
    this._keys = new Set();
    this._pointerLocked = false;
    this._listeners = [];

    this._bindEvents();
  }

  _bindEvents() {
    const onMouseMove = (e) => {
      if (!this._pointerLocked) return;
      const sens = 0.0022;
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    };
    const onKeyDown = (e) => {
      this._keys.add(e.code);
      if (e.code === 'Space' && this._pointerLocked) e.preventDefault();
    };
    const onKeyUp = (e) => { this._keys.delete(e.code); };
    const onPointerLockChange = () => {
      this._pointerLocked = document.pointerLockElement === this.dom;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    this._listeners.push(['mousemove', onMouseMove], ['keydown', onKeyDown], ['keyup', onKeyUp], ['pointerlockchange', onPointerLockChange]);
  }

  dispose() {
    for (const [evt, fn] of this._listeners) document.removeEventListener(evt, fn);
  }

  requestLock() {
    this.dom.requestPointerLock();
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // Look direction (unit vector)
  getForward() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
  }

  update(dt, opts = {}) {
    const clarkDist = opts.clarkDist ?? Infinity;
    const inLight = opts.inLight ?? true;

    // ---- input → velocity ----
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    let mx = 0, mz = 0;
    if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) mz += 1;
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) mz -= 1;
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) mx -= 1;
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) mx += 1;

    const sprinting = (this._keys.has('ShiftLeft') || this._keys.has('ShiftRight')) && this.stamina > 1 && (mz !== 0 || mx !== 0);
    const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;

    const wish = new THREE.Vector3();
    if (mz !== 0) wish.addScaledVector(forward, mz);
    if (mx !== 0) wish.addScaledVector(right, mx);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    this.vel.x = wish.x;
    this.vel.z = wish.z;

    // jump
    if ((this._keys.has('Space') || this._keys.has('KeySpace')) && this.onGround) {
      this.vel.y = JUMP_VEL;
      this.onGround = false;
    }

    // gravity
    this.vel.y -= GRAVITY * dt;

    // ---- integrate + collide ----
    const prev = this.pos.clone();
    const next = this.pos.clone().addScaledVector(this.vel, dt);

    // X axis
    next.x = prev.x + this.vel.x * dt;
    // Z axis
    next.z = prev.z + this.vel.z * dt;
    // Y axis
    next.y = prev.y + this.vel.y * dt;

    const { floorY } = resolveCollision(prev, next, HALF_W, HALF_H);

    // floor: a room was found at our (x, z) — but only if next.y is "near" the floor.
    if (floorY > -Infinity && next.y <= EYE_H + 0.01) {
      next.y = EYE_H;
      this.vel.y = 0;
      this.onGround = true;
    } else if (next.y < EYE_H) {
      // outside any room — treat as falling
      this.onGround = false;
    }

    this.pos.copy(next);

    // head bob (only while moving on ground)
    let bobY = 0, bobX = 0;
    if (this.onGround && (mx !== 0 || mz !== 0)) {
      this.bobT += dt * (sprinting ? 12 : 8);
      bobY = Math.sin(this.bobT) * 0.04;
      bobX = Math.cos(this.bobT * 0.5) * 0.02;
    }

    // apply to camera
    this.camera.position.set(this.pos.x + bobX, this.pos.y + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // ---- stamina ----
    if (sprinting) this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
    else this.stamina = Math.min(100, this.stamina + STAMINA_RECOVER * dt);

    // ---- sanity ----
    let drain = 0;
    if (!inLight) drain += SANITY_DRAIN_DARK * dt;
    if (clarkDist < 25) drain += SANITY_DRAIN_CLARK * (1 - clarkDist / 25) * dt;
    this.sanity = Math.max(0, this.sanity - drain);
    // small regen in lit areas
    if (inLight && clarkDist >= 25) this.sanity = Math.min(100, this.sanity + 0.5 * dt);
  }

  teleport(v) {
    this.pos.copy(v);
    this.vel.set(0, 0, 0);
  }
}

export const PLAYER_EYE_H = EYE_H;
