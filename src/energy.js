// The power layer: a hilltop wind farm, an offshore turbine string, a fenced
// substation, and a pylon line carrying sagging cables toward the settlements.
// Everything is seeded and static except the rotors, which spin with the
// planetary wind, and the aviation beacons, which blink red after dark.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise } from './noise.js';
import { plots, terrainRadius, SEA_LEVEL, PLOT_INNER } from './planet.js';
import { VoxelBuilder, SOLID_MATERIAL } from './structures.js';

const rng = makeNoise(5060); // the grid hums between 50 and 60 Hz

// Beacons and lamps get their own materials so update() can drive them
// independently of the house windows: beacons blink, lamps burn steady.
const BEACON_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x551512 });
const LAMP_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x4a3512 });
const CABLE_MATERIAL = new THREE.LineBasicMaterial({ color: 0x23262e, transparent: true, opacity: 0.85 });

const TOWER_H = 11;   // turbine tower height in voxels
const PYLON_H = 7.25; // cable attach height on a pylon

// ------------------------------------------------------------- survey
// Site selection runs at import time, like planet.js's plots, so the wilds
// can keep clear of the machines (main.js filters wildSpots through
// energyClear) without planet.js ever importing this module.

function candidateDirs() {
  const list = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const n = 900;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i + rng.hash(i, 1, 1) * 0.4;
    list.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).normalize());
  }
  return list;
}

function clearOfPlots(dir, margin) {
  const limit = Math.cos(PLOT_INNER + margin);
  for (const p of plots) if (dir.dot(p.dir) > limit) return false;
  return true;
}

function tangentFrame(dir) {
  let e1 = new THREE.Vector3(0, 1, 0).cross(dir);
  if (e1.lengthSq() < 0.01) e1 = new THREE.Vector3(1, 0, 0).cross(dir);
  e1.normalize();
  const e2 = dir.clone().cross(e1).normalize();
  return { e1, e2 };
}

// The wind farm anchors on the tallest clear hill and gathers up to five
// machines on whatever open ground the terrain offers around it — spaced so
// no rotor sweeps through a neighbor's.
function findFarm(cands) {
  let anchor = null, bestR = -1;
  for (const c of cands) {
    if (Math.abs(c.y) > 0.62) continue;
    const r = terrainRadius(c);
    if (r > bestR && r > SEA_LEVEL + 1.2 && clearOfPlots(c, 0.06)) { bestR = r; anchor = c; }
  }
  if (!anchor) return { center: new THREE.Vector3(0, 1, 0), spots: [] };
  const spots = [];
  const nearAnchor = cands
    .filter((c) => Math.abs(c.y) < 0.7)
    .filter((c) => c.dot(anchor) > Math.cos(0.40))
    .filter((c) => terrainRadius(c) > SEA_LEVEL + 0.8 && clearOfPlots(c, 0.04))
    .sort((a, b) => b.dot(anchor) - a.dot(anchor));
  for (const c of nearAnchor) {
    let apart = true;
    for (const s of spots) if (c.dot(s) > Math.cos(0.15)) { apart = false; break; }
    if (apart) spots.push(c.clone());
    if (spots.length === 5) break;
  }
  return { center: anchor.clone(), spots };
}

// Three turbines in the nearest open water, spaced apart, not so close to the
// farm that they crowd its shoreline and not so far they read as strays.
function findOffshore(cands, farmCenter) {
  const picked = [];
  const sea = cands
    .filter((c) => Math.abs(c.y) < 0.7)
    .filter((c) => terrainRadius(c) < SEA_LEVEL - 1.2)
    .filter((c) => clearOfPlots(c, 0.05))
    .sort((a, b) => b.dot(farmCenter) - a.dot(farmCenter));
  for (const c of sea) {
    const d = c.dot(farmCenter);
    if (d > Math.cos(0.30) || d < Math.cos(1.1)) continue;
    let apart = true;
    for (const p of picked) if (c.dot(p) > Math.cos(0.17)) { apart = false; break; }
    if (apart) picked.push(c.clone());
    if (picked.length === 3) break;
  }
  return picked;
}

// The substation lands on the patch of clear ground nearest the farm.
function findSubstation(cands, farmCenter) {
  let best = null, bestDot = -2;
  for (const c of cands) {
    if (terrainRadius(c) < SEA_LEVEL + 1.2) continue;
    if (!clearOfPlots(c, 0.06)) continue;
    const d = c.dot(farmCenter);
    if (d > Math.cos(0.16)) continue; // not on the farm mesa itself
    if (d > bestDot) { bestDot = d; best = c; }
  }
  return (best || farmCenter).clone();
}

