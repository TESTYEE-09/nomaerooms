// NomaeROOMS network — WebSocket client to a relay server.
//
// The game used to do P2P over PeerJS with a star topology (host as
// rendezvous point + direct WebRTC to each guest). That kept failing on
// networks with restricted NAT: the PeerJS Cloud broker would lose track
// of hosts, and even when both sides "found" each other, WebRTC ICE
// couldn't punch a hole and the data channel just closed.
//
// The new architecture: every client opens a single outbound wss:// to a
// public relay (Render WebSocket service, see the nomaerooms-relay repo).
// The relay sits in the middle and forwards JSON messages. No P2P, no
// TURN, no NAT traversal. Both host and guest just need a working HTTPS
// egress to the relay (port 443, which almost every network allows).
//
// Wire protocol (text frames over a single WebSocket, JSON):
//   client→relay  {t:"host", code, seed, profile}        register as host of room
//   client→relay  {t:"join", code, profile}              register as guest
//   client→relay  {t:"leave"}                            leave current room
//   client→relay  {t:"relay", to?, m:"st"|"chat"|..., ...payload}
//                  forward a game message (m is the game type; everything
//                  else in the message is game data). Omit `to` to broadcast
//                  to the opposite role.
//   relay→client  {t:"wel", id, code, seed?, host?, peers}   host or guest welcome
//   relay→client  {t:"join", id, name, color}            someone joined
//   relay→client  {t:"leave", id}                        someone left
//   relay→client  {t:"peer", from, m, ...payload}        forwarded game message
//   relay→client  {t:"err", msg}                         error
//
// The on-disk game protocol is unchanged: messages from the host (other
// than the wel) are wrapped as {t:"peer", from:<hostId>, m:"st", ...etc};
// we unwrap them here so the rest of the game code (onState, onChat,
// onClark, onScared) keeps working without modification.
//
// Why `m` for the inner game type: the relay strips the client's `t` (it
// was the "relay" command, meaningless to recipients) and adds its own
// `t:"peer"`. If we reused `t` for the inner game type, the relay's
// `t:"peer"` wrapper would clobber it. `m` sidesteps that cleanly.

const RELAY_URL = (import.meta.env?.VITE_RELAY_URL) || 'wss://nomaerooms-relay.onrender.com';
// 9 seconds end-to-end: 3s TCP/WS connect + 3s registration + 3s peer message roundtrip
const CONNECT_TIMEOUT_MS = 9000;

export class Net {
  constructor() {
    this.ws = null;
    this.isHost = false;
    this.code = null;
    this.myId = null;
    this.conns = new Map();      // host: guestId -> (set membership flag, we don't track per-conn)
    this.hostConn = null;        // guest: "the relay conn" (we just keep a flag for compat)
    this.peersInfo = new Map();  // id -> {name, color}
    this.seed = 0;
    this.hostProfile = null;     // host: stored from host(); guest: from wel

    // callbacks (wired by main)
    this.onPeerJoin = null;
    this.onPeerLeave = null;
    this.onState = null;
    this.onChat = null;
    this.onClark = null;
    this.onScareRequest = null;
    this.onScared = null;
    this.onClarkAI = null;
    this.onClosed = null;
    this.onHuntedState = null;
    this.onSwapRequest = null;
    this.onSwapResult = null;
    this.onHuntedWin = null;
    this.onWeaponStun = null;
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

      if (msg.t === 'wel')      this._onWel(msg);
      else if (msg.t === 'join')  this._onJoin(msg);
      else if (msg.t === 'leave') this._onLeave(msg);
      else if (msg.t === 'peer')  this._onPeer(msg);
      else if (msg.t === 'err') {
        console.warn('[net] relay error:', msg.msg);
        if (this._pendingWel) {
          const { reject } = this._pendingWel;
          this._pendingWel = null;
          reject({ type: 'relay-err', message: msg.msg });
        }
        this._onRelayErr?.(msg.msg);
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

  // The host's first response: {t:"wel", id, code}. We use this to learn our id.
  // The guest's first response: {t:"wel", id, code, seed, host, peers}. Resolve
  // the join() promise with this; main.js expects a {seed, host, peers} object.
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
      const { resolve, reject } = this._pendingWel;
      this._pendingWel = null;
      // Shape the wel so main.js can use it like the old PeerJS wel.
      // main.js reads wel.seed, and iterates net.peersInfo — both work.
      resolve({ seed: this.seed, id: this.myId, host: this.hostProfile, peers: [...this.peersInfo] });
    }
  }

  _onJoin(msg) {
    this.peersInfo.set(msg.id, { name: msg.name, color: msg.color });
    this.conns.set(msg.id, true);  // host: track presence
    this.onPeerJoin?.(msg.id, { name: msg.name, color: msg.color });
  }

  _onLeave(msg) {
    if (!this.conns.has(msg.id) && !this.peersInfo.has(msg.id)) return;
    this.conns.delete(msg.id);
    this.peersInfo.delete(msg.id);
    this.onPeerLeave?.(msg.id);
  }

