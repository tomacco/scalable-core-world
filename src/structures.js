// Voxel structures: houses, gardens, avatars, wild decor, name labels.
// Everything is built in a local frame (y-up, ground at y=0) and later
// oriented onto the planet surface by main.js.

import * as THREE from 'three';
import { makeNoise } from './noise.js';

const rng = makeNoise(4711);

// Materials whose brightness main.js modulates with the night factor
// (windows and lamps come alive after sunset).
export const GLOW_MATERIALS = [];

// ------------------------------------------------------------ builder

class VoxelBuilder {
  constructor(scale = 1) {
    this.scale = scale;
    this.solid = new Map();   // "x,y,z" -> THREE.Color
    this.glow = new Map();
    this.cuboids = [];        // free-floating sub-voxel boxes
  }

  key(x, y, z) { return x + ',' + y + ',' + z; }

  box(x, y, z, color, glow = false) {
    (glow ? this.glow : this.solid).set(this.key(x, y, z), new THREE.Color(color));
  }

  unbox(x, y, z) {
    this.solid.delete(this.key(x, y, z));
    this.glow.delete(this.key(x, y, z));
  }

  cuboid(x, y, z, w, h, d, color, glow = false) {
    this.cuboids.push({ x, y, z, w, h, d, color: new THREE.Color(color), glow });
  }

  _emit(map, cuboids) {
    const positions = [], normals = [], colors = [], indices = [];
    let vi = 0;

    const pushQuad = (cx, cy, cz, hx, hy, hz, axis, sign, color) => {
      const n = [0, 0, 0];
      n[axis] = sign;
      const half = [hx, hy, hz];
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const corners = [];
      for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [cx, cy, cz];
        p[axis] += sign * half[axis];
        p[u] += du * half[u];
        p[v] += dv * half[v];
        corners.push(p);
      }
      const e1 = [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1], corners[1][2] - corners[0][2]];
      const e2 = [corners[2][0] - corners[0][0], corners[2][1] - corners[0][1], corners[2][2] - corners[0][2]];
      const cr = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const order = (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2]) >= 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
      for (const o of order) {
        positions.push(corners[o][0] * this.scale, corners[o][1] * this.scale, corners[o][2] * this.scale);
        normals.push(n[0], n[1], n[2]);
        colors.push(color.r, color.g, color.b);
      }
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    };

    const FACES = [
      [0, 1, 1, 0, 0], [0, -1, -1, 0, 0],
      [1, 1, 0, 1, 0], [1, -1, 0, -1, 0],
      [2, 1, 0, 0, 1], [2, -1, 0, 0, -1],
    ];

    for (const [k, color] of map) {
      const [x, y, z] = k.split(',').map(Number);
      for (const [axis, sign, dx, dy, dz] of FACES) {
        if (map.has(this.key(x + dx, y + dy, z + dz))) continue;
        pushQuad(x, y, z, 0.5, 0.5, 0.5, axis, sign, color);
      }
    }
    for (const c of cuboids) {
      for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
        pushQuad(c.x, c.y, c.z, c.w / 2, c.h / 2, c.d / 2, axis, sign, c.color);
      }
    }

    if (vi === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    return geo;
  }

  build() {
    const group = new THREE.Group();
    const meshes = [];

    const solidGeo = this._emit(this.solid, this.cuboids.filter((c) => !c.glow));
    if (solidGeo) {
      const mesh = new THREE.Mesh(
        solidGeo,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      meshes.push(mesh);
    }

    const glowGeo = this._emit(this.glow, this.cuboids.filter((c) => c.glow));
    if (glowGeo) {
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
      GLOW_MATERIALS.push(mat);
      const mesh = new THREE.Mesh(glowGeo, mat);
      group.add(mesh);
      meshes.push(mesh);
    }

    return { group, meshes };
  }
}

// ------------------------------------------------------------- avatar

const HOUSE_SIZES = {
  small: { w: 7, d: 6, h: 4 },
  medium: { w: 9, d: 7, h: 4 },
  large: { w: 11, d: 8, h: 5 },
};

// giant stands eye to eye with a rooftop
const AVATAR_SIZES = { small: 0.42, medium: 0.6, large: 0.8, giant: 0.95 };

