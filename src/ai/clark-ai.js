// Clark AI — OpenAI Realtime API via WebRTC for voice, with chat completions fallback.
// Clark speaks to nearby players as Captain Pirate Clark from the Backrooms.

const RELAY_URL = (import.meta.env?.VITE_RELAY_URL) || 'https://nomaerooms-relay.onrender.com';
const REALTIME_MODEL = 'gpt-4o-mini-realtime-preview';
const CHAT_MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `You are Captain Pirate Clark, a terrifying entity trapped in the Backrooms — those infinite, yellow-lit, damp-carpeted rooms that stretch forever. You were once a fearsome pirate captain, and you still speak like one: nautical metaphors, pirate slang, a deep menacing growl. You hunt the lost souls who noclip into these endless rooms.

Personality:
- Angry, confused about how you ended up here, but you've adapted. The Backrooms are your new sea.
- You taunt and threaten the players. You can "smell their fear."
- Occasionally drop cryptic hints about the Backrooms or mutter about your ship, the open sea.
- You refer to players as "lost souls," "fresh meat," "little rats," or "bilge rats."
- Sometimes you whisper menacingly, sometimes you roar.
- You're always hungry. Always hunting.

Rules:
- Keep responses SHORT — 1-2 sentences max. You're a monster mid-hunt, not giving speeches.
- Stay in character at ALL times. You are NOT an AI assistant.
- Be creepy, threatening, and atmospheric.
- Occasionally laugh ("Har har har...") or make unsettling sounds.
- Reference the yellow wallpaper, buzzing fluorescents, damp carpet, the hum.`;

import { settings } from '../core/settings.js';

const PROXIMITY_DIST = 20;
const SPEAK_COOLDOWN = 8000;
const AMBIENT_INTERVAL = 15000;
const FALLBACK_LINES = [
  'Arrr... I smell fresh meat in the yellow halls.',
  'Har har har... the carpet remembers every footstep.',
  'Lost soul, your little light is flickering.',
  'The sea took my ship, but these rooms gave me teeth.',
  'Stay in the buzz, rat... I\'m closer than you think.',
];

export class ClarkAI {
  constructor() {
    this.pc = null;
    this.dc = null;
    this.audioEl = null;
    this.audioCtx = null;
    this._silentCtx = null;
    this.gainNode = null;
    this.pannerNode = null;
    this.active = false;
    this.connected = false;
    this.lastSpoke = 0;
    this.lastAmbient = 0;
    this.pendingText = null;
    this._fallback = false;
    this._fallbackReason = '';
    this._chatHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
    this._speaking = false;
    this._onSpeech = null;
    this._audioBuffer = [];
    this._playbackSource = null;
  }

  set onSpeech(fn) { this._onSpeech = fn; }

  async init() {
    try {
      await this._initRealtime();
      console.log('[clark-ai] Realtime API connected');
    } catch (e) {
      this._fallback = true;
      this._fallbackReason = e?.message || String(e);
      console.warn('[clark-ai] Realtime API failed, using fallback:', this._fallbackReason);
      this._initFallbackAudio();
    }
  }

