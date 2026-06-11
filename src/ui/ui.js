// DOM glue: screens, HUD, chat overlay, toasts. Game logic stays in main.js;
// this module only shows/hides and forwards events.

import './styles.css';
import { settings, saveSettings } from '../core/settings.js';
import { IS_TOUCH } from '../core/input.js';

export class UI {
  constructor() {
    // Elements are queried lazily via getters to handle deferred module timing
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
    this.onPlay = null;
    this.onResume = null;
    this.onLeave = null;
    this.onRespawn = null;
    this.onChatSend = null;
    this.onSettingsChanged = null;
    this.onAnyClick = null; // for audio unlock / music

    this._settingsReturnTo = 'menu';
    this._wire();
  }

  _wire() {
    const e = this.el;
    e.nameInput.value = settings.name;

    document.addEventListener('click', () => this.onAnyClick?.(), { once: false });

    e.hostBtn.addEventListener('click', () => {
      this._captureName();
      this.onPlay?.();
    });

    // settings
    const syncSettingsUI = () => {
      e.setQuality.value = settings.quality;
      e.setFov.value = settings.fov; e.fovVal.textContent = settings.fov;
      e.setSens.value = settings.sensitivity; e.sensVal.textContent = settings.sensitivity.toFixed(2);
      e.setVol.value = settings.volume; e.volVal.textContent = Math.round(settings.volume * 100) + '%';
      e.setMusic.value = settings.musicVolume; e.musicVal.textContent = Math.round(settings.musicVolume * 100) + '%';
      e.setMicEnabled.checked = settings.micEnabled;
      e.setMicVol.value = settings.micVolume; e.micVolVal.textContent = Math.round(settings.micVolume * 100) + '%';
      e.setClarkVol.value = settings.clarkVolume; e.clarkVolVal.textContent = Math.round(settings.clarkVolume * 100) + '%';
      e.setMicVol.closest('label').style.opacity = settings.micEnabled ? '1' : '0.4';
      e.setClarkAiEnabled.checked = settings.clarkAIEnabled;
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
      settings.micEnabled = e.setMicEnabled.checked;
      settings.micVolume = +e.setMicVol.value;
      settings.clarkVolume = +e.setClarkVol.value;
      settings.clarkAIEnabled = e.setClarkAiEnabled.checked;
      saveSettings();
      syncSettingsUI();
      this.onSettingsChanged?.();
    };
    for (const el of [e.setQuality, e.setFov, e.setSens, e.setVol, e.setMusic, e.setMicEnabled, e.setMicVol, e.setClarkVol, e.setClarkAiEnabled]) {
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

    e.respawnBtn.addEventListener('click', () => this.onRespawn?.());

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
    }
  }

  _captureName() {
    const n = this.el.nameInput.value.trim().slice(0, 16);
    settings.name = n;
    saveSettings();
  }
  playerName() {
    return this.el.nameInput.value.trim().slice(0, 16) || 'lost one';
  }

  // ---- screens ----
  _show(name) {
    for (const s of ['loading', 'menu', 'settings', 'pause', 'death']) {
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
    this.setBusy(false);
  }
  showGame(roomCode) {
    this._show('none');
    this.el.hud.classList.remove('hidden');
    this.el.roomCode.textContent = roomCode;
  }
  showPause() { this._show('pause'); }
  hideOverlays() { this._show('none'); }
  showDeath() { this._show('death'); }
  setBusy(b) {
    this.el.hostBtn.disabled = b;
    if (this.el.joinBtn) this.el.joinBtn.disabled = b;
    if (b) { this.el.menuError.classList.add('hidden'); }
  }

  // ---- HUD ----
  setPlayers(n) { this.el.playersChip.textContent = n + (n === 1 ? ' lost' : ' lost together'); }
  setStamina(frac) {
    this.el.staminaWrap.classList.toggle('visible', frac < 0.999);
    this.el.staminaFill.style.width = (frac * 100) + '%';
    this.el.staminaFill.classList.toggle('low', frac < 0.3);
  }
  setProximity(nearby) {
    const el = this.el.proximityIndicator;
    if (!el) return;
    if (!nearby.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = nearby.map((n) => `${n.name} nearby`).join(' · ');
  }
  setHint(text) {
    this.el.hint.textContent = text || '';
    this.el.hint.style.opacity = text ? 1 : 0;
  }

  // ---- hunted mode ----
  setHuntedState(state) {
    const hud = this.el.huntedHud;
    if (!hud) return;
    if (!state) { hud.classList.add('hidden'); return; }
    hud.classList.remove('hidden');
    if (state.isHunted) {
      this.el.huntedIcon.textContent = '\u{1F3F9}';
      this.el.huntedLabel.textContent = 'YOU ARE HUNTED';
      this.el.huntedLabel.style.color = '#e04040';
    } else {
      this.el.huntedIcon.textContent = '\u{1F6E1}';
      this.el.huntedLabel.textContent = 'PROTECT THE HUNTED';
      this.el.huntedLabel.style.color = '#40c0e0';
    }
    const m = Math.floor(state.timer / 60);
    const s = Math.floor(state.timer % 60);
    this.el.huntedTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  showSwapHint(show) {
    this.el.swapHint.classList.toggle('hidden', !show);
  }

  setFlashlight(on) {
    const el = this.el.flashlightIndicator;
    if (!el) return;
    el.classList.toggle('hidden', !on);
  }

  showPickupHint(show) {
    const el = this.el.pickupHint;
    if (!el) return;
    el.classList.toggle('hidden', !show);
  }

  setWeapon(on) {
    const el = this.el.weaponIndicator;
    if (!el) return;
    el.classList.toggle('hidden', !on);
  }

  showWeaponHint(show) {
    const el = this.el.weaponHint;
    if (!el) return;
    el.classList.toggle('hidden', !show);
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
  addChat(name, text, { system = false, proximity = 1, ai = false } = {}) {
    const div = document.createElement('div');
    div.className = 'chat-line' + (system ? ' system' : '') + (ai ? ' ai' : '');
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
    this.el.canvas.classList.remove('scare');
    void this.el.canvas.offsetWidth;
    this.el.canvas.classList.add('scare');
    const overlay = this.el.scareOverlay;
    if (overlay) {
      overlay.classList.remove('active');
      void overlay.offsetWidth;
      overlay.classList.add('active');
    }
  }
}
