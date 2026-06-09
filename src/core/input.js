// Keyboard + mouse (pointer lock) + mobile touch input, unified.
//
// Output every frame:
//   input.move   {x, y}  -1..1 strafe / forward
//   input.look   {dx, dy} accumulated since last frame (consumed by caller)
//   input.sprint boolean

import { clamp } from './utils.js';

export const IS_TOUCH = matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window;

export class Input {
  constructor() {
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.look = { dx: 0, dy: 0 };
    this.sprint = false;
    this.enabled = false;     // only while playing & not typing in chat
    this.pointerLocked = false;
    this.onLockChange = null; // callback(locked)

    this._touchMove = null;   // {id, ox, oy, x, y}
    this._touchLook = null;
    this._sprintTouch = false;

    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.pointerLocked) return;
      this.look.dx += e.movementX;
      this.look.dy += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement != null;
      if (this.onLockChange) this.onLockChange(this.pointerLocked);
    });

    if (IS_TOUCH) this._bindTouch();
  }

  requestLock(canvas) {
    if (IS_TOUCH) return; // no pointer lock on touch devices
    canvas.requestPointerLock?.();
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _bindTouch() {
    const zone = document.body;
    zone.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.target.closest('.ui-block')) continue; // let buttons work
        if (t.clientX < innerWidth * 0.45 && !this._touchMove) {
          this._touchMove = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
        } else if (!this._touchLook) {
          this._touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: true });
    zone.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (this._touchMove && t.identifier === this._touchMove.id) {
          this._touchMove.x = t.clientX; this._touchMove.y = t.clientY;
        } else if (this._touchLook && t.identifier === this._touchLook.id) {
          this.look.dx += (t.clientX - this._touchLook.x) * 2.2;
          this.look.dy += (t.clientY - this._touchLook.y) * 2.2;
          this._touchLook.x = t.clientX; this._touchLook.y = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this._touchMove && t.identifier === this._touchMove.id) this._touchMove = null;
        if (this._touchLook && t.identifier === this._touchLook.id) this._touchLook = null;
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
  }

  setSprintTouch(v) { this._sprintTouch = v; }

  update() {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;

    if (this._touchMove) {
      const dx = (this._touchMove.x - this._touchMove.ox) / 55;
      const dy = (this._touchMove.oy - this._touchMove.y) / 55;
      x = clamp(dx, -1, 1); y = clamp(dy, -1, 1);
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move.x = x; this.move.y = y;
    this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this._sprintTouch;
  }

  consumeLook() {
    const l = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = 0; this.look.dy = 0;
    return l;
  }
}