  // A forwarded game message. Unwrap and dispatch like the old _guestRoute /
  // _hostRoute used to do.
  _onPeer(msg) {
    const { from, t: _wrap, m, ...rest } = msg;
    // Dispatch on inner game message type so the game logic is identical to before.
    switch (m) {
      case 'st':
        this.onState?.(from, { id: from, ...rest });
        break;
      case 'chat':
        this.onChat?.(from, rest.text);
        break;
      case 'ck':
        this.onClark?.(rest);
        break;
      case 'scare':
        // host: a guest got got
        this.onScareRequest?.(from);
        break;
      case 'scared':
        this.onScared?.(rest.id);
        break;
      case 'ai':
        this.onClarkAI?.(rest.text);
        break;
      case 'hunted':
        // {huntedId, timer, swapReady, swapCooldown}
        this.onHuntedState?.(rest);
        break;
      case 'swap':
        // guest -> host: request swap; host -> all: {from, to, huntedPos}
        this.onSwapRequest?.(from);
        break;
      case 'swapResult':
        // host broadcasts swap result: {fromX, fromZ, toX, toZ, swapId}
        this.onSwapResult?.(rest);
        break;
      case 'huntedWin':
        this.onHuntedWin?.();
        break;
      case 'wp':
        // guest used a weapon - host processes stun
        this.onWeaponStun?.(from);
        break;
      // 'hi' / 'join' / 'leave' / 'wel' are control messages handled by the
      // relay directly, never forwarded. 'relay' is the client→relay form,
      // also not forwarded. Anything else is ignored.
    }
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
    await welP;
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

  // Try to join the global room; if it doesn't exist, host it.
  async play(code, profile, seed) {
    try {
      console.log('[net] play: trying join');
      return await this.join(code, profile);
    } catch (e) {
      console.log('[net] play: join failed, trying host:', e);
      if (this.ws) { try { this.ws.close(); } catch { /* */ } this.ws = null; }
      this.conns.clear(); this.peersInfo.clear(); this._pendingWel = null;
      await this.host(code, profile, seed);
      console.log('[net] play: host succeeded');
      return { seed, id: this.myId, host: this.hostProfile };
    }
  }

  // ---- game-facing API (same surface as before) ----

  sendState(st) {
    if (!this.ws) return;
    this._send({ t: 'relay', m: 'st', ...st });
  }

  sendChat(text) {
    if (!this.ws) return;
    this._send({ t: 'relay', m: 'chat', text: String(text || '').slice(0, 200) });
  }

  sendClark(state) {
    if (!this.isHost || !this.ws) return;
    this._send({ t: 'relay', m: 'ck', ...state });
  }

  sendHunted(state) {
    if (!this.isHost || !this.ws) return;
    this._send({ t: 'relay', m: 'hunted', ...state });
  }

  sendSwapRequest() {
    if (!this.ws) return;
    this._send({ t: 'relay', m: 'swap' });
  }

  /** Host confirms swap was applied */
  sendSwapResult(result) {
    if (!this.isHost || !this.ws) return;
    this._send({ t: 'relay', m: 'swapResult', ...result });
  }

  sendHuntedWin() {
    if (!this.isHost || !this.ws) return;
    this._send({ t: 'relay', m: 'huntedWin' });
  }

  sendScared(id) {
    if (!this.isHost || !this.ws) return;
    this._send({ t: 'relay', m: 'scared', id });
  }

  requestScare() {
    if (this.isHost || !this.ws) return;
    this._send({ t: 'relay', m: 'scare' });
  }

  sendClarkAI(text) {
    if (!this.isHost || !this.ws) return;
    this._send({ t: 'relay', m: 'ai', text: String(text || '').slice(0, 300) });
  }

  sendWeaponStun() {
    if (this.isHost || !this.ws) return;
    this._send({ t: 'relay', m: 'wp' });
  }

  playerCount() {
    // 1 (self) + however many peers we've heard of. For the host this is
    // conns.size (guests). For a guest this is peersInfo.size (host + other
    // guests, with 'host' counted once).
    if (this.isHost) return 1 + this.conns.size;
    return 1 + this.peersInfo.size;
  }

  destroy() {
    try { this._send({ t: 'leave' }); } catch { /* */ }
    try { this.ws?.close(); } catch { /* */ }
    this.ws = null;
    this.conns.clear();
    this.peersInfo.clear();
    this.hostConn = null;
    this._pendingWel = null;
  }

  _friendlyErr(e) {
    switch (e?.type) {
      case 'peer-unavailable': return 'Room not found. Check the code.';
      case 'unavailable-id': return 'That room code is already hosted. Try again.';
      case 'network': case 'server-error': case 'socket-error':
        return 'Could not reach the relay server. Check your connection.';
      case 'timeout': return 'Connection timed out. Check the code and try again.';
      default: return 'Connection failed (' + (e?.type || 'unknown') + ').';
    }
  }
}
