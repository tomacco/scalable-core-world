// Sky machinery: atmosphere dome, stars, sun & moon bodies, aurora borealis.

import * as THREE from 'three';
import { makeNoise } from './noise.js';

const rnd = makeNoise(999);

export function createSky(scene) {
  // ------------------------------------------------- atmosphere dome
  const skyUniforms = {
    uZenith: { value: new THREE.Color(0x6fb6ff) },
    uHorizon: { value: new THREE.Color(0xcfe8ff) },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunGlow: { value: new THREE.Color(0xfff2cc) },
    uGlowPower: { value: 0.0 },
  };

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(820, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyUniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uZenith, uHorizon, uSunGlow;
        uniform vec3 uSunDir;
        uniform float uGlowPower;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float t = pow(1.0 - abs(d.y), 2.2);
          vec3 col = mix(uZenith, uHorizon, t);
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunGlow * pow(s, 24.0) * uGlowPower;
          col += uSunGlow * pow(s, 4.0) * uGlowPower * 0.25;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  );
  dome.renderOrder = -10;
  scene.add(dome);

  // ------------------------------------------------------------ stars
  const starCount = 2200;
  const starPos = new Float32Array(starCount * 3);
  const starCol = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const u = rnd.hash(i, 1, 0) * 2 - 1;
    const a = rnd.hash(i, 2, 0) * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const R = 700;
    starPos[i * 3] = Math.cos(a) * r * R;
    starPos[i * 3 + 1] = u * R;
    starPos[i * 3 + 2] = Math.sin(a) * r * R;
    const warm = rnd.hash(i, 3, 0);
    const bright = 0.5 + 0.5 * rnd.hash(i, 4, 0);
    starCol[i * 3] = bright;
    starCol[i * 3 + 1] = bright * (0.85 + 0.15 * warm);
    starCol[i * 3 + 2] = bright * (0.8 + 0.2 * (1 - warm));
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const starMat = new THREE.PointsMaterial({
    size: 2.4, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // -------------------------------------------------------- sun, moon
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(17, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffedb0 })
  );
  scene.add(sun);

  const moonMat = new THREE.MeshBasicMaterial({ color: 0xaebfd8, transparent: true, opacity: 0.9 });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(9, 20, 20), moonMat);
  scene.add(moon);

  // ----------------------------------------------------------- aurora
  const auroraUniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
  };
  const auroraGroup = new THREE.Group();
  const auroraMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: auroraUniforms,
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += sin(uv.x * 9.0 + uTime * 0.35) * 7.0;
        p.y += sin(uv.x * 5.0 - uTime * 0.22) * 4.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime, uOpacity;
      varying vec2 vUv;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1, 0)), f.x),
          mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x),
          f.y
        );
      }

      void main() {
        float bands = vnoise(vec2(vUv.x * 7.0 + uTime * 0.12, uTime * 0.05));
        bands = bands * 0.6 + 0.4 * vnoise(vec2(vUv.x * 19.0 - uTime * 0.07, 3.7));
        float curtain = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
        float rays = 0.55 + 0.45 * sin(vUv.x * 60.0 + bands * 14.0 + uTime * 0.4);
        vec3 green = vec3(0.15, 0.95, 0.45);
        vec3 teal  = vec3(0.10, 0.65, 0.80);
        vec3 violet = vec3(0.55, 0.20, 0.85);
        vec3 col = mix(green, teal, vUv.y);
        col = mix(col, violet, smoothstep(0.55, 1.0, vUv.y) * 0.7);
        float a = curtain * rays * bands * uOpacity;
        gl_FragColor = vec4(col * a * 1.6, a);
      }
    `,
  });

  for (let i = 0; i < 3; i++) {
    const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(240 - i * 40, 55 + i * 10, 96, 1), auroraMat);
    ribbon.position.set((i - 1) * 30, 120 + i * 22, -40 + i * 45);
    ribbon.rotation.x = -0.35 + i * 0.12;
    ribbon.rotation.z = (i - 1) * 0.18;
    auroraGroup.add(ribbon);
  }
  auroraGroup.rotation.x = -0.25; // drape over the north pole
  scene.add(auroraGroup);

  // ------------------------------------------------------ update loop

  const DAY = {
    zenith: new THREE.Color(0x5fb0f2), horizon: new THREE.Color(0xc8e6ff),
    sun: new THREE.Color(0xfff6d8),
  };
  const DUSK = {
    zenith: new THREE.Color(0x2a2550), horizon: new THREE.Color(0xff7a3c),
    sun: new THREE.Color(0xffb36b),
  };
  const NIGHT = {
    zenith: new THREE.Color(0x040816), horizon: new THREE.Color(0x0c1526),
    sun: new THREE.Color(0x1b2a44),
  };

  const tmpA = new THREE.Color(), tmpB = new THREE.Color();

  function phaseMix(elev, out, day, dusk, night) {
    // elev: sun elevation -1..1
    if (elev > 0.28) return out.copy(day);
    if (elev > 0.0) {
      const t = elev / 0.28;
      return out.copy(dusk).lerp(day, t);
    }
    if (elev > -0.22) {
      const t = (elev + 0.22) / 0.22;
      return out.copy(night).lerp(dusk, t);
    }
    return out.copy(night);
  }

  return {
    update(sunDir, elapsed, auroraBoost = 0) {
      const elev = sunDir.y;
      const nightF = THREE.MathUtils.smoothstep(-elev, -0.05, 0.25);
      const duskF = Math.max(0, 1 - Math.abs(elev) / 0.3);

      phaseMix(elev, skyUniforms.uZenith.value, DAY.zenith, DUSK.zenith, NIGHT.zenith);
      phaseMix(elev, skyUniforms.uHorizon.value, DAY.horizon, DUSK.horizon, NIGHT.horizon);
      phaseMix(elev, skyUniforms.uSunGlow.value, DAY.sun, DUSK.sun, NIGHT.sun);
      skyUniforms.uSunDir.value.copy(sunDir);
      skyUniforms.uGlowPower.value = 0.55 + duskF * 1.6;

      sun.position.copy(sunDir).multiplyScalar(640);
      tmpA.set(0xffedb0); tmpB.set(0xff8a3d);
      sun.material.color.copy(tmpA).lerp(tmpB, duskF);
      sun.visible = elev > -0.3;

      moon.position.copy(sunDir).multiplyScalar(-620);
      moon.position.x += 140;
      moonMat.opacity = 0.15 + nightF * 0.8;

      starMat.opacity = nightF * (0.9 + 0.1 * Math.sin(elapsed * 1.7));

      auroraUniforms.uTime.value = elapsed;
      const auroraStrength = nightF * (0.45 + auroraBoost);
      auroraUniforms.uOpacity.value = Math.min(auroraStrength, 1.0);

      return { nightF, duskF };
    },
  };
}
