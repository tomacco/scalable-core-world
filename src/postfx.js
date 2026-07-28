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
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uIntensity <= 0.001) { gl_FragColor = base; return; }

      const int SAMPLES = 36;
      vec2 delta = (uSunPos - vUv) / float(SAMPLES) * 0.92;
      vec2 uv = vUv;
      float decay = 0.955;
      float weight = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        uv += delta;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        acc += s * smoothstep(0.55, 1.4, lum) * weight;
        weight *= decay;
      }
      acc /= float(SAMPLES);
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

  return {
    composer,
    setSize(w, h) { composer.setSize(w, h); },
    update(sunWorldPos, duskF, nightF) {
      sunNDC.copy(sunWorldPos).project(camera);
      const onScreen = sunNDC.z < 1
        && sunNDC.x > -1.4 && sunNDC.x < 1.4
        && sunNDC.y > -1.4 && sunNDC.y < 1.4;
      if (onScreen) {
        godrays.uniforms.uSunPos.value.set((sunNDC.x + 1) / 2, (sunNDC.y + 1) / 2);
        // strongest at dawn/dusk, subtle at noon, off at night
        const edgeFade = 1.0 - Math.max(Math.abs(sunNDC.x), Math.abs(sunNDC.y)) / 1.4;
        godrays.uniforms.uIntensity.value =
          (0.25 + duskF * 0.9) * (1 - nightF) * Math.max(0, edgeFade) * 1.1;
        godrays.uniforms.uTint.value.setRGB(1.0, 0.9 - duskF * 0.25, 0.65 - duskF * 0.25);
      } else {
        godrays.uniforms.uIntensity.value = 0;
      }
      bloom.strength = 0.45 + nightF * 0.5 + duskF * 0.25;
    },
  };
}