export function buildAvatar(avatar = {}) {
  const a = {
    size: 'small',
    skin: '#e0ac69',
    eyes: '#26262e',
    hair: { style: 'short', color: '#2c1b10' },
    beard: false,
    glasses: false,
    glassesColor: '#1b1b22',
    outfit: { type: 'pants', top: '#c94f30', bottom: '#2b3a67', shoes: '#26211c' },
    hat: null,
    ...avatar,
  };
  a.hair = { style: 'short', color: '#2c1b10', ...(avatar.hair || {}) };
  a.outfit = { type: 'pants', top: '#c94f30', bottom: '#2b3a67', shoes: '#26211c', ...(avatar.outfit || {}) };

  const b = new VoxelBuilder(AVATAR_SIZES[a.size] || AVATAR_SIZES.small);

  // shoes + legs / dress
  b.box(-1, 0, 0, a.outfit.shoes);
  b.box(1, 0, 0, a.outfit.shoes);
  if (a.outfit.type === 'dress') {
    for (let x = -2; x <= 2; x++) b.box(x, 1, 0, a.outfit.bottom);
    for (let x = -1; x <= 1; x++) b.box(x, 2, 0, a.outfit.bottom);
  } else {
    for (const x of [-1, 1]) { b.box(x, 1, 0, a.outfit.bottom); b.box(x, 2, 0, a.outfit.bottom); }
  }

  // torso + arms
  for (let y = 3; y <= 5; y++) for (let x = -1; x <= 1; x++) b.box(x, y, 0, a.outfit.top);
  for (const x of [-2, 2]) {
    b.box(x, 5, 0, a.outfit.top);
    b.box(x, 4, 0, a.outfit.top);
    b.box(x, 3, 0, a.skin); // hands
  }

  // head
  for (let y = 6; y <= 8; y++)
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 1; z++) b.box(x, y, z, a.skin);

  // face
  b.cuboid(-0.62, 7.15, 1.55, 0.4, 0.4, 0.18, a.eyes);
  b.cuboid(0.62, 7.15, 1.55, 0.4, 0.4, 0.18, a.eyes);

  if (a.glasses) {
    b.cuboid(-0.62, 7.15, 1.62, 1.0, 1.0, 0.14, a.glassesColor);
    b.cuboid(0.62, 7.15, 1.62, 1.0, 1.0, 0.14, a.glassesColor);
    b.cuboid(0, 7.3, 1.62, 0.4, 0.16, 0.12, a.glassesColor);
  }
  if (a.beard) {
    b.cuboid(0, 6.2, 1.58, 2.6, 1.3, 0.24, a.hair.color);
    b.cuboid(0, 5.55, 1.35, 1.6, 0.5, 0.24, a.hair.color);
  }

  // hair
  const hc = a.hair.color;
  const style = a.hair.style;
  const hasHat = a.hat && a.hat.style && a.hat.style !== 'none';
  if (style !== 'bald' && !hasHat) {
    if (style === 'mohawk') {
      b.cuboid(0, 9.55, 0, 0.8, 1.0, 3.2, hc);
    } else if (style === 'curly') {
      b.cuboid(0, 9.5, 0, 3.5, 1.0, 3.5, hc);
      b.cuboid(-1.85, 8.6, 0, 0.5, 1.6, 3.0, hc);
      b.cuboid(1.85, 8.6, 0, 0.5, 1.6, 3.0, hc);
    } else {
      b.cuboid(0, 9.25, 0, 3.2, 0.55, 3.2, hc); // top slab
    }
    if (style === 'short') b.cuboid(0, 8.5, -1.65, 3.2, 1.4, 0.35, hc);
    if (style === 'long') b.cuboid(0, 6.6, -1.75, 3.2, 5.8, 0.55, hc);
    if (style === 'bun') {
      b.cuboid(0, 8.5, -1.65, 3.2, 1.4, 0.35, hc);
      b.cuboid(0, 9.7, -1.3, 1.2, 1.1, 1.1, hc);
    }
  }

  if (hasHat) {
    const hcol = a.hat.color || '#b8332f';
    if (a.hat.style === 'cap') {
      b.cuboid(0, 9.45, 0, 3.4, 0.8, 3.4, hcol);
      b.cuboid(0, 9.15, 2.05, 2.8, 0.3, 1.1, hcol);
    } else if (a.hat.style === 'beanie') {
      b.cuboid(0, 9.55, 0, 3.4, 1.0, 3.4, hcol);
      b.cuboid(0, 8.85, 0, 3.55, 0.5, 3.55, hcol);
    } else if (a.hat.style === 'crown') {
      b.cuboid(0, 9.5, 0, 3.0, 0.5, 3.0, '#f5c542', true);
      for (const x of [-1.1, 0, 1.1]) b.cuboid(x, 10.0, 0, 0.5, 0.6, 3.0, '#f5c542', true);
    } else if (a.hat.style === 'wizard') {
      b.cuboid(0, 9.6, 0, 3.6, 0.5, 3.6, hcol);
      b.cuboid(0, 10.3, 0, 2.2, 1.0, 2.2, hcol);
      b.cuboid(0, 11.2, 0, 1.1, 1.0, 1.1, hcol);
    }
  }

  return b;
}

