# NomaeROOMS

> A multiplayer Backrooms browser game. Get lost with friends. Watch out for Pirate Clark.

A first-person horror/exploration game that runs entirely in the browser. Procedural
infinite maze of green damask-wallpapered rooms, damp green carpet, and flickering
fluorescent lights, rendered with PBR materials, ACES tone mapping, dynamic shadows
and a bloom + grain + vignette post-processing stack. Play solo or with friends over
WebRTC peer-to-peer and text-chat with them as you get lost. Run from **Pirate Clark**
— the tall dark figure who stalks you through the corridors.

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
| `C` | Show credits / attribution |
| `Esc` | Pause / resume |

## Multiplayer

1. One player clicks **Host Room** — gets a 6-character room code (e.g. `NOMAD42`).
2. Other players click **Join Room** and type that code.
3. Text chat and position sync over a WebRTC data channel — no
   game server, no ports to forward, no accounts.

## Deployment

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds the site and
publishes `dist/` to the `gh-pages` branch on every push to `main`, so the live
site updates automatically. To deploy by hand, run `npm run build` and serve the
`dist/` folder on any static host.

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

- **Three.js** — WebGL renderer, GLTF loader, PBR materials, dynamic shadows,
  EffectComposer post-processing (bloom + ACES tone map + vignette/grain grade)
- **PeerJS** — WebRTC peer-to-peer for text chat + position sync
- **Vite** — dev server + bundler
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
├── render/postfx.js      ← bloom + tone-map + vignette/grain post pipeline
├── ui/
│   ├── chat.js           ← peer-to-peer text chat
│   └── styles.css        ← Backrooms CSS
└── world/
    ├── world.js          ← chunked procedural room generator
    └── textures.js       ← procedural PBR texture sets (albedo/normal/rough)
```

## License

MIT for the code, CC BY 4.0 for the Pirate Clark 3D model (see `LICENSE`).
The bundled music is for non-commercial/demo use; replace it before
distributing commercially.

## Credits

- **Pirate Clark (Backrooms)** by [Slightlyoversizedsweater](https://sketchfab.com/Slightlyoversizedsweater)
  on Sketchfab, used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Music via Handprint Media on YouTube, used with attribution.
