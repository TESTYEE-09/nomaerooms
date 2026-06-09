// chat.js — plain text chat for the Backrooms
//
// Messages are typed locally (press T), shown in the in-game log, and broadcast
// to everyone in the room over the PeerJS data channel. No text-to-speech, no
// "voice clips", no AI — just talking to your friends while you get lost.

export class ChatSystem {
  constructor(opts) {
    this.ui = opts.ui;            // { listEl, inputEl, wrapEl }
    this.net = opts.net;          // null in solo, Net in multiplayer
    this.localName = opts.localName || 'nomad';
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
    // Press T to start typing
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT' && !this.ui.wrapEl.classList.contains('hidden')) {
        if (document.activeElement === this.ui.inputEl) return;
        e.preventDefault();
        this.showInput();
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
      peerId: this.net?.peerId || 'local',
    };
    this.receive(msg, true);
    this.net?.broadcast({ type: 'chat', msg });
  }

  receive(msg, isLocal = false) {
    this._render(msg, isLocal);
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
    const name = (msg.name || '???').replace(/</g, '&lt;');
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
}