// ------------------------------------------------------------- estate

export function buildEstate(config, seed = 1) {
  const house = {
    size: 'medium', wall: '#e8d8b0', roof: '#b5442e',
    door: '#5b3a1e', trim: '#f4efe4', windowsLit: true,
    ...(config.house || {}),
  };
  const garden = {
    trees: 2, flowers: ['#ff5f8f', '#ffd23f'], fence: true,
    lamp: true, path: true, extras: [], platform: 'cozy',
    ...(config.garden || {}),
  };
  const size = HOUSE_SIZES[house.size] || HOUSE_SIZES.medium;
  const { w, d, h } = size;
  const hw = (w - 1) / 2;
  const z0 = -Math.floor(d / 2), z1 = z0 + d - 1;
  const P = garden.platform === 'grand' ? 9 : 7; // platform half-width

  const b = new VoxelBuilder(1);

  // terrace platform
  for (let x = -P; x <= P; x++) {
    for (let z = -P; z <= P; z++) {
      b.box(x, -2, z, '#6e4a2c');
      const g = rng.hash(seed + x, 1, z) > 0.5 ? '#55a24b' : '#69b352';
      b.box(x, -1, z, g);
    }
  }

  // path from door to platform edge
  if (garden.path) {
    for (let z = z1 + 1; z <= P; z++) {
      b.box(0, -1, z, rng.hash(seed, z, 3) > 0.5 ? '#c9c0ae' : '#b8ae9a');
    }
  }

  // walls (hollow shell)
  const wallXs = [], wallZs = [];
  for (let x = -hw; x <= hw; x++) wallXs.push(x);
  for (let z = z0; z <= z1; z++) wallZs.push(z);
  for (let y = 0; y < h; y++) {
    for (const x of wallXs) {
      for (const z of wallZs) {
        const edge = x === -hw || x === hw || z === z0 || z === z1;
        if (!edge) continue;
        const corner = (x === -hw || x === hw) && (z === z0 || z === z1);
        b.box(x, y, z, corner ? house.trim : house.wall);
      }
    }
  }

  // door (front face, +z)
  b.box(0, 0, z1, house.door);
  b.box(0, 1, z1, house.door);
  b.cuboid(0.32, 1.05, z1 + 0.55, 0.16, 0.16, 0.16, '#d8b13a');

  // windows
  const winXs = w >= 11 ? [-4, -2, 2, 4] : [-2, 2];
  const winC = house.windowsLit ? '#ffdf9e' : '#9db8c9';
  for (const x of winXs) {
    b.box(x, 1, z1, winC, house.windowsLit);
    b.box(x, 1, z0, winC, house.windowsLit);
  }
  const sideZ = Math.round((z0 + z1) / 2);
  for (const x of [-hw, hw]) {
    b.box(x, 1, sideZ, winC, house.windowsLit);
    if (h >= 5) b.box(x, 3, sideZ, winC, house.windowsLit);
  }

  // gable roof, stepping in along z
  let layer = 0;
  while (z0 - 1 + layer <= z1 + 1 - layer) {
    const y = h + layer;
    for (let x = -hw - 1; x <= hw + 1; x++) {
      for (let z = z0 - 1 + layer; z <= z1 + 1 - layer; z++) {
        const rim = z === z0 - 1 + layer || z === z1 + 1 - layer;
        if (layer === 0 || rim) b.box(x, y, z, house.roof);
        else if (z0 + layer <= z && z <= z1 - layer && layer > 0) {
          // gable ends filled with wall color
          if (x === -hw || x === hw) b.box(x, y, z, house.wall);
        }
      }
    }
    layer++;
  }

  // chimney
  const chimTop = h + Math.ceil(d / 2) + 1;
  for (let y = h; y <= chimTop; y++) b.box(hw - 1, y, z0 + 1, '#8a8b93');

  // fence
  if (garden.fence) {
    for (let i = -P; i <= P; i += 2) {
      for (const [x, z] of [[i, -P], [i, P], [-P, i], [P, i]]) {
        if (garden.path && z === P && Math.abs(x) <= 1) continue;
        b.box(x, 0, z, '#8f6b40');
        b.cuboid(x, 0.85, z, 0.28, 0.5, 0.28, '#8f6b40');
      }
    }
  }

  // lamp
  if (garden.lamp) {
    const lx = 3, lz = P - 1;
    b.cuboid(lx, 0.9, lz, 0.3, 2.0, 0.3, '#33343c');
    b.box(lx, 2, lz, '#ffd27a', true);
  }

  // trees
  const treeSpots = [[-5, -5], [5, -4], [-5, 4], [4, -6], [-4, 6], [6, 2]];
  const nTrees = Math.min(garden.trees || 0, treeSpots.length);
  for (let i = 0; i < nTrees; i++) {
    const [tx, tz] = treeSpots[i];
    plantTree(b, tx, tz, seed + i * 13);
  }

  // flowers
  const flowerSpots = [[2, 4], [-2, 5], [3, -5], [-3, -4], [6, 5], [-6, -2], [2, -6.5], [-6, 2], [5, 6], [-4, -6]];
  const fcolors = garden.flowers || [];
  if (fcolors.length) {
    for (let i = 0; i < flowerSpots.length; i++) {
      if (rng.hash(seed, i, 21) < 0.25) continue;
      const [fx, fz] = flowerSpots[i];
      const col = fcolors[i % fcolors.length];
      b.cuboid(fx, 0.3, fz, 0.16, 0.6, 0.16, '#3f7a37');
      b.cuboid(fx, 0.75, fz, 0.5, 0.4, 0.5, col);
    }
  }

  // extras
  for (const extra of garden.extras || []) {
    if (extra === 'bench') {
      b.cuboid(-3, 0.45, 6, 2.2, 0.25, 0.9, '#9a713e');
      b.cuboid(-3, 0.95, 6.45, 2.2, 0.8, 0.2, '#9a713e');
      b.cuboid(-3.9, 0.2, 6, 0.2, 0.5, 0.8, '#6e4a2c');
      b.cuboid(-2.1, 0.2, 6, 0.2, 0.5, 0.8, '#6e4a2c');
    } else if (extra === 'mailbox') {
      b.cuboid(1.6, 0.5, 6.6, 0.2, 1.1, 0.2, '#6e4a2c');
      b.cuboid(1.6, 1.25, 6.6, 0.7, 0.55, 1.0, house.roof);
    } else if (extra === 'pond') {
      for (let x = -6; x <= -4; x++) for (let z = -2; z <= -1; z++) b.box(x, -1, z, '#3f8fd6');
      b.box(-6, -1, 0, '#3f8fd6');
    } else if (extra === 'pumpkin') {
      b.cuboid(5.5, 0.4, -6, 0.9, 0.8, 0.9, '#e0761c');
      b.cuboid(5.5, 0.95, -6, 0.2, 0.3, 0.2, '#3f7a37');
    } else if (extra === 'telescope') {
      b.cuboid(-6, 0.7, 6, 0.25, 1.5, 0.25, '#33343c');
      b.cuboid(-6, 1.7, 6.3, 0.4, 0.4, 1.4, '#8a8b93');
    } else if (extra === 'flag') {
      b.cuboid(6.5, 1.6, -6.5, 0.18, 3.4, 0.18, '#8a8b93');
      b.cuboid(6.5 + 0.7, 2.8, -6.5, 1.3, 0.8, 0.1, house.roof);
    }
  }

  const estate = b.build();

  // avatar stands beside the path, greeting visitors
  const av = buildAvatar(config.avatar).build();
  av.group.position.set(2.2, 0, 5.2);
  av.group.rotation.y = 0.5;
  estate.group.add(av.group);
  estate.meshes.push(...av.meshes);

  return { group: estate.group, meshes: estate.meshes, roofY: h + Math.ceil(d / 2) + 3 };
}

