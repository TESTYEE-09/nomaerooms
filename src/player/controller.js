// First-person controller: pointer-look, WASD with acceleration, sprint with
// stamina, head bob, footstep events, wall sliding against chunk colliders.

import * as THREE from 'three';
import {
  EYE_HEIGHT, PLAYER_RADIUS, WALK_SPEED, SPRINT_SPEED,
  STAMINA_MAX, STAMINA_DRAIN, STAMINA_REGEN, JUMP_SPEED, GRAVITY,
  FLASHLIGHT_RANGE,
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
    this.boostT = 0;                      // seconds of almond-water speed boost left
    this.hasFlashlight = false;
    this.hasGun = false;
    this._scene = null;
    this._flashLight = null;
    this._flashTarget = null;
    this._gunModel = null;
    this._muzzleFlash = null;
    this._muzzleFlashTimer = 0;
  }

  initFlashlight(scene) {
    this._scene = scene;
    this._flashLight = new THREE.SpotLight(0xffeedd, 0, FLASHLIGHT_RANGE, Math.PI / 4, 0.3, 1.2);
    this._flashLight.angle = Math.PI / 4;
    this._flashLight.penumbra = 0.3;
    this._flashLight.decay = 1.2;
    this._flashLight.distance = FLASHLIGHT_RANGE;
    this._flashLight.shadow.mapSize.width = 512;
    this._flashLight.shadow.mapSize.height = 512;
    this._flashLight.shadow.camera.near = 0.1;
    this._flashLight.shadow.camera.far = FLASHLIGHT_RANGE;
    this._flashLight.shadow.camera.fov = 45;
    this._flashLight.castShadow = true;
    // target must live in world space (scene), not as a child of the light —
    // otherwise the world coords assigned each frame get offset by the light's
    // own position and the beam aims wherever the player stands, not where
    // they look
    this._flashTarget = new THREE.Object3D();
    scene.add(this._flashTarget);
    this._flashLight.target = this._flashTarget;
    scene.add(this._flashLight);
  }

  initGun(scene) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.6 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.8, metalness: 0.0 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.4, metalness: 0.5 });

    this._gunModel = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.1), bodyMat);
    body.position.set(0, -0.03, -0.08);
    this._gunModel.add(body);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.14, 6), bodyMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, -0.03, 0.02);
    this._gunModel.add(barrel);

    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.025, 8), accentMat);
    cyl.rotation.x = Math.PI / 2;
    cyl.position.set(0, -0.03, -0.04);
    this._gunModel.add(cyl);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.06, 0.02), gripMat);
    grip.position.set(0, -0.08, -0.07);
    this._gunModel.add(grip);

    // muzzle flash light
    this._muzzleFlash = new THREE.PointLight(0xffaa44, 0, 4);
    this._muzzleFlash.position.set(0, -0.03, 0.1);
    this._gunModel.add(this._muzzleFlash);

    this._gunModel.visible = false;
    this._gunModel.position.set(0.22, -0.18, -0.3);
    this.camera.add(this._gunModel);
  }

  setGun(on) {
    this.hasGun = on;
    if (this._gunModel) this._gunModel.visible = on;
  }

  fireGun() {
    if (!this._muzzleFlash) return;
    this._muzzleFlash.intensity = 3;
    this._muzzleFlashTimer = 0.08;
  }

  setFlashlight(on) {
    this.hasFlashlight = on;
    if (this._flashLight) this._flashLight.intensity = on ? 25 : 0;
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

    if (this.boostT > 0) this.boostT -= dt;
    const targetSpeed = (this.sprinting ? SPRINT_SPEED : WALK_SPEED) * (this.boostT > 0 ? 1.3 : 1);
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

    const eyeX = this.pos.x + Math.cos(this.yaw) * bobX;
    const eyeY = this.y + EYE_HEIGHT + bobY;
    const eyeZ = this.pos.z - Math.sin(this.yaw) * bobX;
    this.camera.position.set(eyeX, eyeY, eyeZ);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);

    // flashlight follows the full look direction (yaw + pitch)
    if (this._flashLight) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this._flashLight.position.copy(this.camera.position).addScaledVector(fwd, 0.3);
      this._flashLight.position.y -= 0.15;
      this._flashTarget.position.copy(this.camera.position).addScaledVector(fwd, 6);
    }

    // muzzle flash decay
    if (this._muzzleFlash && this._muzzleFlashTimer > 0) {
      this._muzzleFlashTimer -= dt;
      if (this._muzzleFlashTimer <= 0) {
        this._muzzleFlash.intensity = 0;
      } else {
        this._muzzleFlash.intensity = 3 * (this._muzzleFlashTimer / 0.08);
      }
    }

    // sprint FOV kick
    const baseFov = this.settings.fov;
    const targetFov = baseFov + (this.sprinting ? 7 : 0) * this.speedFrac;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, targetFov, 1 - Math.exp(-6 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
