// The tiny planet: a voxelized sphere with oceans, beaches, grasslands,
// snow caps — and N flattened plots where contributors settle.

import * as THREE from 'three';
import { makeNoise } from './noise.js';

export const PLANET_RADIUS = 38;
export const SEA_LEVEL = 38.0;
export const PLOT_COUNT = 20;

const AMP = 5.2;              // terrain amplitude in voxels
const PLOT_INNER = 0.24;      // radians: fully flat plot cap
const PLOT_OUTER = 0.38;      // radians: blend back into wild terrain

const noise = makeNoise(20260728);

// ---------------------------------------------------------------- plots

function fibonacciPlots() {
  const candidates = [];
  const n = 90;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    candidates.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  // keep a temperate band — poles stay wild (snow + aurora country)
  const band = candidates.filter((v) => Math.abs(v.y) < 0.6);
  const plots = [];
  for (let i = 0; i < PLOT_COUNT; i++) {
    const idx = Math.floor((i * band.length) / PLOT_COUNT);
    plots.push({ dir: band[idx].clone().normalize(), radius: 0 });
  }
  return plots;
}

export const plots = fibonacciPlots();

// ------------------------------------------------------- terrain field

function rawRadius(dir) {
  const continents = noise.fbm(dir.x * 1.9 + 7.3, dir.y * 1.9, dir.z * 1.9, 3);
  const detail = noise.fbm(dir.x * 5.2, dir.y * 5.2 + 3.1, dir.z * 5.2, 4);
  return PLANET_RADIUS - 1.1 + (continents - 0.5) * 2 * AMP + (detail - 0.5) * 2.4;
}

for (const p of plots) {
  p.radius = Math.min(Math.max(rawRadius(p.dir), SEA_LEVEL + 1.8), PLANET_RADIUS + 3.2);
}

const COS_INNER = Math.cos(PLOT_INNER);
const COS_OUTER = Math.cos(PLOT_OUTER);

