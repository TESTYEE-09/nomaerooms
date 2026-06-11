// Renderer + post stack: render → SSAO → bloom → dread grade (film grain,
// vignette, chromatic aberration, fear tint) → OutputPass (ACES + sRGB).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { QUALITY } from '../core/config.js';

const DreadShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grain: { value: 0.085 },
    vignette: { value: 1.05 },
    fear: { value: 0 },        // 0..1 — Clark proximity
    aberration: { value: 0.0014 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time, grain, vignette, fear, aberration;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.299, 0.587, 0.114);

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      float t = time;

      // --- tape transport: subtle frame jitter + per-scanline wobble
      uv.y += (rand(vec2(floor(t * 13.0), 7.0)) - 0.5) * 0.0018;
      float line = floor(uv.y * 486.0);
      float frameSlot = floor(t * 18.0);
      uv.x += (rand(vec2(line, frameSlot)) - 0.5) * 0.0012 * (1.0 + fear * 2.5);

      // --- tracking tear: a distorted band that occasionally rolls through
      float roll = fract(t * 0.11);
      float tear = 1.0 - smoothstep(0.0, 0.035, abs(uv.y - roll));
      float tearOn = step(0.55, rand(vec2(floor(t * 0.11), 3.0))); // most rolls skipped
      uv.x += tear * tearOn * (rand(vec2(line, floor(t * 60.0))) - 0.35) * 0.06;

      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // --- luma sharp / chroma soft (VHS colour-under), plus fear aberration
      float ab = aberration * (1.0 + fear * 6.0) * (0.6 + r2 * 4.0);
      vec3 sharp;
      sharp.r = texture2D(tDiffuse, uv + vec2(ab * 2.2, 0.0)).r;
      sharp.g = texture2D(tDiffuse, uv).g;
      sharp.b = texture2D(tDiffuse, uv - vec2(ab * 2.2, 0.0)).b;
      vec3 soft = (
        texture2D(tDiffuse, uv + vec2(0.0042, 0.0)).rgb +
        texture2D(tDiffuse, uv - vec2(0.0028, 0.0)).rgb
      ) * 0.5;
      float luma = dot(sharp, LUMA);
      vec3 chroma = soft - dot(soft, LUMA);
      vec3 col = vec3(luma) + chroma * 1.15;

      // --- scanlines (interlace shimmer)
      col *= 0.93 + 0.07 * sin(vUv.y * 486.0 * 3.14159 + step(0.5, fract(t * 30.0)) * 3.14159);

      // --- tape noise: speckle, brighter inside the tear band
      float n = rand(uv * vec2(1920.0, 1080.0) + fract(t) * 43.0);
      col += (n - 0.5) * grain * (1.0 + tear * tearOn * 5.0);

      // --- dropout streaks: rare bright horizontal scratches
      float dropSeed = rand(vec2(line, floor(t * 24.0)));
      float drop = step(0.9965, dropSeed) * step(rand(vec2(uv.x * 7.0, line)), 0.55);
      col += drop * 0.4;

      // --- head-switching noise at the very bottom of the frame
      float hs = smoothstep(0.012, 0.0, vUv.y);
      col = mix(col, vec3(rand(vec2(uv.x * 160.0, floor(t * 50.0)))) * 0.6, hs * 0.8);

      // --- vignette, tightens with fear
      float v = smoothstep(0.95, 0.32 - fear * 0.18, r2 * (vignette + fear * 0.9));
      col *= mix(0.32, 1.0, v);

      // --- fear drains colour and pushes red into the edges
      float grey = dot(col, LUMA);
      col = mix(col, vec3(grey), fear * 0.45);
      col.r += fear * r2 * 0.55;

      // --- hallucination / trip effects (fear > 0.35) ---
      float h = clamp((fear - 0.35) * 3.1, 0.0, 1.0);
      if (h > 0.01) {
        float hp = t * 0.5 + fear * 6.28;

        // colour shift: rotate hue towards green/magenta
        vec3 shifted = col;
        shifted.rg = mix(shifted.rg, shifted.gr, h * 0.18 * (sin(hp) * 0.5 + 0.5));
        col = mix(col, shifted, h * 0.5);

        // ghosting / afterimage (double vision)
        vec2 gUv = vUv + vec2(h * 0.006 * sin(t * 1.1), h * 0.003 * cos(t * 0.9));
        vec3 ghost = texture2D(tDiffuse, gUv).rgb;
        col = mix(col, (col + ghost) * 0.5, h * 0.25);

        // geometric trip-pattern overlay
        float pat = sin(vUv.x * 120.0 + vUv.y * 80.0 + hp) * 0.5 + 0.5;
        pat *= sin(vUv.y * 100.0 - vUv.x * 60.0 + t * 0.8) * 0.5 + 0.5;
        col += pat * 0.04 * h * vec3(0.15, 0.55, 0.25);

        // brightness pulsing
        col *= 1.0 + h * 0.07 * sin(t * 2.2 + hp);

        // vignette breathing
        float v2 = smoothstep(0.9 - h * 0.15, 0.22, r2 * (vignette + h * 1.2));
        col *= mix(0.5, 1.0, v2);
      }

      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Graphics {
  constructor(canvas) {
    // antialias off: the composer renders into an offscreen target, so canvas
    // MSAA never applies — it only wastes memory/bandwidth
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // applied by OutputPass
    this.renderer.toneMappingExposure = 1.35;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050603);

    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 140);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.55, 0.92);
    this.dreadPass = new ShaderPass(DreadShader);
    this.outputPass = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.dreadPass);
    this.composer.addPass(this.outputPass);

    window.addEventListener('resize', () => this._resize());
    this._quality = null;
    this._frame = 0;
  }

  applyQuality(name, fov) {
    const q = QUALITY[name] || QUALITY.medium;
    this._quality = q;
    this.bloomPass.enabled = q.bloom;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.scene.fog = new THREE.FogExp2(0x0a0d06, q.fogDensity);
    this._resize();
    return q;
  }

  _resize() {
    const pr = Math.min(devicePixelRatio || 1, this._quality?.pixelRatio ?? 1.25);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth * pr, innerHeight * pr);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  setFear(f) { this.dreadPass.uniforms.fear.value = f; }

  render(t) {
    // shadow maps re-render every other frame: light intensity flicker doesn't
    // need a shadow update, and geometry under the lights changes slowly
    this._frame ^= 1;
    if (this._frame === 0) this.renderer.shadowMap.needsUpdate = true;
    this.dreadPass.uniforms.time.value = t;
    this.composer.render();
  }
}