function plantTree(b, tx, tz, seed) {
  const trunkH = 2 + (rng.hash(seed, 1, 1) > 0.5 ? 1 : 0);
  for (let y = 0; y < trunkH; y++) b.box(tx, y, tz, '#6b4a2a');
  const leaf1 = rng.hash(seed, 2, 2) > 0.5 ? '#3e8a3e' : '#4c9b45';
  const leaf2 = '#5fae4f';
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      for (let y = 0; y <= 1; y++) {
        if (Math.abs(x) === 1 && Math.abs(z) === 1 && y === 1) continue;
        b.box(tx + x, trunkH + y, tz + z, rng.hash(seed + x, y, z) > 0.5 ? leaf1 : leaf2);
      }
    }
  }
  b.box(tx, trunkH + 2, tz, leaf2);
}

// --------------------------------------------------------- wild decor

const WILD_FLOWER_COLORS = ['#ff5f8f', '#ffd23f', '#7ec8e3', '#e06bd7', '#ff8c42', '#f4f1de'];

export function buildWildDecor(spot) {
  const s = spot.seed;
  const b = new VoxelBuilder(1);

  switch (spot.kind) {
    case 'tree':
      plantTree(b, 0, 0, s);
      break;

    case 'bush': {
      const leaf = rng.hash(s, 1, 1) > 0.5 ? '#3e8a3e' : '#5fae4f';
      b.cuboid(0, 0.5, 0, 1.8, 1.1, 1.8, leaf);
      b.cuboid(0.6, 1.1, 0.4, 1.0, 0.7, 1.0, '#4c9b45');
      b.cuboid(-0.6, 1.0, -0.3, 0.9, 0.6, 0.9, leaf);
      if (rng.hash(s, 2, 2) > 0.6) b.cuboid(0.4, 1.0, -0.5, 0.25, 0.25, 0.25, '#d64545'); // berries
      break;
    }

    case 'flower': {
      const clusters = 1 + Math.floor(rng.hash(s, 3, 1) * 3);
      for (let i = 0; i < clusters; i++) {
        const fx = (rng.hash(s, i, 4) - 0.5) * 2.4;
        const fz = (rng.hash(s, i, 5) - 0.5) * 2.4;
        const col = WILD_FLOWER_COLORS[Math.floor(rng.hash(s, i, 6) * WILD_FLOWER_COLORS.length)];
        b.cuboid(fx, 0.3, fz, 0.14, 0.6, 0.14, '#3f7a37');
        b.cuboid(fx, 0.75, fz, 0.45, 0.35, 0.45, col);
      }
      break;
    }

    case 'grass': {
      const tufts = 2 + Math.floor(rng.hash(s, 4, 1) * 3);
      for (let i = 0; i < tufts; i++) {
        const gx = (rng.hash(s, i, 7) - 0.5) * 2.2;
        const gz = (rng.hash(s, i, 8) - 0.5) * 2.2;
        const h = 0.7 + rng.hash(s, i, 9) * 0.7;
        b.cuboid(gx, h / 2, gz, 0.16, h, 0.16, rng.hash(s, i, 10) > 0.5 ? '#6cae4f' : '#7dbf5a');
      }
      break;
    }

    case 'mushroom': {
      b.cuboid(0, 0.35, 0, 0.3, 0.7, 0.3, '#e8ddc8');
      b.cuboid(0, 0.8, 0, 0.9, 0.4, 0.9, '#c23b3b');
      b.cuboid(-0.2, 1.02, 0.15, 0.18, 0.1, 0.18, '#f4efe4');
      if (rng.hash(s, 5, 1) > 0.5) {
        b.cuboid(0.7, 0.25, 0.4, 0.2, 0.5, 0.2, '#e8ddc8');
        b.cuboid(0.7, 0.55, 0.4, 0.55, 0.28, 0.55, '#c23b3b');
      }
      break;
    }

    case 'rock':
      b.cuboid(0, 0.4, 0, 1.6, 1.1, 1.4, '#7d7e87');
      b.cuboid(0.8, 0.2, 0.5, 0.9, 0.7, 0.9, '#6a6b74');
      break;

    // ----------------------------------------------- small animals
    case 'sheep': {
      const wool = '#efeae0';
      b.cuboid(0, 0.9, 0, 1.7, 1.0, 1.1, wool);       // fluffy body
      b.cuboid(0, 1.45, 0.1, 1.2, 0.35, 0.8, wool);   // wool top
      b.cuboid(1.05, 1.15, 0, 0.6, 0.55, 0.55, '#3a3630'); // head
      b.cuboid(1.25, 1.4, 0, 0.5, 0.2, 0.7, wool);    // wool cap
      for (const [lx, lz] of [[-0.55, -0.35], [-0.55, 0.35], [0.55, -0.35], [0.55, 0.35]])
        b.cuboid(lx, 0.25, lz, 0.22, 0.5, 0.22, '#3a3630');
      break;
    }

    case 'rabbit': {
      const fur = rng.hash(s, 6, 1) > 0.5 ? '#d9cbb6' : '#b9a58c';
      b.cuboid(0, 0.4, 0, 0.9, 0.6, 0.6, fur);        // body
      b.cuboid(0.45, 0.75, 0, 0.45, 0.45, 0.45, fur); // head
      b.cuboid(0.38, 1.25, -0.12, 0.14, 0.6, 0.14, fur); // ears
      b.cuboid(0.38, 1.25, 0.12, 0.14, 0.6, 0.14, fur);
      b.cuboid(-0.5, 0.5, 0, 0.2, 0.2, 0.2, '#f4efe4'); // tail
      break;
    }

    case 'fox': {
      const coat = '#d1662a';
      b.cuboid(0, 0.5, 0, 1.5, 0.6, 0.6, coat);       // body
      b.cuboid(0.85, 0.75, 0, 0.5, 0.45, 0.45, coat); // head
      b.cuboid(1.15, 0.65, 0, 0.3, 0.22, 0.22, '#f4efe4'); // snout
      b.cuboid(0.78, 1.1, -0.14, 0.14, 0.3, 0.1, coat);    // ears
      b.cuboid(0.78, 1.1, 0.14, 0.14, 0.3, 0.1, coat);
      b.cuboid(-0.95, 0.55, 0, 0.7, 0.3, 0.3, coat);  // tail
      b.cuboid(-1.25, 0.55, 0, 0.2, 0.26, 0.26, '#f4efe4'); // tail tip
      for (const [lx, lz] of [[-0.4, -0.2], [-0.4, 0.2], [0.5, -0.2], [0.5, 0.2]])
        b.cuboid(lx, 0.15, lz, 0.16, 0.3, 0.16, '#8a4418');
      break;
    }

    case 'chicken': {
      b.cuboid(0, 0.55, 0, 0.8, 0.6, 0.6, '#f4efe4'); // body
      b.cuboid(0.4, 0.95, 0, 0.4, 0.4, 0.4, '#f4efe4'); // head
      b.cuboid(0.62, 0.9, 0, 0.18, 0.12, 0.12, '#e8a33d'); // beak
      b.cuboid(0.4, 1.2, 0, 0.12, 0.16, 0.2, '#d64545');   // comb
      b.cuboid(-0.1, 0.15, -0.12, 0.1, 0.3, 0.1, '#e8a33d'); // legs
      b.cuboid(-0.1, 0.15, 0.12, 0.1, 0.3, 0.1, '#e8a33d');
      break;
    }

    default:
      plantTree(b, 0, 0, s);
  }

  return b.build();
}

// -------------------------------------------------------- name labels

export function makeLabel(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '500 44px "IBM Plex Mono", monospace';
  ctx.font = font;
  const tw = ctx.measureText(text).width;
  canvas.width = Math.ceil(tw + 76);
  canvas.height = 96;
  const c2 = canvas.getContext('2d');

  c2.fillStyle = 'rgba(8, 10, 20, 0.78)';
  const r = 18, x = 4, y = 18, w = canvas.width - 8, h = 62;
  c2.beginPath();
  c2.roundRect(x, y, w, h, r);
  c2.fill();
  c2.strokeStyle = 'rgba(232, 180, 74, 0.65)';
  c2.lineWidth = 2;
  c2.stroke();

  c2.fillStyle = '#e8b44a';
  c2.beginPath();
  c2.moveTo(canvas.width / 2, 96); c2.lineTo(canvas.width / 2 - 9, 80); c2.lineTo(canvas.width / 2 + 9, 80);
  c2.fill();

  c2.font = font;
  c2.fillStyle = '#e8e4d8';
  c2.textAlign = 'center';
  c2.textBaseline = 'middle';
  c2.fillText(text, canvas.width / 2, y + h / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(3.2 * aspect, 3.2, 1);
  return sprite;
}
