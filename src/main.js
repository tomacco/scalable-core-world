// Scalable Core World — entry point.
// Builds the planet, seats every contributor on their plot, runs the sky.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildPlanet, plots, wildSpots, PLOT_COUNT } from './planet.js';
import { buildEstate, buildWildDecor, makeLabel, GLOW_MATERIALS } from './structures.js';
import { createSky } from './sky.js';
import { createPostFX } from './postfx.js';
import { makeNoise } from './noise.js';

const rnd = makeNoise(31337);

// ------------------------------------------------------------- DOM

const $ = (id) => document.getElementById(id);
const loadingEl = $('loading'), loadMsg = $('loadmsg');
const tooltip = $('tooltip');
const card = $('card'), cardName = $('cardName'), cardTagline = $('cardTagline');
const enterBtn = $('enterBtn'), leaveBtn = $('leaveBtn');
const viewer = $('viewer'), siteFrame = $('siteFrame'), backBtn = $('backBtn'), flash = $('flash');
const rosterList = $('rosterList');
const clockTime = $('clocktime'), speedBtn = $('speedBtn');

// -------------------------------------------------------- renderer

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 2000);
camera.position.set(18, 30, 72);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 38;
controls.maxDistance = 300;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.4;

let idleTimer = null;
controls.addEventListener('start', () => {
  controls.autoRotate = false;
  clearTimeout(idleTimer);
  hideCard();
});
controls.addEventListener('end', () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!viewer.classList.contains('open')) controls.autoRotate = true; }, 30000);
});

// ---------------------------------------------------------- lights

const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -55;
sunLight.shadow.camera.right = 55;
sunLight.shadow.camera.top = 55;
sunLight.shadow.camera.bottom = -55;
sunLight.shadow.camera.near = 20;
sunLight.shadow.camera.far = 220;
sunLight.shadow.bias = -0.0006;
scene.add(sunLight);
scene.add(sunLight.target);

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a4a3a, 0.6);
scene.add(hemi);

const moonFill = new THREE.DirectionalLight(0x8fa8d0, 0.0);
scene.add(moonFill);

const sky = createSky(scene);
const postfx = createPostFX(renderer, scene, camera);

// ------------------------------------------------------- day cycle

const DAY_LENGTH = 180; // seconds per full day at speed x1
const SPEEDS = [1, 4, 16, 0];
let speedIdx = 0;
let sunAngle = Math.PI * 0.32; // start mid-morning
let phaseTarget = null;
let auroraBoost = 0;

const PHASE_ANGLES = { dawn: 0.02, noon: Math.PI / 2, dusk: Math.PI - 0.06, night: Math.PI * 1.5 };

// camera vantages that frame each sky event (sun rim for god rays, pole for aurora)
const VANTAGES = {
  dawn: { pos: [-95, 18, 55], target: [0, 0, 0] },
  dusk: { pos: [95, 18, 55], target: [0, 0, 0] },
  aurora: { pos: [40, 60, 150], target: [0, 45, 0] },
};

// deep link: index.html#phase=dusk (dawn|noon|dusk|night|aurora)
{
  const wanted = new URLSearchParams(location.hash.slice(1)).get('phase');
  if (wanted === 'aurora') { sunAngle = PHASE_ANGLES.night; auroraBoost = 0.65; }
  else if (wanted in PHASE_ANGLES) sunAngle = PHASE_ANGLES[wanted];
  const v = VANTAGES[wanted];
  if (v) {
    camera.position.set(...v.pos);
    controls.target.set(...v.target);
  }
}

document.querySelectorAll('.skybtn[data-phase]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const phase = btn.dataset.phase;
    auroraBoost = phase === 'aurora' ? 0.65 : 0;
    phaseTarget = PHASE_ANGLES[phase === 'aurora' ? 'night' : phase];
    document.querySelectorAll('.skybtn[data-phase]').forEach((b) => b.classList.toggle('active', b === btn));
    const v = VANTAGES[phase];
    if (v && !viewer.classList.contains('open')) {
      hideCard();
      flyCamera(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.target), 2000);
    }
  });
});

speedBtn.addEventListener('click', () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  speedBtn.textContent = SPEEDS[speedIdx] === 0 ? 'time ⏸' : `time ×${SPEEDS[speedIdx]}`;
});

function sunDirFromAngle(a) {
  return new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.85, Math.sin(a) * 0.42).normalize();
}

// ------------------------------------------------------ build world

