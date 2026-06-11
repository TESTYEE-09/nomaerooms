import { clamp } from '../core/utils.js';

export class Hallucinations {
  constructor(audio) {
    this.audio = audio;
    this._whisperTimer = 0;
    this._tinnitusTimer = 0;
    this._tinnitusActive = false;
    this._eventTimer = 0;
    this._lastFear = 0;
  }

  update(dt, fear, t) {
    this._lastFear = fear;

    if (fear < 0.25) {
      if (this._tinnitusActive) {
        this.audio.stopTinnitus();
        this._tinnitusActive = false;
      }
      this._whisperTimer = 3 + Math.random() * 4;
      return;
    }

    this._scheduleWhispers(dt, fear);
    this._scheduleTinnitus(dt, fear);
  }

  _scheduleWhispers(dt, fear) {
    this._whisperTimer -= dt;
    if (this._whisperTimer <= 0) {
      const interval = clamp(8 - fear * 6, 2, 8);
      this._whisperTimer = interval * (0.5 + Math.random() * 0.5);
      const r = Math.random();
      if (r < 0.45) {
        this.audio.hallucinationWhisper();
      } else if (r < 0.7) {
        this.audio.hallucinationWhisperFar();
      }
    }
  }

  _scheduleTinnitus(dt, fear) {
    if (fear > 0.6 && !this._tinnitusActive) {
      this._tinnitusTimer -= dt;
      if (this._tinnitusTimer <= 0) {
        this._tinnitusActive = true;
        this.audio.startTinnitus();
        const duration = 1500 + Math.random() * 2500;
        setTimeout(() => {
          this.audio.stopTinnitus();
          this._tinnitusActive = false;
          this._tinnitusTimer = 5 + Math.random() * 8;
        }, duration);
      }
    } else if (fear <= 0.6 && this._tinnitusActive) {
      this.audio.stopTinnitus();
      this._tinnitusActive = false;
      this._tinnitusTimer = 0;
    }
    if (this._tinnitusTimer <= 0 && !this._tinnitusActive) {
      this._tinnitusTimer = 5 + Math.random() * 8;
    }
  }

  destroy() {
    this.audio.stopHallucinations();
    this._tinnitusActive = false;
  }
}
