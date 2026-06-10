// P2P networking over PeerJS (WebRTC, public broker, no backend).
//
// Star topology: the host's peer id encodes the room code; guests connect to
// it and the host relays. The host also owns the world seed and Clark.
//
// Wire messages (JSON over DataConnection):
//   guest→host  hi    {name, color}
//   host→guest  wel   {id, seed, peers:[{id,name,color}], host:{name,color}}
//   both        st    {id?, p:[x,y? no — x,z], ry, pi, mv, sp}   (position state)
//   both        chat  {id?, text}
//   host→all    join  {id, name, color} / leave {id}
//   host→all    ck    {...clark}  /  scared {id}
//   guest→host  scare {}

import Peer from 'peerjs';

const PREFIX = 'nmr2-';

// Signaling servers, tried in order. Host settles on the first that works;
// guests probe each one looking for the room. All speak the PeerJS protocol
// over wss on 443, which is the most likely thing to survive a school filter.
const SERVERS = [
  { name: 'peerjs-cloud', opts: {} }, // official 0.peerjs.com
  { name: '92k-relay', opts: { host: 'peerjs.92k.de', port: 443, secure: true } },
];

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.code = null;
    this.myId = null;
    this.conns = new Map();      // host: guestId -> conn
    this.hostConn = null;        // guest: conn to host
    this.peersInfo = new Map();  // id -> {name, color}
    this.seed = 0;

    // callbacks (wired by main)
    this.onPeerJoin = null;      // (id, info)
    this.onPeerLeave = null;     // (id)
    this.onState = null;         // (id, msg)
    this.onChat = null;          // (id, text)
    this.onClark = null;         // (msg)
    this.onScareRequest = null;  // host only: (id)
    this.onScared = null;        // (id) someone got got
    this.onClosed = null;        // (reason) — we lost the session
  }

  _newPeer(id, serverOpts) {
    // School/corporate networks often block UDP and non-443 traffic, which
    // kills plain STUN. Free TURN relays (Open Relay) over TCP/443 give the
    // connection a fallback path through almost any firewall.
    return new Peer(id, {
      debug: 1,
      ...serverOpts,
      config: {
        iceServers: [
          { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
          { urls: 'stun:openrelay.metered.ca:80' },
          {
            urls: [
              'turn:openrelay.metered.ca:80',
              'turn:openrelay.metered.ca:443',
              'turn:openrelay.metered.ca:443?transport=tcp',
              'turns:openrelay.metered.ca:443',
            ],
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
        ],
        iceCandidatePoolSize: 4,
      },
    });
  }

  // Open a Peer on one signaling server; resolve once registered, reject on
  // error or timeout (destroying the peer). Both sides must end up on the
  // SAME server to find each other, so guests probe the list in order.
  _openPeer(id, serverOpts, timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
      const peer = this._newPeer(id, serverOpts);
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; try { peer.destroy(); } catch { /* */ } reject({ type: 'timeout' }); }
      }, timeoutMs);
      peer.on('error', (e) => {
        if (!done) { done = true; clearTimeout(timer); try { peer.destroy(); } catch { /* */ } reject(e); }
      });
      peer.on('open', () => {
        if (!done) { done = true; clearTimeout(timer); resolve(peer); }
      });
    });
  }

  async host(code, profile, seed) {
    this.isHost = true;
    this.code = code;
    this.seed = seed;
    let lastErr = { type: 'network' };
    for (const srv of SERVERS) {
      try {
        const peer = await this._openPeer(PREFIX + code, srv.opts);
        this.peer = peer;
        this.myId = peer.id;
        this.serverName = srv.name;
        peer.on('error', (e) => console.warn('[net]', e.type, e.message));
        peer.on('connection', (conn) => this._hostAccept(conn, profile));
        console.log('[net] hosting via', srv.name);
        return;
      } catch (e) {
        console.warn('[net] host failed on', srv.name, e?.type);
        lastErr = e;
      }
    }
    throw new Error(this._friendlyErr(lastErr));
  }

  _hostAccept(conn, profile) {
    conn.on('data', (msg) => {
      if (msg?.t === 'hi') {
        const info = { name: String(msg.name || 'lost one').slice(0, 16), color: msg.color };
        this.conns.set(conn.peer, conn);
        this.peersInfo.set(conn.peer, info);
        const peers = [...this.peersInfo].map(([id, p]) => ({ id, ...p }));
        conn.send({ t: 'wel', id: conn.peer, seed: this.seed, peers, host: profile });
        this._broadcast({ t: 'join', id: conn.peer, ...info }, conn.peer);
        this.onPeerJoin?.(conn.peer, info);
      } else {
        this._hostRoute(conn.peer, msg);
      }
    });
    const drop = () => {
      if (!this.conns.has(conn.peer)) return;
      this.conns.delete(conn.peer);
      this.peersInfo.delete(conn.peer);
      this._broadcast({ t: 'leave', id: conn.peer });
      this.onPeerLeave?.(conn.peer);
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  _hostRoute(fromId, msg) {
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'st':
        msg.id = fromId;
        this._broadcast(msg, fromId);
        this.onState?.(fromId, msg);
        break;
      case 'chat': {
        const text = String(msg.text || '').slice(0, 200);
        this._broadcast({ t: 'chat', id: fromId, text }, fromId);
        this.onChat?.(fromId, text);
        break;
      }
      case 'scare':
        this.onScareRequest?.(fromId);
        break;
    }
  }

  async join(code, profile) {
    this.isHost = false;
    this.code = code;
    let lastErr = { type: 'peer-unavailable' };
    for (const srv of SERVERS) {
      let peer = null;
      try {
        peer = await this._openPeer(undefined, srv.opts);
        const wel = await this._joinVia(peer, code, profile, 9000);
        this.peer = peer;
        this.serverName = srv.name;
        console.log('[net] joined via', srv.name);
        return wel;
      } catch (e) {
        console.warn('[net] join failed on', srv.name, e?.type);
        lastErr = e;
        try { peer?.destroy(); } catch { /* */ }
        this.hostConn = null;
      }
    }
    throw new Error(this._friendlyErr(lastErr));
  }

  _joinVia(peer, code, profile, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (e) => { if (!settled) { settled = true; reject(e); } };
      const timer = setTimeout(() => fail({ type: 'timeout' }), timeoutMs);
      peer.on('error', fail);
      const conn = peer.connect(PREFIX + code, { reliable: true });
      this.hostConn = conn;
      conn.on('open', () => conn.send({ t: 'hi', ...profile }));
      conn.on('data', (msg) => {
        if (msg?.t === 'wel' && !settled) {
          settled = true;
          clearTimeout(timer);
          this.myId = msg.id;
          this.seed = msg.seed;
          for (const p of msg.peers) if (p.id !== msg.id) this.peersInfo.set(p.id, p);
          this.peersInfo.set('host', msg.host);
          peer.off('error', fail);
          peer.on('error', (e) => console.warn('[net]', e.type, e.message));
          resolve(msg);
        } else if (settled) {
          this._guestRoute(msg);
        }
      });
      const closed = () => {
        if (settled) this.onClosed?.('Lost connection to the host.');
        else fail({ type: 'closed' });
      };
      conn.on('close', closed);
      conn.on('error', closed);
    });
  }

  _guestRoute(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'st': this.onState?.(msg.id, msg); break;
      case 'chat': this.onChat?.(msg.id, msg.text); break;
      case 'join':
        this.peersInfo.set(msg.id, { name: msg.name, color: msg.color });
        this.onPeerJoin?.(msg.id, { name: msg.name, color: msg.color });
        break;
      case 'leave':
        this.peersInfo.delete(msg.id);
        this.onPeerLeave?.(msg.id);
        break;
      case 'ck': this.onClark?.(msg); break;
      case 'scared': this.onScared?.(msg.id); break;
    }
  }

  _friendlyErr(e) {
    switch (e?.type) {
      case 'peer-unavailable': return 'Room not found. Check the code.';
      case 'unavailable-id': return 'That room code is already hosted. Try again.';
      case 'network': case 'server-error': case 'socket-error':
        return 'Could not reach the matchmaking server. Check your connection.';
      case 'timeout': return 'Connection timed out. Check the code and try again.';
      default: return 'Connection failed (' + (e?.type || 'unknown') + ').';
    }
  }

  _broadcast(msg, exceptId = null) {
    for (const [id, c] of this.conns) {
      if (id !== exceptId && c.open) {
        try { c.send(msg); } catch { /* dropped */ }
      }
    }
  }

  // ---- game-facing API ----

  sendState(st) {
    if (this.isHost) this._broadcast({ t: 'st', id: 'host', ...st });
    else if (this.hostConn?.open) this.hostConn.send({ t: 'st', ...st });
  }

  sendChat(text) {
    if (this.isHost) this._broadcast({ t: 'chat', id: 'host', text });
    else if (this.hostConn?.open) this.hostConn.send({ t: 'chat', text });
  }

  sendClark(state) {
    if (this.isHost) this._broadcast({ t: 'ck', ...state });
  }

  sendScared(id) {
    if (this.isHost) this._broadcast({ t: 'scared', id });
  }

  requestScare() {
    if (!this.isHost && this.hostConn?.open) this.hostConn.send({ t: 'scare' });
  }

  playerCount() {
    return 1 + (this.isHost ? this.conns.size : this.peersInfo.size);
  }

  destroy() {
    try { this.peer?.destroy(); } catch { /* already gone */ }
    this.peer = null;
    this.conns.clear();
    this.peersInfo.clear();
    this.hostConn = null;
  }
}
