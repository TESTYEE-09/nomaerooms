// postfx.js — the post-processing stack that gives NomaeROOMS its look.
//
// Pipeline:  scene → bloom → ACES tone-map + sRGB → "dread" grade
//
//   RenderPass        renders the lit scene into an HDR (half-float) buffer
//   UnrealBloomPass    blooms the bright emissive fixtures and Clark's eyes
//   OutputPass         applies the renderer's ACES tone mapping + sRGB encode
//   dreadPass          LDR grade: vignette, chromatic aberration, desaturation,
//                      animated film grain — the liminal-horror finish
//
// setQuality() lets the menu drop bloom + grain for weaker GPUs.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DreadShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    vignette: { value: 1.35 },
    grain: { value: 0.055 },
    aberration: { value: 0.42 },
    desaturate: { value: 0.16 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float time, vignette, grain, aberration, desaturate;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      // chromatic aberration — grows toward the edges
      vec2 off = d * aberration * 0.02 * (r2 * 2.0 + 0.15);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      // gentle desaturation toward a cold liminal grade
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l) * vec3(0.95, 0.97, 1.0), desaturate);

      // vignette
      float vig = smoothstep(0.85, 0.18, r2 * vignette);
      col *= mix(1.0, vig, 0.85);

      // animated film grain
      float g = hash(uv * 1024.0 + fract(time) * 97.0) - 0.5;
      col += g * grain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function setupPostFX(renderer, scene, camera) {
  const w = window.innerWidth;
  const h = window.innerHeight;

  const target = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    samples: 2,            // MSAA on the HDR pass; cheap edge AA before bloom
  });
  const composer = new EffectComposer(renderer, target);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.55, 0.82);
  composer.addPass(bloom);

  const outputPass = new OutputPass();   // ACES tone map + sRGB
  composer.addPass(outputPass);

  const dreadPass = new ShaderPass(DreadShader);
  composer.addPass(dreadPass);

  function resize(width, height) {
    composer.setSize(width, height);
    bloom.setSize(width, height);
  }

  // quality: 'high' (full) | 'low' (no bloom, no grain, no aberration)
  function setQuality(q) {
    const low = q === 'low';
    bloom.enabled = !low;
    dreadPass.uniforms.grain.value = low ? 0.0 : 0.055;
    dreadPass.uniforms.aberration.value = low ? 0.0 : 0.42;
  }

  return {
    composer,
    resize,
    setQuality,
    update(dt) { dreadPass.uniforms.time.value += dt; },
  };
}