const clickables = [];
const contributorsById = new Map();

function orientOnPlanet(group, dir, radius, yaw = 0, scale = 1) {
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  group.rotateY(yaw);
  group.position.copy(dir).multiplyScalar(radius);
  group.scale.setScalar(scale);
}

async function boot() {
  loadMsg.textContent = 'carving the planet…';
  await new Promise((r) => setTimeout(r, 60)); // let the loading screen paint

  scene.add(buildPlanet());

  loadMsg.textContent = 'growing the wilds…';
  await new Promise((r) => setTimeout(r, 20));

  for (const spot of wildSpots()) {
    const decor = buildWildDecor(spot);
    orientOnPlanet(decor.group, spot.dir, spot.radius + 0.4, rnd.hash(spot.seed, 5, 5) * Math.PI * 2, 0.85);
    scene.add(decor.group);
  }

  loadMsg.textContent = 'welcoming the settlers…';
  await loadContributors();

  loadingEl.classList.add('gone');
}

async function loadContributors() {
  let manifest;
  try {
    const res = await fetch('contributors/manifest.json');
    if (!res.ok) throw new Error(`manifest.json → HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    console.error(err);
    loadMsg.classList.add('error');
    loadMsg.innerHTML = 'could not load contributors/manifest.json —<br/>if you opened this file directly, serve it instead:<br/><b>npx serve</b> or <b>python -m http.server</b>';
    throw err;
  }

  const ids = manifest.contributors || [];
  const results = await Promise.all(ids.map(async (id, i) => {
    try {
      const res = await fetch(`contributors/${id}/config.json`);
      if (!res.ok) throw new Error(`config.json for ${id} → HTTP ${res.status}`);
      return { id, index: i, config: await res.json() };
    } catch (err) {
      console.warn(`skipping contributor "${id}":`, err);
      return null;
    }
  }));

  for (const entry of results.filter(Boolean)) {
    const { id, index, config } = entry;
    const plot = plots[index % PLOT_COUNT];
    const seed = 100 + index * 37;
    const estate = buildEstate(config, seed);

    const yaw = rnd.hash(index, 8, 3) * Math.PI * 2;
    orientOnPlanet(estate.group, plot.dir, plot.radius + 1.3, yaw, 0.8);

    const label = makeLabel(config.name || id);
    label.position.copy(plot.dir).multiplyScalar(plot.radius + 1.3 + estate.roofY * 0.8 + 3.2);
    scene.add(label);

    const record = { id, config, plot, group: estate.group, label };
    contributorsById.set(id, record);
    for (const mesh of estate.meshes) {
      mesh.userData.contributorId = id;
      clickables.push(mesh);
    }
    scene.add(estate.group);

    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.innerHTML = `${config.name || id}<small>${config.tagline || ''}</small>`;
    btn.addEventListener('click', () => flyTo(id));
    li.appendChild(btn);
    rosterList.appendChild(li);
  }

  if (contributorsById.size === 0) {
    loadMsg.classList.add('error');
    loadMsg.textContent = 'no contributors could be loaded';
  }
}

// -------------------------------------------------- picking & tours

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(-2, -2);
let hoveredId = null;
let flying = false;
let focusedId = null;

renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  tooltip.style.left = e.clientX + 'px';
  tooltip.style.top = e.clientY + 'px';
});

renderer.domElement.addEventListener('click', () => {
  if (flying || viewer.classList.contains('open')) return;
  if (hoveredId) flyTo(hoveredId);
});

function pick() {
  if (flying || clickables.length === 0) { hoveredId = null; return; }
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(clickables, false);
  const id = hits.length ? hits[0].object.userData.contributorId : null;
  if (id !== hoveredId) {
    hoveredId = id;
    if (id) {
      const rec = contributorsById.get(id);
      tooltip.textContent = '◆ ' + (rec.config.name || id);
      tooltip.style.opacity = 1;
      renderer.domElement.style.cursor = 'pointer';
    } else {
      tooltip.style.opacity = 0;
      renderer.domElement.style.cursor = 'grab';
    }
  }
}

let tween = null;

function flyCamera(endPos, endTarget, duration = 2000, onDone = null) {
  controls.autoRotate = false;
  controls.enabled = false;
  flying = true;

  const p0 = camera.position.clone();
  const p2 = endPos.clone();
  let mid = p0.clone().add(p2);
  if (mid.lengthSq() < 4) mid = new THREE.Vector3(0, 1, 0); // antipodal guard
  const p1 = mid.normalize().multiplyScalar(Math.max(p0.length(), p2.length()) * 1.25);

  const t0 = controls.target.clone();
  const t1 = endTarget.clone();

  tween = {
    start: performance.now(),
    duration,
    update(k) {
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
      const a = p0.clone().lerp(p1, e), b = p1.clone().lerp(p2, e);
      camera.position.copy(a.lerp(b, e));
      controls.target.copy(t0.clone().lerp(t1, e));
    },
    done() {
      flying = false;
      controls.enabled = true;
      if (onDone) onDone();
    },
  };
}

function flyTo(id) {
  const rec = contributorsById.get(id);
  if (!rec) return;
  hideCard();
  focusedId = id;

  const normal = rec.plot.dir.clone();
  const housePos = normal.clone().multiplyScalar(rec.plot.radius + 3.5);

  // stand back from the house, biased toward where the camera already is
  let side = camera.position.clone().normalize().projectOnPlane(normal);
  if (side.lengthSq() < 0.01) side = new THREE.Vector3(0, 1, 0).projectOnPlane(normal);
  side.normalize();
  const endPos = normal.clone().multiplyScalar(rec.plot.radius + 12)
    .add(side.multiplyScalar(17));

  flyCamera(endPos, housePos, 2400, () => showCard(rec));
}

function showCard(rec) {
  cardName.textContent = rec.config.name || rec.id;
  cardTagline.textContent = rec.config.tagline || 'a settler of the core world';
  card.classList.add('show');
}
function hideCard() { card.classList.remove('show'); }

leaveBtn.addEventListener('click', () => { hideCard(); focusedId = null; });

enterBtn.addEventListener('click', () => {
  const rec = contributorsById.get(focusedId);
  if (!rec) return;
  const site = rec.config.site || 'site/index.html';
  flash.classList.add('on');
  setTimeout(() => {
    siteFrame.src = `contributors/${rec.id}/${site}`;
    viewer.classList.add('open');
    backBtn.classList.add('show');
    hideCard();
    setTimeout(() => flash.classList.remove('on'), 500);
  }, 550);
});

backBtn.addEventListener('click', closeViewer);
function closeViewer() {
  viewer.classList.remove('open');
  backBtn.classList.remove('show');
  siteFrame.src = 'about:blank';
  focusedId = null;
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (viewer.classList.contains('open')) closeViewer();
    else hideCard();
  }
});

// ----------------------------------------------------------- loop

const clock = new THREE.Clock();
let elapsed = 0;

function formatSolTime(a) {
  const norm = ((a / (Math.PI * 2)) % 1 + 1) % 1;
  const hours = (norm * 24 + 6) % 24;
  const hh = String(Math.floor(hours)).padStart(2, '0');
  const mm = String(Math.floor((hours % 1) * 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsed += dt;

  // advance the sun
  if (phaseTarget !== null) {
    const diff = ((phaseTarget - sunAngle) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 2.2);
    sunAngle += step;
    if (Math.abs(diff) < 0.01) { sunAngle = phaseTarget; phaseTarget = null; }
  } else {
    sunAngle += (Math.PI * 2 / DAY_LENGTH) * SPEEDS[speedIdx] * dt;
  }

  const sunDir = sunDirFromAngle(sunAngle);
  const { nightF, duskF } = sky.update(sunDir, elapsed, auroraBoost);
  const dayF = 1 - nightF;

  sunLight.position.copy(sunDir).multiplyScalar(110);
  sunLight.intensity = 0.1 + dayF * 2.6;
  sunLight.color.setRGB(1, 1 - duskF * 0.38, 1 - duskF * 0.62);
  hemi.intensity = 0.18 + dayF * 0.55;
  moonFill.position.copy(sunDir).multiplyScalar(-110);
  moonFill.intensity = nightF * 0.55;

  const glowLevel = 0.5 + nightF * 0.75;
  for (const mat of GLOW_MATERIALS) mat.color.setScalar(glowLevel);

  clockTime.textContent = formatSolTime(sunAngle);

  if (tween) {
    const k = Math.min(1, (performance.now() - tween.start) / tween.duration);
    tween.update(k);
    if (k >= 1) { const t = tween; tween = null; t.done(); }
  }

  controls.update();
  pick();
  postfx.update(sunDir.clone().multiplyScalar(640), duskF, nightF);
  postfx.composer.render();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

boot().catch((err) => console.error('boot failed:', err));
animate();
