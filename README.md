# NomaeROOMS

> A multiplayer Backrooms browser game. Get lost with friends. Watch out for Pirate Clark.

A first-person horror/exploration game that runs entirely in the browser. Procedural
infinite maze of yellow-wallpapered rooms, damp green carpet, and flickering
fluorescent lights. Play solo or with friends over WebRTC peer-to-peer. Chat with
your friends in the Backrooms and hear their messages read aloud in your
selected voice. Run from **Pirate Clark** — the tall dark figure with glowing
red eyes who stalks you through the corridors.

![NomaeROOMS screenshot](https://raw.githubusercontent.com/TESTYEE-09/nomaerooms/main/.github/screenshot.png)

## Quick start

```bash
npm install
npm run dev          # open http://localhost:5173
npm run build        # production bundle in dist/
npm run preview      # serve the build
```

The game is a static site — drop the contents of `dist/` onto any static host
(GitHub Pages, Netlify, Cloudflare Pages, S3+CloudFront, …) and you're done.
No backend. Multiplayer is P2P via PeerJS, with the default signal broker
already configured.

## Controls

| Key | Action |
|---|---|
| `W` `A` `S` `D` / arrows | Move |
| Mouse | Look |
| `Shift` | Sprint (drains stamina) |
| `Space` | Jump |
| `T` | Open chat |
| `Enter` | Send message |
| **Save Clip** button | Save the last message as a voice clip |
| `V` | Replay the last saved clip |
| `C` | Show credits / attribution |
| `Esc` | Pause / resume |

## Multiplayer

1. One player clicks **Host Room** — gets a 6-character room code (e.g. `NOMAD42`).
2. Other players click **Join Room** and type that code.
3. Chat, position, and saved clips sync over a WebRTC data channel — no
   game server, no ports to forward, no accounts.

Clips saved by anyone in the room are shared with all peers, so the whole group
ends up with the same library of in-character voice clips to spam at each other.

## Voice clips (no AI cloning)

The "voice mimic" is **your browser's built-in SpeechSynthesis** with the voice
you pick in the menu. Every chat message is auto-spoken in-game. Saving a clip
just stores `{name, text, voiceURI, pitch, rate}` to localStorage and reuses
the system TTS on replay. The "Bad News / Jester / Cellos / Organ" macOS voices
are *delightful* for this.

Want **real** voice cloning? Drop in a TTS API call where the `SpeechSynthesisUtterance`
is created in `src/ui/chat.js::_speak()`. You'll need consent from every speaker
and a per-speaker voice model.

## Assets

| File | Source | License |
|---|---|---|
| `public/assets/models/pirate-clark.glb` | [Sketchfab — Slightlyoversizedsweater](https://sketchfab.com/3d-models/pirate-clark-backrooms-8866abd81cde47948303ac5c26302a97) | CC BY 4.0 |
| `public/assets/music/theme.{ogg,mp3,wav}` | Handprint Media, YouTube | Used with attribution |
| `src/world/world.js` textures | procedural (canvas) | — |
| Procedural ambient audio (hum, drone) | Web Audio synth | — |

To replace the music: drop a new `theme.ogg` (or `.mp3`/`.wav`) into
`public/assets/music/`. The loader tries them in order. Same for any other
audio file at that path.

To use a different Pirate Clark model: replace `pirate-clark.glb` with any
GLTF/GLB. The loader normalizes scale to 2.6 units tall and positions the feet
on the floor.

## Tech

- **Three.js** — WebGL renderer, GLTF loader, point lights
- **PeerJS** — WebRTC peer-to-peer for chat + position + clip sync
- **Vite** — dev server + bundler
- **SpeechSynthesis API** — built-in browser TTS for "voice mimic"
- **Web Audio API** — procedural fluorescent hum, sub-bass drone, footsteps,
  jumpscare sting

## File map

```
src/
├── main.js               ← game loop, scene wiring, HUD
├── player.js             ← FPS controller (pointer lock, WASD, jump, stamina)
├── audio/audio.js        ← hum + music slot + footsteps + jumpscare
├── entities/
│   └── pirate-clark.js   ← antagonist AI + GLTF loader
├── net/net.js            ← PeerJS host/join
├── ui/
│   ├── chat.js           ← proxy chat + voice-clip save/replay
│   └── styles.css        ← Backrooms CSS
└── world/world.js        ← chunked procedural room generator
```

## License

MIT for the code, CC BY 4.0 for the Pirate Clark 3D model (see `LICENSE`).
The bundled music is for non-commercial/demo use; replace it before
distributing commercially.

## Credits

- **Pirate Clark (Backrooms)** by [Slightlyoversizedsweater](https://sketchfab.com/Slightlyoversizedsweater)
  on Sketchfab, used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Music via Handprint Media on YouTube, used with attribution.
- Voices: your browser's system TTS.