// The distribution line: pylons hopscotch from the substation through the
// outskirts of the nearest settlements — a doorstep pylon per plot, midpoint
// pylons on the long hops, power delivered without ever touching a lawn.
// A step that lands in water is skipped; the cable simply spans the gap.
function planRoute(sub) {
  const near = [...plots].sort((a, b) => b.dir.dot(sub) - a.dir.dot(sub)).slice(0, 4);
  const towers = [];
  const v = new THREE.Vector3();
  let prev = sub;

  function addTower(dir) {
    const r = terrainRadius(dir);
    if (r < SEA_LEVEL + 0.7) return;
    towers.push({ dir: dir.clone(), radius: r });
  }

  for (const p of near) {
    if (towers.length >= 7) break;
    const total = Math.acos(THREE.MathUtils.clamp(prev.dot(p.dir), -1, 1));
    if (total < 0.30) continue; // this doorstep is already on the line
    v.copy(prev).lerp(p.dir, 1 - 0.24 / total).normalize(); // 0.24 rad short of the plot
    if (!clearOfPlots(v, 0.03)) continue;
    const doorstep = v.clone();
    const hop = Math.acos(THREE.MathUtils.clamp(prev.dot(doorstep), -1, 1));
    const mids = Math.floor(hop / 0.18);
    for (let s = 1; s <= mids && towers.length < 7; s++) {
      v.copy(prev).lerp(doorstep, s / (mids + 1)).normalize();
      if (clearOfPlots(v, 0.03)) addTower(v);
    }
    if (towers.length < 8) addTower(doorstep);
    prev = doorstep;
  }
  return { towers };
}

const SITES = (() => {
  const cands = candidateDirs();
  const farm = findFarm(cands);
  const offshore = findOffshore(cands, farm.center);
  const substation = findSubstation(cands, farm.center);
  const route = planRoute(substation);
  return { farm, offshore, substation, route };
})();

// Wild vegetation and animals keep out of the machines' footprints.
const BLOCKED = [];
for (const s of SITES.farm.spots) BLOCKED.push({ dir: s, cos: Math.cos(0.10) });
for (const s of SITES.offshore) BLOCKED.push({ dir: s, cos: Math.cos(0.08) });
BLOCKED.push({ dir: SITES.substation, cos: Math.cos(0.16) });
for (const t of SITES.route.towers) BLOCKED.push({ dir: t.dir, cos: Math.cos(0.06) });

export function energyClear(dir) {
  for (const s of BLOCKED) if (dir.dot(s.dir) > s.cos) return false;
  return true;
}

// ------------------------------------------------------- voxel models
// Local frame: y-up, ground at y=0, like every structure in structures.js.

function geomOf(builder) {
  return builder.build().meshes[0].geometry;
}

function buildTurbineSolid(offshore) {
  const b = new VoxelBuilder(1);
  // offshore monopile: the yellow transition piece rising out of the swell
  if (offshore) b.cuboid(0, -2.0, 0, 1.5, 5.2, 1.5, '#d9b32c');
  b.cuboid(0, 0.2, 0, 2.3, 0.5, 2.3, '#9aa0a8');
  for (let y = 0; y < TOWER_H; y++) {
    const w = 1.18 - (y / TOWER_H) * 0.55;
    b.cuboid(0, y + 0.7, 0, w, 1.04, w, y % 2 ? '#e9edf1' : '#e2e7ec');
  }
  b.cuboid(0, TOWER_H + 1.0, -0.2, 1.05, 1.0, 2.2, '#d8dde2'); // nacelle
  b.cuboid(0, TOWER_H + 1.0, -1.45, 0.7, 0.7, 0.3, '#3a3f47'); // cooling tail
  return geomOf(b);
}

const TURBINE_HUB = new THREE.Vector3(0, TOWER_H + 1.0, 1.1);
const TURBINE_BEACON = new THREE.Vector3(0, TOWER_H + 1.7, -0.5);
const TURBINE_CABLE = new THREE.Vector3(0, TOWER_H - 0.3, -0.9);

