// Post processing: bloom (glowing windows, sun halo, aurora) and a
// screen-space god-rays pass that streaks light from the sun through
// the planet's silhouette at dawn and dusk.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
    uIntensity: { value: 0.0 },
    uTint: { value: new THREE.Color(1.0, 0.85, 0.6) },
    uSamples: { value: 36.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uSunPos;
    uniform float uIntensity;
    uniform vec3 uTint;
    uniform float uSamples;
    varying vec2 vUv;

    // GLSL ES 1.0 will only loop to a constant bound, so the march is written
    // to the ceiling and cut short by a uniform. The branch is the same for
    // every pixel in the frame, so the wavefront exits together and the cost
    // really does fall with the sample count — no recompile needed to retune.
    const int MAX_SAMPLES = 36;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uIntensity <= 0.001 || uSamples < 1.0) { gl_FragColor = base; return; }

      vec2 delta = (uSunPos - vUv) / uSamples * 0.92;
      vec2 uv = vUv;
      // stretch the per-step falloff to cover the same streak length however
      // few steps we take, so dropping samples softens the rays without also
      // shortening them
      float decay = pow(0.955, float(MAX_SAMPLES) / uSamples);
      float weight = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < MAX_SAMPLES; i++) {
        if (float(i) >= uSamples) break;
        uv += delta;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        acc += s * smoothstep(0.55, 1.4, lum) * weight;
        weight *= decay;
      }
      acc /= uSamples;
      gl_FragColor = vec4(base.rgb + acc * uTint * uIntensity * 1.6, base.a);
    }
  `,
};

export function createPostFX(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.55, 0.85, 0.8
  );
  composer.addPass(bloom);

  const godrays = new ShaderPass(GodRaysShader);
  composer.addPass(godrays);

  composer.addPass(new OutputPass());

  const sunNDC = new THREE.Vector3();

  // The composer sizes every pass to the full frame buffer. Bloom does not
  // need that: it is a blur, and its own mip chain starts by halving anyway,
  // so rendering it into a smaller target is nearly free visually and saves
  // roughly its share of the fill. Composer.setSize would overwrite this, so
  // the scale is remembered and re-applied after every resize.
  let viewW = window.innerWidth, viewH = window.innerHeight;
  let viewPR = renderer.getPixelRatio();
  let bloomScale = 1;
  let raySamples = 36;

  function resizeBloom() {
    if (bloomScale <= 0) return;   // pass is disabled; its targets are moot
    bloom.setSize(
      Math.max(1, Math.round(viewW * viewPR * bloomScale)),
      Math.max(1, Math.round(viewH * viewPR * bloomScale))
    );
  }

  return {
    composer,
    setSize(w, h) { viewW = w; viewH = h; composer.setSize(w, h); resizeBloom(); },
    setPixelRatio(pr) { viewPR = pr; composer.setPixelRatio(pr); resizeBloom(); }, // adaptive resolution
    setBloomScale(scale) {
      bloomScale = scale;
      bloom.enabled = scale > 0;
      resizeBloom();
    },
    setRaySamples(n) {
      raySamples = n;
      godrays.uniforms.uSamples.value = Math.max(1, n);
    },
    update(sunWorldPos, duskF, nightF) {
      sunNDC.copy(sunWorldPos).project(camera);
      const onScreen = sunNDC.z < 1
        && sunNDC.x > -1.4 && sunNDC.x < 1.4
        && sunNDC.y > -1.4 && sunNDC.y < 1.4;
      let intensity = 0;
      if (onScreen) {
        godrays.uniforms.uSunPos.value.set((sunNDC.x + 1) / 2, (sunNDC.y + 1) / 2);
        // strongest at dawn/dusk, subtle at noon, off at night
        const edgeFade = 1.0 - Math.max(Math.abs(sunNDC.x), Math.abs(sunNDC.y)) / 1.4;
        intensity = (0.25 + duskF * 0.9) * (1 - nightF) * Math.max(0, edgeFade) * 1.1;
        godrays.uniforms.uTint.value.setRGB(1.0, 0.9 - duskF * 0.25, 0.65 - duskF * 0.25);
      }
      godrays.uniforms.uIntensity.value = intensity;
      // a zero-strength pass would still stream every pixel through the
      // shader — drop it from the chain outright when it can't contribute,
      // and likewise when quality has turned the march off altogether
      godrays.enabled = raySamples > 0 && intensity > 0.001;
      if (bloom.enabled) bloom.strength = 0.45 + nightF * 0.5 + duskF * 0.25;
    },
  };
}