function smoothstep(a, b, t) {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

export function terrainRadius(dir) {
  let r = rawRadius(dir);
  // flatten toward the nearest plot
  let best = -2, bestPlot = null;
  for (const p of plots) {
    const d = dir.dot(p.dir);
    if (d > best) { best = d; bestPlot = p; }
  }
  if (bestPlot && best > COS_OUTER) {
    const t = smoothstep(COS_OUTER, COS_INNER, best);
    r = r + (bestPlot.radius - r) * t;
  }
  return r;
}

// ------------------------------------------------------------ palette

const C = {
  grass: new THREE.Color(0x55a24b),
  grassAlt: new THREE.Color(0x69b352),
  dirt: new THREE.Color(0x7a5230),
  stone: new THREE.Color(0x71727b),
  sand: new THREE.Color(0xdcc57f),
  snow: new THREE.Color(0xe9f0f7),
  waterTop: new THREE.Color(0x3f8fd6),
  waterDeep: new THREE.Color(0x1f5aa0),
};

const MAT_EMPTY = 0, MAT_GRASS = 1, MAT_DIRT = 2, MAT_STONE = 3,
      MAT_SAND = 4, MAT_SNOW = 5, MAT_WATER = 6;

// -------------------------------------------------------- voxelization

export function buildPlanet() {
  const E = Math.ceil(PLANET_RADIUS + AMP + 3);
  const dim = 2 * E + 1;
  const grid = new Uint8Array(dim * dim * dim);
  const idx = (x, y, z) => (x + E) + (y + E) * dim + (z + E) * dim * dim;
  const inBounds = (x, y, z) => x >= -E && x <= E && y >= -E && y <= E && z >= -E && z <= E;

  const dir = new THREE.Vector3();
  for (let x = -E; x <= E; x++) {
    for (let y = -E; y <= E; y++) {
      for (let z = -E; z <= E; z++) {
        const r = Math.sqrt(x * x + y * y + z * z);
        if (r > PLANET_RADIUS + AMP + 2) continue;
        if (r < PLANET_RADIUS - 8) {
          // deep interior is always solid — skip the (expensive) noise
          grid[idx(x, y, z)] = MAT_STONE;
          continue;
        }
        dir.set(x / r, y / r, z / r);
        const tR = terrainRadius(dir);
        if (r <= tR) {
          const depth = tR - r;
          const snowy = Math.abs(dir.y) > 0.74 + (noise.noise3(x * 0.3, y * 0.3, z * 0.3) - 0.5) * 0.12
            || tR > PLANET_RADIUS + 3.3;
          let m;
          if (depth < 1.4) {
            if (tR < SEA_LEVEL + 0.9) m = MAT_SAND;
            else if (snowy) m = MAT_SNOW;
            else m = MAT_GRASS;
          } else if (depth < 3.6) m = MAT_DIRT;
          else m = MAT_STONE;
          grid[idx(x, y, z)] = m;
        } else if (r <= SEA_LEVEL) {
          grid[idx(x, y, z)] = MAT_WATER;
        }
      }
    }
  }

  // ----------------------------------------------------------- meshing

  function makeGeometry(isWater) {
    const positions = [], normals = [], colors = [], indices = [];
    let vi = 0;
    const col = new THREE.Color();

    function pushQuad(cx, cy, cz, axis, sign, color) {
      const n = [0, 0, 0];
      n[axis] = sign;
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const corners = [];
      for (const [du, dv] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        const p = [cx, cy, cz];
        p[axis] += sign * 0.5;
        p[u] += du;
        p[v] += dv;
        corners.push(p);
      }
      // fix winding so the face points along its normal
      const e1 = [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1], corners[1][2] - corners[0][2]];
      const e2 = [corners[2][0] - corners[0][0], corners[2][1] - corners[0][1], corners[2][2] - corners[0][2]];
      const cross = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const dot = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2];
      const order = dot >= 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
      for (const o of order) {
        positions.push(corners[o][0], corners[o][1], corners[o][2]);
        normals.push(n[0], n[1], n[2]);
        colors.push(color.r, color.g, color.b);
      }
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }

    for (let x = -E; x <= E; x++) {
      for (let y = -E; y <= E; y++) {
        for (let z = -E; z <= E; z++) {
          const m = grid[idx(x, y, z)];
          if (m === MAT_EMPTY) continue;
          const water = m === MAT_WATER;
          if (water !== isWater) continue;

          if (water) {
            const r = Math.sqrt(x * x + y * y + z * z);
            const t = Math.min(1, Math.max(0, (SEA_LEVEL - r) / 5));
            col.copy(C.waterTop).lerp(C.waterDeep, t);
          } else {
            const jitter = 0.92 + 0.16 * noise.hash(x, y, z);
            if (m === MAT_GRASS) col.copy(noise.hash(x + 7, y, z) > 0.5 ? C.grass : C.grassAlt);
            else if (m === MAT_DIRT) col.copy(C.dirt);
            else if (m === MAT_STONE) col.copy(C.stone);
            else if (m === MAT_SAND) col.copy(C.sand);
            else col.copy(C.snow);
            col.multiplyScalar(jitter);
          }

          for (const [axis, sign, dx, dy, dz] of [
            [0, 1, 1, 0, 0], [0, -1, -1, 0, 0],
            [1, 1, 0, 1, 0], [1, -1, 0, -1, 0],
            [2, 1, 0, 0, 1], [2, -1, 0, 0, -1],
          ]) {
            const nx = x + dx, ny = y + dy, nz = z + dz;
            const neighbor = inBounds(nx, ny, nz) ? grid[idx(nx, ny, nz)] : MAT_EMPTY;
            const exposed = isWater
              ? neighbor === MAT_EMPTY
              : (neighbor === MAT_EMPTY || neighbor === MAT_WATER);
            if (exposed) pushQuad(x, y, z, axis, sign, col);
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    return geo;
  }

  const group = new THREE.Group();

  const land = new THREE.Mesh(
    makeGeometry(false),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
  );
  land.castShadow = true;
  land.receiveShadow = true;
  group.add(land);

  const water = new THREE.Mesh(
    makeGeometry(true),
    new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.25, metalness: 0.05,
      transparent: true, opacity: 0.82,
    })
  );
  water.receiveShadow = true;
  group.add(water);

  return group;
}

// Deterministic spots for wild life away from plots and sea:
// vegetation (trees, bushes, flowers, grass, mushrooms), rocks, and animals.
const WILD_KINDS = [
  ['tree', 0.30], ['bush', 0.12], ['flower', 0.16], ['grass', 0.14],
  ['rock', 0.09], ['mushroom', 0.05],
  ['sheep', 0.04], ['rabbit', 0.04], ['fox', 0.03], ['chicken', 0.03],
];

function pickKind(t) {
  let acc = 0;
  for (const [kind, w] of WILD_KINDS) {
    acc += w;
    if (t <= acc) return kind;
  }
  return 'tree';
}

// Candidates run pole-to-pole; density is controlled by the hash thinning
// below (never by an early stop, which would cluster life at one pole).
export function wildSpots() {
  const spots = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const n = 1400;
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rr = Math.sqrt(1 - y * y);
    const a = golden * i + noise.hash(i, 3, 7) * 0.5;
    v.set(Math.cos(a) * rr, y, Math.sin(a) * rr).normalize();
    if (Math.abs(v.y) > 0.86) continue;
    const tR = terrainRadius(v);
    if (tR < SEA_LEVEL + 0.95) continue; // anywhere the grass grows
    // keep clear of estate footprints only — the blend ring may stay wild
    let nearPlot = false;
    for (const p of plots) {
      if (v.dot(p.dir) > Math.cos(PLOT_INNER + 0.03)) { nearPlot = true; break; }
    }
    if (nearPlot) continue;
    if (noise.hash(i, 11, 5) < 0.42) continue;
    spots.push({
      dir: v.clone(),
      radius: tR,
      kind: pickKind(noise.hash(i, 2, 9)),
      seed: i,
    });
  }
  return spots;
}
