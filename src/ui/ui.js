// DOM glue: screens, HUD, chat overlay, toasts. Game logic stays in main.js;
// this module only shows/hides and forwards events.

import './styles.css';
import { settings, saveSettings } from '../core/settings.js';
import { IS_TOUCH } from '../core/input.js';
import { normalizeRoomCode } from '../core/utils.js';
import { saveLabel, hasSave } from '../game/save.js';

export class UI {
  constructor() {
    this._elCache = {};
    const $ = (id) => document.getElementById(id);
    const self = this;
    this.el = new Proxy({}, {
      get(_, prop) {
        if (!(prop in self._elCache)) {
          const hyphenated = String(prop).replace(/([A-Z])/g, '-$1').toLowerCase();
          const el = $(hyphenated);
          if (!el && prop !== 'canvas') console.warn('[UI] element not found:', prop, '(tried:', hyphenated + ')');
          self._elCache[prop] = el;
        }
        return self._elCache[prop];
      }
    });

    // callbacks set by main
    this.onHost = null;
    this.onJoin = null;       // (code)
    this.onContinue = null;   // resume a saved run
    this.onResume = null;
    this.onLeave = null;
    this.onChatSend = null;
    this.onSettingsChanged = null;
    this.onAnyClick = null;
    this.onInteractTouch = null;

    this._settingsReturnTo = 'menu';
    this._wire();
  }

