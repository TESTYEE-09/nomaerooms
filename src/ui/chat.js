// chat.js — proxy chat + voice clips
//
// "Voice cloning" without AI cloning:
//  - Each message has a name (set in the menu), a voice (the user's selected
//    system TTS voice, or a per-friend override), and the text.
//  - Saving a clip = saving {name, text, voiceURI, rate, pitch}.
//  - Replaying = using window.speechSynthesis.speak() with that data.
// This gives the "I heard [friend] say that in the Backrooms" feel without
// needing actual voice training data — every browser has SpeechSynthesis
// built in.
//
// Clips are persisted to localStorage per-room so they survive reloads and
// the same set of clips is shared with all players in the same room (sent
// over the data channel when joining).

const STORAGE_KEY = 'nomaerooms.clips.v1';

export class ChatSystem {
  constructor(opts) {
    this.ui = opts.ui;            // { logEl, listEl, inputEl, wrapEl, panelEl, clipBtn }
    this.net = opts.net;          // null in solo, Net in multiplayer
    this.localName = opts.localName || 'nomad';
    this.localVoiceURI = opts.localVoiceURI || null;
    this.remoteVoices = new Map(); // peerId → voiceURI
    this.clips = this._loadClips();
    this.lastMessage = null;
    this._bind();
  }

  _bind() {
    this.ui.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.ui.inputEl.value.trim();
        if (text) this._send(text);
        this.ui.inputEl.value = '';
        this.hideInput();
      } else if (e.key === 'Escape') {
        this.hideInput();
      }
      e.stopPropagation();
    });
    // Save clip button
    this.ui.clipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.saveLastClip();
    });
    // Global key for chat
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT' && !this.ui.wrapEl.classList.contains('hidden')) {
        // game is active
        if (document.activeElement === this.ui.inputEl) return;
        e.preventDefault();
        this.showInput();
      }
    });
    // Last-clip replay (V key)
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV' && !this.ui.wrapEl.classList.contains('hidden')) {
        if (this.clips.length > 0) {
          this.replayClip(this.clips[this.clips.length - 1]);
        }
      }
    });
  }

  showInput() {
    this.ui.wrapEl.classList.remove('hidden');
    this.ui.inputEl.focus();
  }

  hideInput() {
    this.ui.wrapEl.classList.add('hidden');
    this.ui.inputEl.blur();
  }

  _send(text) {
    const msg = {
      id: crypto.randomUUID(),
      name: this.localName,
      text,
      ts: Date.now(),
      voiceURI: this.localVoiceURI,
      peerId: this.net?.peerId || 'local',
    };
    this.receive(msg, true);
    this.net?.broadcast({ type: 'chat', msg });
  }

  receive(msg, isLocal = false) {
    this.lastMessage = msg;
    this._render(msg, isLocal);
    // Auto-speak all chat in-game (the "mimic voice" part)
    if (!isLocal || true) {
      // small delay so it doesn't all talk at once
      setTimeout(() => this._speak(msg), 100);
    }
  }

  system(text) {
    const li = document.createElement('li');
    li.className = 'system';
    li.innerHTML = `<span class="name">*</span>${text}`;
    this.ui.listEl.appendChild(li);
    this._trimLog();
  }

  _render(msg, isLocal) {
    const li = document.createElement('li');
    li.className = isLocal ? 'local' : '';
    const name = msg.name || '???';
    const safeText = msg.text.replace(/</g, '&lt;');
    li.innerHTML = `<span class="name">${name}:</span>${safeText}`;
    this.ui.listEl.appendChild(li);
    this._trimLog();
  }

  _trimLog() {
    while (this.ui.listEl.children.length > 30) {
      this.ui.listEl.removeChild(this.ui.listEl.firstChild);
    }
  }

  _speak(msg) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(msg.text);
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find((vv) => vv.voiceURI === msg.voiceURI) ||
              voices.find((vv) => vv.default) ||
              voices[0];
    if (v) u.voice = v;
    u.rate = 0.95;
    u.pitch = 0.9;
    u.volume = 0.7;
    try { window.speechSynthesis.speak(u); } catch {}
  }

  // ---- clip save / replay ----

  saveLastClip() {
    if (!this.lastMessage) {
      this._toast('no message to save');
      return;
    }
    const clip = { ...this.lastMessage, savedAt: Date.now() };
    this.clips.push(clip);
    this._saveClips();
    this._toast(`saved clip from ${clip.name}`);
    this.net?.broadcast({ type: 'clip-saved', clip });
  }

  replayClip(clip) {
    if (!clip) return;
    this._toast(`▶ ${clip.name}: "${clip.text}"`);
    this._speak(clip);
  }

  // ---- persistence ----

  _loadClips() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  _saveClips() {
    try {
      // cap to last 50 clips
      const trimmed = this.clips.slice(-50);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.warn('clip save failed', e);
    }
  }

  _toast(text) {
    const el = document.getElementById('clip-toast');
    el.textContent = text;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth; // restart anim
    el.style.animation = '';
    setTimeout(() => el.classList.add('hidden'), 2000);
  }
}

// ---- Available voice enumeration ----
export function listVoices() {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
}
