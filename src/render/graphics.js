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

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // fear warps the frame: stronger aberration + slight pulse zoom
      float ab = aberration * (1.0 + fear * 6.0) * (0.5 + r2 * 4.0);
      vec2 dir = normalize(c + 1e-6);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;

      // film grain (animated)
      float g = (rand(uv * vec2(1920.0, 1080.0) + fract(time) * 43.0) - 0.5) * grain;
      col += g * (0.6 + r2 * 2.0);

      // vignette, tightens with fear
      float v = smoothstep(0.95, 0.32 - fear * 0.18, r2 * (vignette + fear * 0.9));
      col *= mix(0.32, 1.0, v);

      // fear drains colour and pushes red into the edges
      float grey = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(grey), fear * 0.45);
      col.r += fear * r2 * 0.55;

      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Graphics {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // applied by OutputPass
    this.renderer.toneMappingExposure = 1.35;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050603);

    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 140);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.ssaoPass = new SSAOPass(this.scene, this.camera, innerWidth, innerHeight);
    this.ssaoPass.kernelRadius = 0.5;
    this.ssaoPass.minDistance = 0.0008;
    this.ssaoPass.maxDistance = 0.12;
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.55, 0.92);
    this.dreadPass = new ShaderPass(DreadShader);
    this.outputPass = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.ssaoPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.dreadPass);
    this.composer.addPass(this.outputPass);

    window.addEventListener('resize', () => this._resize());
    this._quality = null;
  }

  applyQuality(name, fov) {
    const q = QUALITY[name] || QUALITY.medium;
    this._quality = q;
    this.ssaoPass.enabled = q.ssao;
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
    this.dreadPass.uniforms.time.value = t;
    this.composer.render();
  }
}
