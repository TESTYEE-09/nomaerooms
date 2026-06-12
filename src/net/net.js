// Network — WebSocket client to the nomaerooms relay (see nomaerooms-relay).
// Every client opens one outbound wss:// to the relay; the relay forwards
// JSON frames between everyone in a room. Host-authoritative game state rides
// on top as {t:"relay", m:<game type>, ...payload} messages.
//
// Wire protocol (text frames over a single WebSocket, JSON):
//   client→relay  {t:"host", code, seed, profile}        register as host of room
//   client→relay  {t:"join", code, profile}              register as guest
//   client→relay  {t:"leave"}                            leave current room
//   client→relay  {t:"relay", to?, m, ...payload}        forward a game message
//   relay→client  {t:"wel", id, code, seed?, host?, peers}
//   relay→client  {t:"join", id, name, color}            someone joined
//   relay→client  {t:"leave", id}                        someone left
//   relay→client  {t:"peer", from, m, ...payload}        forwarded game message
//   relay→client  {t:"err", msg}                         error
//
// Unlike NomaeROOMS this layer is generic: game messages dispatch through
// onMsg(m, from, payload) and are sent with send(m, payload[, to]).

const RELAY_URL = (import.meta.env?.VITE_RELAY_URL) || 'wss://nomaerooms-relay.onrender.com';
const CONNECT_TIMEOUT_MS = 9000;

export class Net {
  constructor() {
    this.ws = null;
    this.isHost = false;
    this.code = null;
    this.myId = null;
    this.conns = new Map();      // host: guestId -> true
    this.peersInfo = new Map();  // id -> {name, color}
    this.seed = 0;
    this.hostProfile = null;
    this.hostId = null;

    // callbacks (wired by main)
    this.onPeerJoin = null;      // (id, info)
    this.onPeerLeave = null;     // (id)
    this.onMsg = null;           // (m, fromId, payload)
    this.onClosed = null;        // (reason)
  }

  // -------- low-level ws helpers --------

  _open(timeoutMs) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(RELAY_URL); }
      catch (e) { return reject({ type: 'network', message: e?.message }); }
      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        try { ws.close(); } catch { /* */ }
        reject({ type: 'timeout' });
      }, timeoutMs);
      ws.onopen = () => { if (done) return; done = true; clearTimeout(t); resolve(ws); };
      ws.onerror = () => { if (done) return; done = true; clearTimeout(t); reject({ type: 'network' }); };
    });
  }

  _send(msg) {
    if (this.ws?.readyState === 1) {
      try { this.ws.send(JSON.stringify(msg)); return true; } catch { /* */ }
    }
    return false;
  }

  _bindWs(ws) {
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;

      if (msg.t === 'wel')        this._onWel(msg);
      else if (msg.t === 'join')  this._onJoin(msg);
      else if (msg.t === 'leave') this._onLeave(msg);
      else if (msg.t === 'peer') {
        const { from, t: _wrap, m, ...rest } = msg;
        this.onMsg?.(m, from, rest);
      } else if (msg.t === 'err') {
        console.warn('[net] relay error:', msg.msg);
        if (this._pendingWel) {
          const { reject } = this._pendingWel;
          this._pendingWel = null;
          reject({ type: 'relay-err', message: msg.msg });
        }
      }
    };
    ws.onclose = () => {
      const wasOpen = this.ws === ws;
      this.ws = null;
      if (wasOpen) this.onClosed?.('Lost connection to the relay.');
    };
    ws.onerror = (e) => console.warn('[net] ws error', e?.message || e);
  }

  // -------- handlers --------

  _onWel(msg) {
    this.myId = msg.id;
    this.code = msg.code;
    if (msg.seed !== undefined) this.seed = msg.seed;
    if (msg.host) {
      this.hostProfile = msg.host;
      const hKey = msg.hostId || 'host';
      this.hostId = hKey;
      this.peersInfo.set(hKey, msg.host);
    }
    if (Array.isArray(msg.peers)) {
      for (const p of msg.peers) {
        if (p.id && p.id !== msg.id) this.peersInfo.set(p.id, p);
      }
    }
    if (this._pendingWel) {
      const { resolve } = this._pendingWel;
      this._pendingWel = null;
      resolve({ seed: this.seed, id: this.myId, host: this.hostProfile, peers: [...this.peersInfo] });
    }
  }

  _onJoin(msg) {
    this.peersInfo.set(msg.id, { name: msg.name, color: msg.color });
    this.conns.set(msg.id, true);
    this.onPeerJoin?.(msg.id, { name: msg.name, color: msg.color });
  }

  _onLeave(msg) {
    if (!this.conns.has(msg.id) && !this.peersInfo.has(msg.id)) return;
    this.conns.delete(msg.id);
    this.peersInfo.delete(msg.id);
    this.onPeerLeave?.(msg.id);
  }

  // -------- public API --------

  async host(code, profile, seed) {
    this.isHost = true;
    this.code = code;
    this.seed = seed;
    this.hostProfile = profile;
    const ws = await this._open(CONNECT_TIMEOUT_MS);
    this.ws = ws;
    this._bindWs(ws);
    const welP = new Promise((resolve, reject) => {
      this._pendingWel = { resolve, reject };
      setTimeout(() => {
        if (this._pendingWel) {
          this._pendingWel = null;
          try { ws.close(); } catch { /* */ }
          this.ws = null;
          reject({ type: 'timeout' });
        }
      }, CONNECT_TIMEOUT_MS);
    });
    this._send({ t: 'host', code, seed, profile });
    return await welP;
  }

  async join(code, profile) {
    this.isHost = false;
    this.code = code;
    const ws = await this._open(CONNECT_TIMEOUT_MS);
    this.ws = ws;
    this._bindWs(ws);
    const welP = new Promise((resolve, reject) => {
      this._pendingWel = { resolve, reject };
      setTimeout(() => {
        if (this._pendingWel) {
          this._pendingWel = null;
          try { ws.close(); } catch { /* */ }
          this.ws = null;
          reject({ type: 'timeout' });
        }
      }, CONNECT_TIMEOUT_MS);
    });
    this._send({ t: 'join', code, profile });
    return await welP;
  }

  /** Send a game message; omit `to` to broadcast to the room. */
  send(m, payload = {}, to = undefined) {
    if (!this.ws) return;
    const msg = { t: 'relay', m, ...payload };
    if (to !== undefined) msg.to = to;
    this._send(msg);
  }

  playerCount() {
    if (this.isHost) return 1 + this.conns.size;
    return 1 + this.peersInfo.size;
  }

  allPeerIds() {
    return this.isHost ? [...this.conns.keys()] : [...this.peersInfo.keys()];
  }

  destroy() {
    try { this._send({ t: 'leave' }); } catch { /* */ }
    try { this.ws?.close(); } catch { /* */ }
    this.ws = null;
    this.conns.clear();
    this.peersInfo.clear();
    this._pendingWel = null;
  }

  friendlyErr(e) {
    switch (e?.type) {
      case 'peer-unavailable': return 'Crew not found. Check the code.';
      case 'unavailable-id': return 'That crew code is already hosted. Try again.';
      case 'relay-err': return e.message || 'Relay refused the connection.';
      case 'network': case 'server-error': case 'socket-error':
        return 'Could not reach the relay server. Check your connection.';
      case 'timeout': return 'Connection timed out. Check the code and try again.';
      default: return 'Connection failed (' + (e?.type || 'unknown') + ').';
    }
  }
}