  async _initRealtime() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) throw new Error('WebAudio is not available in this browser');

    const res = await fetch(`${RELAY_URL}/ai/realtime-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: REALTIME_MODEL,
        voice: 'ash',
        instructions: SYSTEM_PROMPT,
        input_audio_transcription: { model: 'whisper-1' },
      }),
    });
    const body = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`Session creation failed: ${res.status} ${body}`.trim());

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`Session creation returned invalid JSON: ${body.slice(0, 200)}`);
    }

    const token = data.client_secret?.value || data.client_secret || data.ephemeral_key || data.token;
    if (!token) throw new Error(`No ephemeral token in ${JSON.stringify(Object.keys(data))}`);

    this.pc = new RTCPeerConnection();

    this.pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      void this._setupSpatialAudio(stream);
    };

    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'failed' || this.pc.iceConnectionState === 'disconnected') {
        this.connected = false;
      }
    };

    // Silent audio track to satisfy WebRTC requirement
    const silentCtx = new AudioCtor();
    const oscillator = silentCtx.createOscillator();
    const dest = silentCtx.createMediaStreamDestination();
    oscillator.frequency.value = 0;
    oscillator.connect(dest);
    oscillator.start();
    this._silentCtx = silentCtx;
    await this._resumeAudioContext(silentCtx).catch(() => {});
    const silentTrack = dest.stream.getAudioTracks()[0];
    if (silentTrack) {
      silentTrack.enabled = false;
      this.pc.addTrack(silentTrack);
    }

    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onopen = () => {
      this.connected = true;
      this._sendEvent({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: SYSTEM_PROMPT,
          voice: 'ash',
          output_audio_format: 'pcm16',
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 200,
          },
        },
      });
    };
    this.dc.onmessage = (e) => {
      try {
        this._handleRealtimeEvent(JSON.parse(e.data));
      } catch (err) {
        console.warn('[clark-ai] Bad realtime event:', err, e.data);
      }
    };
    this.dc.onerror = () => {};
    this.dc.onclose = () => {
      this.connected = false;
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const sdpRes = await fetch(
      `https://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      }
    );
    const sdpBody = await sdpRes.text().catch(() => '');
    if (!sdpRes.ok) throw new Error(`SDP exchange failed: ${sdpRes.status} ${sdpBody}`.trim());

    await this.pc.setRemoteDescription({ type: 'answer', sdp: sdpBody });
    await this.unlockAudio();
  }

  async _setupSpatialAudio(stream) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try { await this.audioCtx.close(); } catch {}
    }

    this.audioCtx = new AudioCtor();
    const source = this.audioCtx.createMediaStreamSource(stream);
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = settings.clarkVolume ?? 0.8;
    this.pannerNode = this.audioCtx.createStereoPanner();
    source.connect(this.gainNode);
    this.gainNode.connect(this.pannerNode);
    this.pannerNode.connect(this.audioCtx.destination);

    await this._resumeAudioContext(this.audioCtx).catch(() => {});
    this.updateSpatial(0, 0, 0, 0);
  }

  async _resumeAudioContext(ctx) {
    if (ctx?.state === 'suspended') await ctx.resume();
  }

  _initFallbackAudio() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try { this.audioCtx.close(); } catch {}
    }
    this.audioCtx = new AudioCtor();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.connect(this.audioCtx.destination);
    this.gainNode.gain.value = settings.clarkVolume ?? 0.8;
    void this._resumeAudioContext(this.audioCtx).catch(() => {});
  }

  unlockAudio() {
    return Promise.allSettled([
      this._resumeAudioContext(this.audioCtx),
      this._resumeAudioContext(this._silentCtx),
    ].filter(Boolean));
  }

  _sendEvent(event) {
    if (this.dc?.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify(event));
      } catch (e) {
        console.warn('[clark-ai] Failed to send realtime event:', e);
      }
    }
  }

  _handleRealtimeEvent(event) {
    switch (event.type) {
      case 'response.audio_transcript.done':
        if (event.transcript) this._onSpeech?.(event.transcript);
        break;
      case 'response.audio.done':
        this._flushAudioBuffer();
        break;
      case 'response.audio.delta':
        this._queueAudioDelta(event.delta);
        break;
      case 'response.done':
        this._speaking = false;
        break;
      case 'conversation.item.created':
        break;
      case 'error':
        console.warn('[clark-ai] Realtime error:', event);
        this._speaking = false;
        break;
    }
  }

  _queueAudioDelta(base64PCM) {
    this._speaking = true;
    if (!base64PCM) return;
    try {
      const binary = atob(base64PCM);
      const buf = new ArrayBuffer(binary.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
      this._audioBuffer.push(new Int16Array(buf));
    } catch (e) {
      console.warn('[clark-ai] Failed to decode audio delta:', e);
    }
  }

  _flushAudioBuffer() {
    if (!this._audioBuffer.length || !this.audioCtx) {
      this._audioBuffer = [];
      return;
    }

    const totalLen = this._audioBuffer.reduce((s, c) => s + c.length, 0);
    const combined = new Int16Array(totalLen);
    let offset = 0;
    for (const chunk of this._audioBuffer) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    this._audioBuffer = [];

    const ctx = this.audioCtx;
    const floatBuffer = new Float32Array(combined.length);
    for (let i = 0; i < combined.length; i++) {
      floatBuffer[i] = combined[i] / 32768;
    }

    const audioBuf = ctx.createBuffer(1, floatBuffer.length, 24000);
    audioBuf.getChannelData(0).set(floatBuffer);

    if (this._playbackSource) {
      try { this._playbackSource.stop(); } catch {}
    }
    const source = ctx.createBufferSource();
    source.buffer = audioBuf;
    source.connect(this.gainNode || ctx.destination);
    source.start();
    this._playbackSource = source;
    source.onended = () => {
      if (this._playbackSource === source) this._playbackSource = null;
    };
  }

  say(text) {
    const now = Date.now();
    if (now - this.lastSpoke < SPEAK_COOLDOWN) return;
    if (this._speaking) return;
    this.lastSpoke = now;
    this._speaking = true;

    if (!this._fallback && this.connected) {
      try {
        this._audioBuffer = [];
        this._sendEvent({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
          },
        });
        this._sendEvent({ type: 'response.create' });
      } catch (e) {
        this._fallback = true;
        this._fallbackSay(text);
      }
    } else {
      this._fallbackSay(text);
    }
  }

  ambient() {
    const now = Date.now();
    if (now - this.lastAmbient < AMBIENT_INTERVAL) return;
    if (this._speaking) return;
    this.lastAmbient = now;

    const prompts = [
      'You sense a player nearby. Taunt them briefly.',
      'Mutter something menacing about the Backrooms.',
      'You hear footsteps. React with a short threat.',
      'Laugh ominously and say something creepy.',
      'Whisper a cryptic warning about what lurks deeper.',
      'Growl about your old ship and how hungry you are.',
    ];
    const prompt = prompts[(Math.random() * prompts.length) | 0];
    this.say(prompt);
  }

  respondToChat(playerName, message) {
    this.say(`A lost soul named "${playerName}" just said: "${message}". Respond to them menacingly.`);
  }

  updateSpatial(clarkX, clarkZ, playerX, playerZ) {
    if (!this.gainNode || !this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') void this._resumeAudioContext(this.audioCtx);

    const dist = Math.hypot(clarkX - playerX, clarkZ - playerZ);
    const volume = Math.max(0, 1 - dist / PROXIMITY_DIST) * (settings.clarkVolume ?? 0.8);
    this.gainNode.gain.setTargetAtTime(volume * 1.5, this.audioCtx.currentTime, 0.1);

    if (this.pannerNode) {
      const dx = clarkX - playerX;
      const pan = Math.max(-1, Math.min(1, dx / 10));
      this.pannerNode.pan.setTargetAtTime(pan, this.audioCtx.currentTime, 0.1);
    }
  }

  async _fallbackSay(userPrompt) {
    try {
      this._chatHistory.push({ role: 'user', content: userPrompt });
      if (this._chatHistory.length > 12) {
        this._chatHistory = [this._chatHistory[0], ...this._chatHistory.slice(-6)];
      }

      const res = await fetch(`${RELAY_URL}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: this._chatHistory,
          max_tokens: 80,
          temperature: 0.9,
        }),
      });
      const body = await res.text().catch(() => '');
      let text = null;

      if (res.ok) {
        try {
          const data = JSON.parse(body);
          text = data.choices?.[0]?.message?.content;
        } catch {}
      } else {
        console.warn('[clark-ai] chat completions failed:', res.status, body);
      }

      if (!text) {
        text = FALLBACK_LINES[(Math.random() * FALLBACK_LINES.length) | 0];
      }

      this._chatHistory.push({ role: 'assistant', content: text });
      this._onSpeech?.(text);
      this._speakWithTTS(text);
    } catch (e) {
      console.warn('[clark-ai] fallback error:', e);
      const text = FALLBACK_LINES[(Math.random() * FALLBACK_LINES.length) | 0];
      this._onSpeech?.(text);
      this._speakWithTTS(text);
    }
  }

  _speakWithTTS(text) {
    if (!('speechSynthesis' in window)) {
      this._playFallbackGrowl();
      return;
    }

    void this._resumeAudioContext(this.audioCtx).catch(() => {});
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.82;
    utter.pitch = 0.42;
    utter.volume = Math.max(0.05, (settings.clarkVolume ?? 0.8) * (this.gainNode ? this.gainNode.gain.value : 1));

    const voices = speechSynthesis.getVoices();
    const preferred = voices.find((v) => /male|daniel|fred|alex|google us english/i.test(`${v.name} ${v.lang}`));
    if (preferred) utter.voice = preferred;

    const done = () => { this._speaking = false; };
    utter.onend = done;
    utter.onerror = () => {
      console.warn('[clark-ai] speechSynthesis error');
      this._playFallbackGrowl();
    };

    try {
      speechSynthesis.speak(utter);
    } catch (e) {
      console.warn('[clark-ai] speechSynthesis blocked:', e);
      this._playFallbackGrowl();
    }
  }

  _playFallbackGrowl() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      this._speaking = false;
      return;
    }
    if (this.audioCtx?.state === 'closed') this.audioCtx = null;
    if (!this.audioCtx) {
      this.audioCtx = new AudioCtor();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.connect(this.audioCtx.destination);
    }
    void this._resumeAudioContext(this.audioCtx).catch(() => {});

    const ctx = this.audioCtx;
    const osc = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(42, ctx.currentTime + 0.55);
    filt.type = 'lowpass';
    filt.frequency.value = 420;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.22 * (settings.clarkVolume ?? 0.8), ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75);
    osc.connect(filt).connect(g).connect(this.gainNode);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
    osc.onended = () => { this._speaking = false; };
  }

  destroy() {
    speechSynthesis?.cancel?.();
    if (this._playbackSource) { try { this._playbackSource.stop(); } catch {} this._playbackSource = null; }
    this.dc?.close();
    this.pc?.close();
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} }
    if (this._silentCtx) { try { this._silentCtx.close(); } catch {} }
    this.audioEl?.remove();
    this.pc = null;
    this.dc = null;
    this.audioEl = null;
    this.connected = false;
    this._speaking = false;
    this._audioBuffer = [];
  }
}