// Blades and hub are identical on every turbine, so the rotor geometry is
// built once and shared: three tapering blades 120° apart around local +z.
function buildRotorGeometry() {
  const hub = new VoxelBuilder(1);
  hub.cuboid(0, 0, 0.1, 0.66, 0.66, 0.55, '#cfd4da');
  hub.cuboid(0, 0, 0.5, 0.4, 0.4, 0.28, '#aeb4bc');
  const blade = new VoxelBuilder(1);
  blade.cuboid(0, 1.5, 0.1, 0.4, 2.4, 0.16, '#e9edf1');
  blade.cuboid(0, 3.3, 0.1, 0.3, 1.4, 0.12, '#e2e7ec');
  blade.cuboid(0, 4.2, 0.1, 0.2, 0.5, 0.10, '#dbe1e7');
  const parts = [geomOf(hub)];
  const bladeGeo = geomOf(blade);
  for (let k = 0; k < 3; k++) {
    parts.push(bladeGeo.clone().applyMatrix4(new THREE.Matrix4().makeRotationZ((k * 2 * Math.PI) / 3)));
  }
  return mergeGeometries(parts);
}

function buildPylonSolid() {
  const b = new VoxelBuilder(1);
  b.cuboid(0, 0.15, 0, 1.9, 0.4, 1.9, '#7d828c');
  // crossed tapering slabs read as lattice from every angle
  for (let y = 0; y < 7; y++) {
    const w = 1.35 - y * 0.13;
    b.cuboid(0, y + 0.6, 0, w, 1.04, 0.36, '#8b909a');
    b.cuboid(0, y + 0.6, 0, 0.36, 1.04, w, '#868b95');
  }
  b.cuboid(0, 6.1, 0, 4.8, 0.3, 0.3, '#8b909a');
  b.cuboid(0, 7.1, 0, 3.4, 0.3, 0.3, '#8b909a');
  for (const x of [-2.2, 2.2]) b.cuboid(x, 5.7, 0, 0.2, 0.55, 0.2, '#e6e6ee');
  for (const x of [-1.5, 1.5]) b.cuboid(x, 6.7, 0, 0.2, 0.55, 0.2, '#e6e6ee');
  b.cuboid(0, 7.9, 0, 0.26, 1.3, 0.26, '#8b909a');
  return geomOf(b);
}

const PYLON_CABLE = new THREE.Vector3(0, PYLON_H, 0);

function buildSubstationSolid() {
  const b = new VoxelBuilder(1);
  // gravel pad, dug three voxels deep so it seats into sloping ground
  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) {
      b.box(x, -1, z, rng.hash(x, 77, z) > 0.5 ? '#9b9ca4' : '#8f9097');
      b.box(x, -2, z, '#6e6f77');
      b.box(x, -3, z, '#6e6f77');
    }
  }
  // perimeter fence with a gate gap on +z
  for (let i = -4; i <= 4; i += 2) {
    for (const [x, z] of [[i, -4], [i, 4], [-4, i], [4, i]]) {
      if (x === 0 && z === 4) continue;
      b.cuboid(x, 0.6, z, 0.16, 1.3, 0.16, '#a7abb3');
    }
  }
  b.cuboid(0, 1.15, -4, 8.2, 0.1, 0.1, '#a7abb3');
  b.cuboid(-4, 1.15, 0, 0.1, 0.1, 8.2, '#a7abb3');
  b.cuboid(4, 1.15, 0, 0.1, 0.1, 8.2, '#a7abb3');
  for (const x of [-2.7, 2.7]) b.cuboid(x, 1.15, 4, 2.6, 0.1, 0.1, '#a7abb3');
  // two transformers: tank, cooling fins, porcelain bushings
  for (const tx of [-1.9, 0.6]) {
    b.cuboid(tx, 0.85, -1.6, 1.8, 1.7, 1.4, '#5f7268');
    b.cuboid(tx, 0.75, -2.45, 1.6, 1.2, 0.2, '#4e5f57');
    for (const bx of [-0.5, 0, 0.5]) {
      b.cuboid(tx + bx, 2.0, -1.6, 0.16, 0.6, 0.16, '#e6e6ee');
      b.cuboid(tx + bx, 2.35, -1.6, 0.24, 0.12, 0.24, '#c9ced4');
    }
  }
  // control hut
  b.cuboid(2.7, 0.8, 0.6, 1.9, 1.6, 1.5, '#d8d0b8');
  b.cuboid(2.7, 1.75, 0.6, 2.1, 0.3, 1.7, '#7a5230');
  // dead-end gantry where the lines land (+z, toward the pylon route)
  for (const gx of [-1.7, 1.7]) b.cuboid(gx, 2.4, 3.1, 0.3, 4.8, 0.3, '#8b909a');
  b.cuboid(0, 4.75, 3.1, 3.9, 0.3, 0.3, '#8b909a');
  // yard lamp pole
  b.cuboid(-3.2, 1.1, 3.2, 0.2, 2.2, 0.2, '#33343c');
  return geomOf(b);
}

