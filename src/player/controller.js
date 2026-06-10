// First-person controller: pointer-look, WASD with acceleration, sprint with
// stamina, head bob, footstep events, wall sliding against chunk colliders.

import * as THREE from 'three';
import {
  EYE_HEIGHT, PLAYER_RADIUS, WALK_SPEED, SPRINT_SPEED,
  STAMINA_MAX, STAMINA_DRAIN, STAMINA_REGEN, JUMP_SPEED, GRAVITY,
} from '../core/config.js';
import { clamp, damp, lerp } from '../core/utils.js';
import { resolveCollision } from '../world/chunks.js';

export class PlayerController {
  constructor(camera, input, settingsRef) {
    this.camera = camera;
    this.input = input;
    this.settings = settingsRef;
    this.pos = new THREE.Vector3(2, 0, 2);
    this.vel = new THREE.Vector2(0, 0);   // xz
    this.y = 0;                           // height above floor
    this.vy = 0;
    this.grounded = true;
    this.yaw = 0;
    this.pitch = 0;
    this.stamina = STAMINA_MAX;
    this.exhausted = false;               // must recover above 25 to sprint again
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.speedFrac = 0;                   // 0..1 of sprint speed, for FOV kick
    this.onFootstep = null;               // cb(isSprinting)
    this.moving = false;
    this.sprinting = false;
    this.frozen = false;                  // during jumpscare
  }

  teleport(x, z, yaw = Math.random() * Math.PI * 2) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }

  update(dt, colliders) {
    const look = this.input.consumeLook();
    if (!this.frozen) {
      const sens = 0.0023 * this.settings.sensitivity;
      this.yaw -= look.dx * sens;
      this.pitch = clamp(this.pitch - look.dy * sens, -1.45, 1.45);
    }

    const mv = this.frozen ? { x: 0, y: 0 } : this.input.move;
    const wantSprint = this.input.sprint && mv.y > 0.1 && !this.frozen;

    // stamina
    if (this.exhausted && this.stamina > STAMINA_MAX * 0.3) this.exhausted = false;
    this.sprinting = wantSprint && !this.exhausted && this.stamina > 0;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
      if (this.stamina <= 0) this.exhausted = true;
    } else {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN * dt);
    }

    const targetSpeed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // camera-relative: forward is -Z in camera space
    const wx = (mv.x * cos - mv.y * sin) * targetSpeed;
    const wz = (-mv.x * sin - mv.y * cos) * targetSpeed;
    this.vel.x = damp(this.vel.x, wx, 12, dt);
    this.vel.y = damp(this.vel.y, wz, 12, dt);

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;
    resolveCollision(this.pos, PLAYER_RADIUS, colliders);

    // jump
    if (this.grounded && !this.frozen && this.input.keys.has('Space')) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.grounded = true;
        this.onFootstep?.(true); // landing thud
      }
    }

    // head bob + footsteps
    const speed = Math.hypot(this.vel.x, this.vel.y);
    this.moving = speed > 0.4;
    this.speedFrac = clamp(speed / SPRINT_SPEED, 0, 1);
    const bobFreq = this.sprinting ? 11.5 : 8.2;
    const prevPhase = this.bobPhase;
    if (this.moving) this.bobPhase += dt * bobFreq * (0.4 + 0.6 * this.speedFrac);
    this.bobAmp = damp(this.bobAmp, this.moving ? 1 : 0, 8, dt);
    if (Math.floor(this.bobPhase / Math.PI) !== Math.floor(prevPhase / Math.PI) && this.moving) {
      this.onFootstep?.(this.sprinting);
    }

    const air = this.grounded ? 1 : 0;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.05 * this.bobAmp * air;
    const bobX = Math.sin(this.bobPhase * 0.5) * 0.025 * this.bobAmp * air;

    this.camera.position.set(
      this.pos.x + Math.cos(this.yaw) * bobX,
      this.y + EYE_HEIGHT + bobY,
      this.pos.z - Math.sin(this.yaw) * bobX
    );
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);

    // sprint FOV kick
    const baseFov = this.settings.fov;
    const targetFov = baseFov + (this.sprinting ? 7 : 0) * this.speedFrac;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, targetFov, 1 - Math.exp(-6 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
