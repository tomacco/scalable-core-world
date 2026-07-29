// The tiny planet: a voxelized sphere with oceans, beaches, grasslands,
// snow caps — and N flattened plots where contributors settle.

import * as THREE from 'three';
import { makeNoise } from './noise.js';

export const PLANET_RADIUS = 46;
export const SEA_LEVEL = 46.0;
export const PLOT_COUNT = 24;

const AMP = 5.2;              // terrain amplitude in voxels
export const PLOT_INNER = 0.20; // radians: fully flat plot cap (estate + lawn)
const PLOT_OUTER = 0.30;      // radians: blend back into wild terrain

const noise = makeNoise(20260728);

// ---------------------------------------------------------------- plots

function fibonacciPlots() {
  const candidates = [];
  const n = 300; // dense candidate field: 24 strided picks land ≥ 0.58 rad apart
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    candidates.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  // keep a temperate band — poles stay wild (snow + aurora country)
  const band = candidates.filter((v) => Math.abs(v.y) < 0.72);
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

// Scalar core of the terrain field: the voxel fill calls this hundreds of
// thousands of times, so it takes plain numbers and allocates nothing.
function terrainRadiusXYZ(dx, dy, dz) {
  const continents = noise.fbm(dx * 1.9 + 7.3, dy * 1.9, dz * 1.9, 3);
  const detail = noise.fbm(dx * 5.2, dy * 5.2 + 3.1, dz * 5.2, 4);
  let r = PLANET_RADIUS - 1.1 + (continents - 0.5) * 2 * AMP + (detail - 0.5) * 2.4;
  // flatten toward the nearest plot
  let best = -2, bestPlot = null;
  for (const p of plots) {
    const d = dx * p.dir.x + dy * p.dir.y + dz * p.dir.z;
    if (d > best) { best = d; bestPlot = p; }
  }
  if (bestPlot && best > COS_OUTER) {
    const t = smoothstep(COS_OUTER, COS_INNER, best);
    r = r + (bestPlot.radius - r) * t;
  }
  return r;
}

export function terrainRadius(dir) {
  return terrainRadiusXYZ(dir.x, dir.y, dir.z);
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

// The six cube faces, precomputed once: outward normal, neighbor offset, and
// the four corner offsets already in winding order (derived by the same
// cross-product test the meshers used to run per quad).
const FACES = (() => {
  const faces = [];
  for (const [axis, sign, dx, dy, dz] of [
    [0, 1, 1, 0, 0], [0, -1, -1, 0, 0],
    [1, 1, 0, 1, 0], [1, -1, 0, -1, 0],
    [2, 1, 0, 0, 1], [2, -1, 0, 0, -1],
  ]) {
    const n = [0, 0, 0];
    n[axis] = sign;
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    const corners = [];
    for (const [du, dv] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const p = [0, 0, 0];
      p[axis] += sign * 0.5;
      p[u] += du;
      p[v] += dv;
      corners.push(p);
    }
    const e1 = [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1], corners[1][2] - corners[0][2]];
    const e2 = [corners[2][0] - corners[0][0], corners[2][1] - corners[0][1], corners[2][2] - corners[0][2]];
    const cross = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const dot = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2];
    const order = dot >= 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
    faces.push({ n, dx, dy, dz, corners: order.map((o) => corners[o]) });
  }
  return faces;
})();

// -------------------------------------------------------- voxelization

export function buildPlanet() {
  const E = Math.ceil(PLANET_RADIUS + AMP + 3);
  const dim = 2 * E + 1;
  const grid = new Uint8Array(dim * dim * dim);
  const idx = (x, y, z) => (x + E) + (y + E) * dim + (z + E) * dim * dim;

  // squared radii let the two cheap classifications skip the sqrt entirely,
  // and TR_MAX is the ceiling of every possible terrain radius (raw field at
  // full amplitude; plot flattening only pulls toward values below it) —
  // beyond it a voxel can be neither land nor water (sea level is far lower),
  // so the expensive noise field never needs sampling there
  const OUTER2 = (PLANET_RADIUS + AMP + 2) ** 2;
  const CORE2 = (PLANET_RADIUS - 8) ** 2;
  const TR_MAX = PLANET_RADIUS - 1.1 + AMP + 1.2;

  for (let x = -E; x <= E; x++) {
    for (let y = -E; y <= E; y++) {
      for (let z = -E; z <= E; z++) {
        const r2 = x * x + y * y + z * z;
        if (r2 > OUTER2) continue;
        if (r2 < CORE2) {
          // deep interior is always solid — skip the (expensive) noise
          grid[idx(x, y, z)] = MAT_STONE;
          continue;
        }
        const r = Math.sqrt(r2);
        if (r > TR_MAX) continue;
        const dx = x / r, dy = y / r, dz = z / r;
        const tR = terrainRadiusXYZ(dx, dy, dz);
        if (r <= tR) {
          const depth = tR - r;
          let m;
          if (depth < 1.4) {
            if (tR < SEA_LEVEL + 0.9) m = MAT_SAND;
            else {
              // snow line noise only matters on this one surface branch
              const snowy = Math.abs(dy) > 0.74 + (noise.noise3(x * 0.3, y * 0.3, z * 0.3) - 0.5) * 0.12
                || tR > PLANET_RADIUS + 3.3;
              m = snowy ? MAT_SNOW : MAT_GRASS;
            }
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
  // One scan of the grid feeds both geometries: every exposed face is
  // appended to its material's buffers, so land and water come out in the
  // same order two dedicated passes would have produced.

  function makeSink() {
    return { positions: [], normals: [], colors: [], indices: [], vi: 0 };
  }

  function pushQuad(sink, cx, cy, cz, face, color) {
    const { positions, normals, colors, indices } = sink;
    const n = face.n, corners = face.corners;
    for (let o = 0; o < 4; o++) {
      const c = corners[o];
      positions.push(cx + c[0], cy + c[1], cz + c[2]);
      normals.push(n[0], n[1], n[2]);
      colors.push(color.r, color.g, color.b);
    }
    const vi = sink.vi;
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    sink.vi += 4;
  }

  const landSink = makeSink();
  const waterSink = makeSink();
  const col = new THREE.Color();

  for (let x = -E; x <= E; x++) {
    for (let y = -E; y <= E; y++) {
      for (let z = -E; z <= E; z++) {
        const m = grid[idx(x, y, z)];
        if (m === MAT_EMPTY) continue;
        const water = m === MAT_WATER;

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

        const sink = water ? waterSink : landSink;
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.dx, ny = y + face.dy, nz = z + face.dz;
          const inB = nx >= -E && nx <= E && ny >= -E && ny <= E && nz >= -E && nz <= E;
          const neighbor = inB ? grid[idx(nx, ny, nz)] : MAT_EMPTY;
          const exposed = water
            ? neighbor === MAT_EMPTY
            : (neighbor === MAT_EMPTY || neighbor === MAT_WATER);
          if (exposed) pushQuad(sink, x, y, z, face, col);
        }
      }
    }
  }

  function sinkToGeometry(sink) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(sink.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(sink.normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(sink.colors, 3));
    geo.setIndex(sink.indices);
    return geo;
  }

  const group = new THREE.Group();

  const land = new THREE.Mesh(
    sinkToGeometry(landSink),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
  );
  land.castShadow = true;
  land.receiveShadow = true;
  group.add(land);

  const water = new THREE.Mesh(
    sinkToGeometry(waterSink),
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
  const n = 2050; // scaled with surface area so the wilds stay as dense as before
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