const SUB_CABLE = new THREE.Vector3(0, 4.9, 3.1);
const SUB_LAMP = new THREE.Vector3(-3.2, 2.45, 3.2);
const SUB_WINDOW = new THREE.Vector3(2.4, 0.95, 1.38);

// ----------------------------------------------------------- assembly

const UP = new THREE.Vector3(0, 1, 0);

function placementQuat(dir, yaw) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
  return q;
}

function placementMatrix(dir, radius, yaw, scale) {
  return new THREE.Matrix4().compose(
    dir.clone().multiplyScalar(radius),
    placementQuat(dir, yaw),
    new THREE.Vector3(scale, scale, scale)
  );
}

// Yaw (about `dir`) that turns a structure's local +z to face `toward`.
function yawToward(dir, toward) {
  const z0 = new THREE.Vector3(0, 0, 1).applyQuaternion(placementQuat(dir, 0));
  const zd = toward.clone().addScaledVector(dir, -toward.dot(dir));
  if (zd.lengthSq() < 1e-6) return 0;
  zd.normalize();
  return Math.atan2(z0.clone().cross(zd).dot(dir), z0.dot(zd));
}

// Spans follow the great circle between attach points (a straight chord would
// dive through the planet on long water crossings) and droop with span length.
function pushSpan(pts, A, B) {
  const An = A.clone().normalize(), Bn = B.clone().normalize();
  const rA = A.length(), rB = B.length();
  const span = A.distanceTo(B);
  const segs = Math.max(6, Math.min(16, Math.round(span / 1.2)));
  const sag = Math.min(1.4, 0.12 * span);
  const p = new THREE.Vector3();
  for (let s = 0; s < segs; s++) {
    for (const t of [s / segs, (s + 1) / segs]) {
      p.copy(An).lerp(Bn, t).normalize()
        .multiplyScalar(THREE.MathUtils.lerp(rA, rB, t) - Math.sin(Math.PI * t) * sag);
      pts.push(p.x, p.y, p.z);
    }
  }
}