  _wire() {
    const e = this.el;
    e.nameInput.value = settings.name;

    document.addEventListener('click', () => this.onAnyClick?.(), { once: false });

    e.hostBtn.addEventListener('click', () => {
      this._captureName();
      this.onHost?.();
    });
    e.continueBtn.addEventListener('click', () => {
      this._captureName();
      this.onContinue?.();
    });
    e.joinBtn.addEventListener('click', () => {
      this._captureName();
      const code = normalizeRoomCode(e.joinCode.value);
      if (code.length < 4) { this.showMenu('enter the 6-letter crew code'); return; }
      this.onJoin?.(code);
    });
    e.joinCode.addEventListener('input', () => {
      e.joinCode.value = normalizeRoomCode(e.joinCode.value);
    });

    // settings
    const syncSettingsUI = () => {
      e.setQuality.value = settings.quality;
      e.setFov.value = settings.fov; e.fovVal.textContent = settings.fov;
      e.setSens.value = settings.sensitivity; e.sensVal.textContent = settings.sensitivity.toFixed(2);
      e.setVol.value = settings.volume; e.volVal.textContent = Math.round(settings.volume * 100) + '%';
      e.setMusic.value = settings.musicVolume; e.musicVal.textContent = Math.round(settings.musicVolume * 100) + '%';
    };
    const openSettings = (from) => {
      this._settingsReturnTo = from;
      syncSettingsUI();
      this._show('settings');
    };
    e.settingsBtn.addEventListener('click', () => openSettings('menu'));
    e.pauseSettingsBtn.addEventListener('click', () => openSettings('pause'));
    e.settingsBack.addEventListener('click', () => this._show(this._settingsReturnTo));
    const onChange = () => {
      settings.quality = e.setQuality.value;
      settings.fov = +e.setFov.value;
      settings.sensitivity = +e.setSens.value;
      settings.volume = +e.setVol.value;
      settings.musicVolume = +e.setMusic.value;
      saveSettings();
      syncSettingsUI();
      this.onSettingsChanged?.();
    };
    for (const el of [e.setQuality, e.setFov, e.setSens, e.setVol, e.setMusic]) {
      el.addEventListener('input', onChange);
    }

    // pause
    e.resumeBtn.addEventListener('click', () => this.onResume?.());
    e.leaveBtn.addEventListener('click', () => this.onLeave?.());
    const copy = () => {
      navigator.clipboard?.writeText(this.el.roomCode.textContent).then(() => this.toast('code copied'));
    };
    e.copyCodeBtn.addEventListener('click', copy);
    e.roomChip.addEventListener('click', copy);

    // chat input
    e.chatInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        const text = e.chatInput.value.trim();
        if (text) this.onChatSend?.(text);
        this.closeChat();
      } else if (ev.key === 'Escape') {
        this.closeChat();
      }
    });

    if (IS_TOUCH) {
      e.touchUi.classList.remove('hidden');
      e.touchChat.addEventListener('click', () => this.openChat());
      e.touchInteract.addEventListener('click', () => this.onInteractTouch?.());
    }
  }

  _captureName() {
    const n = this.el.nameInput.value.trim().slice(0, 16);
    settings.name = n;
    saveSettings();
  }
  playerName() {
    return this.el.nameInput.value.trim().slice(0, 16) || 'employee';
  }

  // ---- screens ----
  _show(name) {
    for (const s of ['loading', 'menu', 'settings', 'pause', 'death', 'fired']) {
      this.el[s].classList.toggle('hidden', s !== name);
    }
  }
  showLoading(frac, tip) {
    this._show('loading');
    this.el.loadFill.style.width = Math.round(frac * 100) + '%';
    if (tip) this.el.loadTip.textContent = tip;
  }
  showMenu(error = '') {
    this._show('menu');
    this.el.hud.classList.add('hidden');
    this.el.menuError.textContent = error;
    this.el.menuError.classList.toggle('hidden', !error);
    this.refreshContinue();
    this.setBusy(false);
  }
  refreshContinue() {
    const btn = this.el.continueBtn;
    if (!btn) return;
    if (hasSave()) {
      btn.classList.remove('hidden');
      btn.textContent = `CONTINUE — ${saveLabel()}`;
    } else {
      btn.classList.add('hidden');
    }
  }
  showGame(roomCode) {
    this._show('none');
    this.el.hud.classList.remove('hidden');
    this.el.roomCode.textContent = roomCode;
  }
  showPause() { this._show('pause'); }
  hideOverlays() { this._show('none'); }
  showDeath(byKind) {
    this._show('death');
    const subs = {
      crawler: 'something fast found you in the dark.',
      stalker: 'you never saw it. that was the problem.',
      hound: 'it heard you running.',
      takeoff: 'the ship left without you.',
    };
    this.el.deathSub.textContent = (subs[byKind] || 'your body remains company property.') + ' reviving in orbit…';
  }
  showFired(stats) {
    this._show('fired');
    this.el.firedStats.textContent = stats || '';
  }
  setBusy(b) {
    this.el.hostBtn.disabled = b;
    this.el.joinBtn.disabled = b;
    if (this.el.continueBtn) this.el.continueBtn.disabled = b;
    if (b) this.el.menuError.classList.add('hidden');
  }

  // ---- HUD ----
  setPlayers(n) { this.el.playersChip.textContent = n + ' employed'; }
  setStamina(frac) {
    this.el.staminaWrap.classList.toggle('visible', frac < 0.999);
    this.el.staminaFill.style.width = (frac * 100) + '%';
    this.el.staminaFill.classList.toggle('low', frac < 0.3);
  }
  setStatus({ day, daysLeft, quota, sold, money, clock, landed }) {
    this.el.hudDay.textContent = 'DAY ' + day;
    this.el.hudQuota.textContent = `$${sold} / $${quota} · ${daysLeft}d`;
    this.el.hudMoney.textContent = '$' + money;
    if (landed && clock !== null) {
      this.el.hudClock.classList.remove('hidden');
      const h = Math.floor(clock), m = Math.floor((clock - h) * 60);
      this.el.hudClock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      this.el.hudClock.classList.toggle('late', clock >= 21);
    } else {
      this.el.hudClock.classList.add('hidden');
    }
  }
  setShipValue(v) {
    this.el.shipChip.classList.toggle('hidden', v <= 0);
    this.el.shipChip.textContent = 'ship: $' + v;
  }
  setInventory(slots) {
    for (let i = 0; i < 2; i++) {
      const el = document.getElementById('inv-' + i);
      const it = slots[i];
      el.classList.toggle('filled', !!it);
      el.textContent = it ? `${it.type.name} $${it.value}` : '';
    }
  }
  setInteractHint(text) {
    const el = this.el.interactHint;
    el.classList.toggle('hidden', !text);
    if (text) el.innerHTML = text;
  }
  setHint(text) {
    this.el.hint.textContent = text || '';
    this.el.hint.style.opacity = text ? 1 : 0;
  }
  setFlashlight(on) {
    this.el.flashlightIndicator.classList.toggle('hidden', !on);
  }

  // ---- chat ----
  get chatOpen() { return !this.el.chatInputWrap.classList.contains('hidden'); }
  openChat() {
    this.el.chatInputWrap.classList.remove('hidden');
    this.el.chatInput.value = '';
    this.el.chatInput.focus();
  }
  closeChat() {
    this.el.chatInputWrap.classList.add('hidden');
    this.el.chatInput.blur();
    this.el.canvas.focus?.();
  }
  addChat(name, text, { system = false, proximity = 1 } = {}) {
    const div = document.createElement('div');
    div.className = 'chat-line' + (system ? ' system' : '');
    if (system) div.textContent = text;
    else {
      const b = document.createElement('b');
      b.textContent = name + ': ';
      div.append(b, document.createTextNode(text));
    }
    div.style.opacity = String(0.35 + 0.65 * proximity);
    this.el.chatLog.appendChild(div);
    while (this.el.chatLog.children.length > 8) this.el.chatLog.firstChild.remove();
    const ttl = system ? 6000 : 11000;
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 1300); }, ttl);
  }

  toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.el.toasts.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity 0.6s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 700); }, 2600);
  }

  scareFlash() {
    const overlay = this.el.scareOverlay;
    if (overlay) {
      overlay.classList.remove('active');
      void overlay.offsetWidth;
      overlay.classList.add('active');
    }
  }
}
