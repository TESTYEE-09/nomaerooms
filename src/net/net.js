// net.js — multiplayer (PeerJS)
//
// Star topology: first player to "Host Room" becomes host. Others "Join Room"
// with the host's room code. We use PeerJS with the public broker as a default
// but allow the user to paste a custom broker URL.
//
// What flows over the data channel:
//   - chat messages (broadcast)
//   - position updates (host broadcasts, clients send to host)
//   - clip-saved notifications (broadcast)
//   - clip-share on join (host sends full clip list to each new client)
//
// Why a custom server is not required: PeerJS broker is just for signaling.
// Once WebRTC is up, all traffic is P2P. No game server to host.

import Peer from 'peerjs';

const SIGNAL_SERVERS = [
  // PeerJS public broker — path is /peerjs, NOT /
  { host: '0.peerjs.com', port: 443, path: '/peerjs', secure: true, name: 'PeerJS public' },
  // Add your own broker here as fallback:
  // { host: 'nomaerooms-signalserver.onrender.com', port: 443, path: '/', secure: true, name: 'My Broker' },
];

export class Net {
  constructor(opts) {
    this.peer = null;
    this.role = null;        // 'host' | 'client' | 'solo'
    this.roomCode = null;
    this.peerId = null;
    this.connections = new Map(); // peerId → DataConnection
    this.onChat = opts.onChat || (() => {});
    this.onPeerJoin = opts.onPeerJoin || (() => {});
    this.onPeerLeave = opts.onPeerLeave || (() => {});
    this.onPosition = opts.onPosition || (() => {});
    this.onClipSaved = opts.onClipSaved || (() => {});
    this.onSyncClips = opts.onSyncClips || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.localPos = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.remotePlayers = new Map(); // peerId → {name, pos, lastSeen}
  }

  _makeId() {
    // 6-char room code (uppercase, no ambiguous chars)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  async _tryServers() {
    let lastErr;
    for (const s of SIGNAL_SERVERS) {
      this.onStatus(`Trying ${s.name}…`);
      try {
        const p = new Peer({
          host: s.host, port: s.port, path: s.path, secure: s.secure,
          debug: 0,
        });
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout')), 15000);
          p.once('open', () => { clearTimeout(t); resolve(); });
          p.once('error', (e) => { clearTimeout(t); reject(e); });
        });
        this.peer = p;
        this.onStatus(`Connected via ${s.name}`);
        return true;
      } catch (e) {
        console.warn('[net] server failed', s.name, e?.type || e?.message);
        lastErr = e;
        continue;
      }
    }
    throw lastErr || new Error('no signal server');
  }

  async host() {
    if (this.peer) this.peer.destroy();
    await this._tryServers();
    this.role = 'host';
    this.roomCode = this._makeId();
    this.peerId = `nomaerooms-${this.roomCode}`;
    // We need to register a peer ID matching our room code so clients can find us.
    // The Peer() instance is currently using a default random ID. We can re-create
    // it with our chosen ID.
    this.peer.destroy();
    this.peer = new Peer(this.peerId, {
      host: SIGNAL_SERVERS[0].host,
      port: SIGNAL_SERVERS[0].port,
      path: SIGNAL_SERVERS[0].path,
      secure: SIGNAL_SERVERS[0].secure,
      debug: 0,
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('host id registration timeout')), 15000);
      this.peer.once('open', () => { clearTimeout(t); resolve(); });
      this.peer.once('error', (e) => { clearTimeout(t); reject(e); });
    });
    this.peer.on('connection', (conn) => this._acceptConnection(conn));
    this.peer.on('error', (e) => this.onStatus(`[net error] ${e.type || e.message}`));
    return this.roomCode;
  }

  async join(roomCode) {
    if (this.peer) this.peer.destroy();
    await this._tryServers();
    this.role = 'client';
    this.roomCode = roomCode.toUpperCase();
    const hostId = `nomaerooms-${this.roomCode}`;
    this.onStatus(`Joining ${this.roomCode}…`);
    const conn = this.peer.connect(hostId, { reliable: true });
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('host-not-here')), 15000);
      conn.once('open', () => {
        clearTimeout(t);
        this.connections.set(conn.peer, conn);
        this._wireConnection(conn);
        this.peerId = this.peer.id;
        resolve();
      });
      conn.once('error', (e) => { clearTimeout(t); reject(e); });
    });
  }

  _acceptConnection(conn) {
    conn.once('open', () => {
      this.connections.set(conn.peer, conn);
      this._wireConnection(conn);
      this.onPeerJoin(conn.peer);
    });
  }

  _wireConnection(conn) {
    conn.on('data', (data) => this._onData(conn.peer, data));
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.remotePlayers.delete(conn.peer);
      this.onPeerLeave(conn.peer);
    });
    conn.on('error', (e) => console.warn('[net] conn error', e));
  }

  _onData(peerId, data) {
    if (!data || typeof data !== 'object') return;
    switch (data.type) {
      case 'hello': {
        this.onPeerJoin(peerId, data.name);
        break;
      }
      case 'chat': {
        this.onChat(data.msg);
        // host re-broadcasts to all other clients
        if (this.role === 'host') this.broadcast({ type: 'chat', msg: data.msg }, peerId);
        break;
      }
      case 'pos': {
        this.onPosition(peerId, data.pos, data.name);
        if (this.role === 'host') this.broadcast({ type: 'pos', peerId, pos: data.pos, name: data.name }, peerId);
        break;
      }
      case 'clip-saved': {
        this.onClipSaved(data.clip);
        if (this.role === 'host') this.broadcast({ type: 'clip-saved', clip: data.clip }, peerId);
        break;
      }
      case 'sync-clips': {
        this.onSyncClips(data.clips);
        break;
      }
      case 'request-clips': {
        // host only
        if (this.role === 'host') {
          this._sendTo(peerId, { type: 'sync-clips', clips: data.clips || [] });
        }
        break;
      }
    }
  }

  _sendTo(peerId, msg) {
    const c = this.connections.get(peerId);
    if (c && c.open) c.send(msg);
  }

  broadcast(msg, exceptPeerId = null) {
    for (const [pid, c] of this.connections) {
      if (c.open && pid !== exceptPeerId) c.send(msg);
    }
  }

  sendChat(msg) { this.broadcast({ type: 'chat', msg }); }
  sendPos(pos, name) { this.broadcast({ type: 'pos', pos, name }); }
  sendClipSaved(clip) { this.broadcast({ type: 'clip-saved', clip }); }

  setLocalPos(p) { this.localPos = p; }

  leave() {
    if (this.peer) this.peer.destroy();
    this.peer = null;
    this.connections.clear();
    this.remotePlayers.clear();
    this.role = null;
  }
}