// The headline: raise every machine, merge all the static voxels into one
// mesh, string the cables, and hand back the group plus its animator.
export function buildEnergyGrid() {
  const group = new THREE.Group();
  const staticGeos = [];
  const beaconGeos = [];
  const lampGeos = [];
  const rotors = [];
  const rotorGeo = buildRotorGeometry();

  // the planetary wind: one seeded direction every rotor faces into
  const windA = rng.hash(3, 1, 4) * Math.PI * 2;
  const wind = new THREE.Vector3(Math.cos(windA), (rng.hash(1, 5, 9) - 0.5) * 0.4, Math.sin(windA)).normalize();

  const farmNodes = [];
  const seaNodes = [];

  function raiseTurbine(dir, radius, scale, offshore, seed) {
    const yaw = yawToward(dir, wind) + (rng.hash(seed, 2, 6) - 0.5) * 0.2;
    const m = placementMatrix(dir, radius, yaw, scale);
    staticGeos.push(buildTurbineSolid(offshore).applyMatrix4(m));
    beaconGeos.push(new THREE.BoxGeometry(0.44, 0.3, 0.44)
      .translate(TURBINE_BEACON.x, TURBINE_BEACON.y, TURBINE_BEACON.z).applyMatrix4(m));

    const rotor = new THREE.Mesh(rotorGeo, SOLID_MATERIAL);
    rotor.castShadow = true;
    rotor.position.copy(TURBINE_HUB).applyMatrix4(m);
    rotor.scale.setScalar(scale);
    group.add(rotor);
    rotors.push({
      mesh: rotor,
      baseQ: placementQuat(dir, yaw),
      angle: rng.hash(seed, 7, 3) * Math.PI * 2,
      speed: 0.55 + rng.hash(seed, 8, 1) * 0.4,
    });

    (offshore ? seaNodes : farmNodes).push(TURBINE_CABLE.clone().applyMatrix4(m));
  }

  // the hilltop farm, each machine a touch different in stature
  SITES.farm.spots.forEach((dir, i) => {
    raiseTurbine(dir, terrainRadius(dir) + 0.3, 0.72 + rng.hash(40 + i, 9, 2) * 0.08, false, 40 + i);
  });

  // the offshore string, monopiles planted just under the swell
  SITES.offshore.forEach((dir, i) => {
    raiseTurbine(dir, SEA_LEVEL - 0.4, 0.68, true, 80 + i);
  });

  // the substation, gantry turned toward the pylon route
  const sub = SITES.substation;
  const routeTowers = SITES.route.towers;
  const subFace = routeTowers.length ? routeTowers[0].dir : SITES.farm.center;
  const subM = placementMatrix(sub, terrainRadius(sub) + 0.4, yawToward(sub, subFace), 1.0);
  staticGeos.push(buildSubstationSolid().applyMatrix4(subM));
  lampGeos.push(new THREE.BoxGeometry(0.4, 0.34, 0.4)
    .translate(SUB_LAMP.x, SUB_LAMP.y, SUB_LAMP.z).applyMatrix4(subM));
  lampGeos.push(new THREE.BoxGeometry(0.5, 0.5, 0.12)
    .translate(SUB_WINDOW.x, SUB_WINDOW.y, SUB_WINDOW.z).applyMatrix4(subM));
  const subNode = SUB_CABLE.clone().applyMatrix4(subM);

  // the pylon march
  const routeNodes = [subNode];
  const pylonGeo = buildPylonSolid();
  for (const t of routeTowers) {
    const yaw = yawToward(t.dir, sub) + Math.PI / 2; // arms perpendicular to the line
    const m = placementMatrix(t.dir, t.radius + 0.3, yaw, 1.0);
    staticGeos.push(pylonGeo.clone().applyMatrix4(m));
    routeNodes.push(PYLON_CABLE.clone().applyMatrix4(m));
  }

  // cables: farm daisy-chain into the gantry, pylons marching out, and the
  // offshore string chained to itself (its export cable runs under the sea)
  const pts = [];
  const farmChain = [...farmNodes, subNode];
  for (let i = 0; i + 1 < farmChain.length; i++) pushSpan(pts, farmChain[i], farmChain[i + 1]);
  for (let i = 0; i + 1 < routeNodes.length; i++) pushSpan(pts, routeNodes[i], routeNodes[i + 1]);
  for (let i = 0; i + 1 < seaNodes.length; i++) pushSpan(pts, seaNodes[i], seaNodes[i + 1]);
  if (pts.length) {
    const cableGeo = new THREE.BufferGeometry();
    cableGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(cableGeo, CABLE_MATERIAL));
  }

  // one draw call for every static voxel in the power layer
  if (staticGeos.length) {
    const solid = new THREE.Mesh(mergeGeometries(staticGeos), SOLID_MATERIAL);
    solid.castShadow = true;
    solid.receiveShadow = true;
    group.add(solid);
  }
  if (beaconGeos.length) group.add(new THREE.Mesh(mergeGeometries(beaconGeos), BEACON_MATERIAL));
  if (lampGeos.length) group.add(new THREE.Mesh(mergeGeometries(lampGeos), LAMP_MATERIAL));

  const _spinQ = new THREE.Quaternion();
  const Z_AXIS = new THREE.Vector3(0, 0, 1);

  function update(dt, elapsed, nightF) {
    for (const r of rotors) {
      r.angle += r.speed * dt;
      _spinQ.setFromAxisAngle(Z_AXIS, r.angle);
      r.mesh.quaternion.copy(r.baseQ).multiply(_spinQ);
    }
    // aviation beacons: faint by day, synchronized red pulse at night
    const blink = Math.max(0, Math.sin(elapsed * 2.1));
    const k = 0.18 + nightF * (0.25 + 1.25 * blink * blink);
    BEACON_MATERIAL.color.setRGB(1.35 * k, 0.16 * k, 0.14 * k);
    // the yard lamp and hut window burn steady and warm
    const h = 0.3 + nightF * 1.0;
    LAMP_MATERIAL.color.setRGB(1.05 * h, 0.72 * h, 0.28 * h);
  }

  return { group, update };
}
