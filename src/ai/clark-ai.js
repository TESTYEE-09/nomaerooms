// Clark AI — OpenAI Realtime API via WebRTC for voice, with chat completions fallback.
// Clark speaks to nearby players as Captain Pirate Clark from the Backrooms.

const OPENAI_KEY = import.meta.env.VITE_OPENAI_KEY || '';
const REALTIME_MODEL = 'gpt-4o-mini-realtime-preview-2024-12-17';
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

export class ClarkAI {
  constructor() {
    this.pc = null;
    this.dc = null;
    this.audioEl = null;
    this.audioCtx = null;
    this.gainNode = null;
    this.pannerNode = null;
    this.active = false;
    this.connected = false;
    this.lastSpoke = 0;
    this.lastAmbient = 0;
    this.pendingText = null;
    this._fallback = false;
    this._chatHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
    this._speaking = false;
    this._onSpeech = null;
  }

  set onSpeech(fn) { this._onSpeech = fn; }

  async init() {
    if (!OPENAI_KEY) {
      console.warn('[clark-ai] No OpenAI key — AI voice disabled');
      return;
    }
    try {
      await this._initRealtime();
      console.log('[clark-ai] Realtime API connected');
    } catch (e) {
      console.warn('[clark-ai] Realtime API failed, using fallback:', e);
      this._fallback = true;
      this._initFallbackAudio();
    }
  }

  async _initRealtime() {
    const res = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: REALTIME_MODEL,
        voice: 'ash',
        instructions: SYSTEM_PROMPT,
        input_audio_transcription: { model: 'whisper-1' },
      }),
    });
    if (!res.ok) throw new Error(`Session creation failed: ${res.status}`);
    const data = await res.json();
    const token = data.client_secret?.value;
    if (!token) throw new Error('No ephemeral token');

    this.pc = new RTCPeerConnection();

    this.audioEl = document.createElement('audio');
    this.audioEl.autoplay = true;

    this.pc.ontrack = (e) => {
      const stream = e.streams[0];
      this.audioEl.srcObject = stream;
      this._setupSpatialAudio(stream);
    };

    // Add silent audio track (required by the API even without mic input)
    const silentCtx = new AudioContext();
    const oscillator = silentCtx.createOscillator();
    const dest = silentCtx.createMediaStreamDestination();
    oscillator.connect(dest);
    oscillator.start();
    const silentTrack = dest.stream.getAudioTracks()[0];
    silentTrack.enabled = false;
    this.pc.addTrack(silentTrack);

    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onopen = () => {
      this.connected = true;
      this._sendEvent({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: SYSTEM_PROMPT,
          voice: 'ash',
          turn_detection: null,
        },
      });
    };
    this.dc.onmessage = (e) => this._handleRealtimeEvent(JSON.parse(e.data));
    this.dc.onclose = () => { this.connected = false; };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const sdpRes = await fetch(
      `https://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      }
    );
    if (!sdpRes.ok) throw new Error(`SDP exchange failed: ${sdpRes.status}`);
    const answerSdp = await sdpRes.text();
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  _setupSpatialAudio(stream) {
    this.audioCtx = new AudioContext();
    const source = this.audioCtx.createMediaStreamSource(stream);
    this.gainNode = this.audioCtx.createGain();
    this.pannerNode = this.audioCtx.createStereoPanner();
    source.connect(this.gainNode);
    this.gainNode.connect(this.pannerNode);
    this.pannerNode.connect(this.audioCtx.destination);
    this.audioEl.muted = true;
  }

  _initFallbackAudio() {
    this.audioCtx = new AudioContext();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.connect(this.audioCtx.destination);
  }

  _sendEvent(event) {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify(event));
    }
  }

  _handleRealtimeEvent(event) {
    if (event.type === 'response.audio_transcript.done') {
      const text = event.transcript;
      if (text) this._onSpeech?.(text);
    } else if (event.type === 'response.done') {
      this._speaking = false;
    } else if (event.type === 'response.audio.delta') {
      this._speaking = true;
    }
  }

  say(text) {
    const now = Date.now();
    if (now - this.lastSpoke < SPEAK_COOLDOWN) return;
    if (this._speaking) return;
    this.lastSpoke = now;
    this._speaking = true;

    if (!this._fallback && this.connected) {
      this._sendEvent({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      });
      this._sendEvent({ type: 'response.create' });
    } else if (this._fallback) {
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
    if (!this.gainNode) return;
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

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: this._chatHistory,
          max_tokens: 80,
          temperature: 0.9,
        }),
      });

      if (!res.ok) { this._speaking = false; return; }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) { this._speaking = false; return; }

      this._chatHistory.push({ role: 'assistant', content: text });
      this._onSpeech?.(text);
      this._speakWithTTS(text);
    } catch (e) {
      console.warn('[clark-ai] fallback error:', e);
      this._speaking = false;
    }
  }

  _speakWithTTS(text) {
    if (!('speechSynthesis' in window)) { this._speaking = false; return; }
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.8;
    utter.pitch = 0.4;
    utter.volume = (settings.clarkVolume ?? 0.8) * (this.gainNode ? this.gainNode.gain.value : 1);
    utter.onend = () => { this._speaking = false; };
    utter.onerror = () => { this._speaking = false; };
    speechSynthesis.speak(utter);
  }

  destroy() {
    this.dc?.close();
    this.pc?.close();
    this.audioCtx?.close();
    this.pc = null;
    this.dc = null;
    this.connected = false;
    this._speaking = false;
  }
}
