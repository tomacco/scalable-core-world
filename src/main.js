// Scalable Core World — entry point.
// Builds the planet, seats every contributor on their plot, runs the sky.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPlanet, plots, wildSpots, PLOT_COUNT } from './planet.js';
import { buildEstate, buildWildDecor, makeLabel, makeBadge, GLOW_MATERIALS, SOLID_MATERIAL } from './structures.js';
import { buildEnergyGrid, energyClear } from './energy.js';
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
const homeBtn = $('homeBtn');
const rosterList = $('rosterList');
const clockTime = $('clocktime'), speedBtn = $('speedBtn');
const toastLayer = $('toastLayer');
const devToggle = $('devToggle'), devpanel = $('devpanel'), devClose = $('devClose');
const scanCountdown = $('scanCountdown'), scanNowBtn = $('scanNowBtn'), settlerCount = $('settlerCount');
const prList = $('prList'), prCount = $('prCount'), prRefreshBtn = $('prRefreshBtn'), prFoot = $('prFoot');
const statFps = $('statFps'), statCalls = $('statCalls'), statTris = $('statTris'), statGeo = $('statGeo');

// -------------------------------------------------------- renderer

const canvas = $('scene');
// antialias off on purpose: every frame goes through the EffectComposer's
// render targets, which have no MSAA, so a multisampled canvas would only
// spend memory smoothing the final blit of an already-rasterized image
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
// Manual reset so renderer.info sums every EffectComposer pass into one
// per-frame total (autoReset would zero it on each pass's render call).
renderer.info.autoReset = false;

let fps = 0; // smoothed, for the dev panel

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 2000);
camera.position.set(36, 54, 132);

// Two camera modes, both pan-free so the pivot is always meaningful:
//   globe — pivot is the planet core: spin from afar, skim terrain up close
//   house — pivot is a settler's house after clicking it; the "🌍 Planet
//           view" button (or Esc) flies you back out to globe mode
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.target.set(0, 0, 0);
controls.autoRotate = true;
controls.autoRotateSpeed = 0.4;

const GLOBE_MIN = 62, GLOBE_MAX = 360;
const SAFE_RADIUS = 55; // hard floor: the camera never sinks into the terrain
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// In house mode the orbit's up-axis is the house's surface normal, so a
// minimum polar-angle clamp keeps the camera above the local ground. The
// closer you zoom, the lower that floor drops — so up close you can circle the
// house almost at eye level, while pulling back lifts to a gentler overview.
const HOUSE_ELEV_MIN = THREE.MathUtils.degToRad(7);
const HOUSE_ELEV_MAX = THREE.MathUtils.degToRad(46);

let mode = 'globe';
function setMode(m) {
  mode = m;
  if (m === 'globe') {
    controls.minDistance = GLOBE_MIN;
    controls.maxDistance = GLOBE_MAX;
    homeBtn.classList.remove('show');
  } else {
    controls.minDistance = 9;   // distances are measured from the house now
    controls.maxDistance = 130;
    homeBtn.classList.add('show');
  }
}
setMode('globe');

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
sunLight.shadow.camera.left = -90;
sunLight.shadow.camera.right = 90;
sunLight.shadow.camera.top = 90;
sunLight.shadow.camera.bottom = -90;
sunLight.shadow.camera.near = 40;
sunLight.shadow.camera.far = 340;
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
  dawn: [-150, 30, 90],
  dusk: [150, 30, 90],
  aurora: [48, 24, 228],
};

// deep link: index.html#phase=dusk (dawn|noon|dusk|night|aurora)
{
  const wanted = new URLSearchParams(location.hash.slice(1)).get('phase');
  if (wanted === 'aurora') { sunAngle = PHASE_ANGLES.night; auroraBoost = 0.65; }
  else if (wanted in PHASE_ANGLES) sunAngle = PHASE_ANGLES[wanted];
  if (VANTAGES[wanted]) camera.position.set(...VANTAGES[wanted]);
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
      focusedId = null;
      setMode('globe');
      flyCamera(new THREE.Vector3(...v), new THREE.Vector3(0, 0, 0), 2000, null, WORLD_UP);
    }
  });
});

speedBtn.addEventListener('click', () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  speedBtn.textContent = SPEEDS[speedIdx] === 0 ? 'time ⏸' : `time ×${SPEEDS[speedIdx]}`;
});

const _sunDir = new THREE.Vector3(); // reused every frame — never allocate in the loop

function sunDirFromAngle(a) {
  return _sunDir.set(Math.cos(a), Math.sin(a) * 0.85, Math.sin(a) * 0.42).normalize();
}

// ------------------------------------------------------ build world

const clickables = [];
const contributorsById = new Map();
let energy = null; // the power layer; built in boot(), animated every frame

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

  // the machines were surveyed first — the wilds keep out of their footprints
  const spots = wildSpots().filter((s) => energyClear(s.dir));
  scene.add(buildMergedWildDecor(spots));

  loadMsg.textContent = 'raising the wind farm…';
  await new Promise((r) => setTimeout(r, 20));

  energy = buildEnergyGrid();
  scene.add(energy.group);

  // butterflies gather where the wildflowers grow, spread around the globe
  const flowers = spots.filter((s) => s.kind === 'flower');
  const stride = Math.max(1, Math.ceil(flowers.length / 12));
  for (let i = 0; i < flowers.length; i += stride) spawnButterfly(flowers[i]);
  spawnBirds(6);

  loadMsg.textContent = 'welcoming the settlers…';
  await loadContributors();

  loadingEl.classList.add('gone');

  // deep link: index.html#visit=ivan-gonzalez flies straight to a house
  const visit = new URLSearchParams(location.hash.slice(1)).get('visit');
  if (visit && contributorsById.has(visit)) flyTo(visit);
}

// The wilds never move and never need picking, so all their little meshes
// collapse into a single draw call: bake each decor's on-planet transform
// into its geometry and merge the lot into one mesh with the shared material.
function buildMergedWildDecor(spots) {
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion(), yawQ = new THREE.Quaternion();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const mat = new THREE.Matrix4();
  const geos = [];
  for (const spot of spots) {
    const decor = buildWildDecor(spot);
    q.setFromUnitVectors(up, spot.dir);
    yawQ.setFromAxisAngle(up, rnd.hash(spot.seed, 5, 5) * Math.PI * 2);
    q.multiply(yawQ); // same frame orientOnPlanet builds: surface normal, then local yaw
    pos.copy(spot.dir).multiplyScalar(spot.radius + 0.4);
    scl.setScalar(0.85);
    mat.compose(pos, q, scl);
    for (const mesh of decor.meshes) geos.push(mesh.geometry.applyMatrix4(mat));
  }
  const merged = new THREE.Mesh(mergeGeometries(geos), SOLID_MATERIAL);
  merged.castShadow = true;
  merged.receiveShadow = true;
  return merged;
}

// Houses stay flagged NEW for this long after their merge/deploy.
const NEW_WINDOW_MS = 5 * 60 * 1000;
const spawnAnims = [];   // {group, targetScale, start, duration}
const newBadges = [];    // {sprite, base, expires}

// Always read the manifest past the CDN/browser cache — GitHub Pages caches it
// for ~10 min at a stable URL, which would otherwise hide freshly-merged houses.
async function fetchJSON(url, { bust = false } = {}) {
  const res = await fetch(bust ? `${url}?t=${Date.now()}` : url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

// Freshness store. GitHub Pages stamps every file with the deploy time, so a
// server header can't tell which house is genuinely new. Instead we remember
// per-browser which settlers we've already shown: a live-poll arrival is new by
// definition, and this store keeps a reload from either forgetting a recent
// arrival or falsely flagging the whole world as NEW on a first visit.
const SEEN_KEY = 'scw-seen-v1';
const seenStore = loadSeen();
const wasFirstVisit = Object.keys(seenStore).length === 0;

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; }
  catch { return {}; }
}
function markSeen(id, ts) {
  seenStore[id] = ts;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seenStore)); } catch { /* private mode */ }
}

// Returns the timestamp to count NEW from, or null if this settler isn't fresh.
function freshnessFor(id) {
  const now = Date.now();
  if (seenStore[id] != null) return (now - seenStore[id] < NEW_WINDOW_MS) ? seenStore[id] : null;
  // first time THIS browser sees this id — on a very first visit, seed the
  // whole existing world as already-settled so nobody is spuriously "new"
  const ts = wasFirstVisit ? now - NEW_WINDOW_MS - 1000 : now;
  markSeen(id, ts);
  return (now - ts < NEW_WINDOW_MS) ? ts : null;
}

async function loadContributors() {
  let manifest;
  try {
    manifest = await fetchJSON('contributors/manifest.json', { bust: true });
  } catch (err) {
    console.error(err);
    loadMsg.classList.add('error');
    loadMsg.innerHTML = 'could not load contributors/manifest.json —<br/>if you opened this file directly, serve it instead:<br/><b>npx serve</b> or <b>python -m http.server</b>';
    throw err;
  }

  const ids = manifest.contributors || [];
  await Promise.all(ids.map((id, i) => addSettler(id, i)));

  if (contributorsById.size === 0) {
    loadMsg.classList.add('error');
    loadMsg.textContent = 'no contributors could be loaded';
  }

  startLiveSettlerPolling();
}

// Places one contributor on their plot. Plot = manifest index, and the manifest
// is append-only, so incremental placement matches a full reload exactly — new
// houses can be added live without disturbing anyone else's.
async function addSettler(id, index, { announce = false } = {}) {
  if (contributorsById.has(id)) return false;
  contributorsById.set(id, null); // reserve the id so concurrent polls don't double-build

  let config;
  try {
    config = await fetchJSON(`contributors/${id}/config.json`);
  } catch (err) {
    console.warn(`skipping contributor "${id}":`, err);
    contributorsById.delete(id);
    return false;
  }

  const plot = plots[index % PLOT_COUNT];
  const seed = 100 + index * 37;
  const estate = buildEstate(config, seed);

  const yaw = rnd.hash(index, 8, 3) * Math.PI * 2;
  orientOnPlanet(estate.group, plot.dir, plot.radius + 1.3, yaw, 0.8);
  const baseScale = estate.group.scale.x;

  const label = makeLabel(config.name || id);
  label.position.copy(plot.dir).multiplyScalar(plot.radius + 1.3 + estate.roofY * 0.8 + 3.2);
  scene.add(label);

  const record = { id, config, plot, group: estate.group, label, roofY: estate.roofY, meshes: estate.meshes };
  contributorsById.set(id, record);
  for (const mesh of estate.meshes) {
    mesh.userData.contributorId = id;
    clickables.push(mesh);
  }
  scene.add(estate.group);

  // one generous bounding sphere per estate lets pick() skip the triangle
  // test for every house the pointer ray doesn't even come near
  const bounds = new THREE.Box3().setFromObject(estate.group);
  record.pickSphere = bounds.getBoundingSphere(new THREE.Sphere());
  record.pickSphere.radius += 1;

  const li = document.createElement('li');
  const btn = document.createElement('button');
  // textContent, never innerHTML: contributor strings are untrusted and this
  // node lives in the host page, not the sandboxed iframe
  const nameEl = document.createElement('span');
  nameEl.textContent = config.name || id;
  const tagEl = document.createElement('small');
  tagEl.textContent = config.tagline || '';
  btn.append(nameEl, tagEl);
  btn.addEventListener('click', () => flyTo(id));
  li.appendChild(btn);
  rosterList.appendChild(li);
  record.li = li;

  // Freshness: a live-poll arrival is new by definition; a cold load defers to
  // the per-browser seen-store. Either way, animate it in and flag it NEW.
  let newSince = null;
  if (announce) { newSince = Date.now(); markSeen(id, newSince); }
  else newSince = freshnessFor(id);

  if (newSince !== null) {
    startSpawnAnimation(estate.group, baseScale);
    addNewBadge(record, newSince);
    li.classList.add('fresh');
    if (announce) announceArrival(record);
  }
  return true;
}

// Grow the estate up out of the ground with a springy pop.
function startSpawnAnimation(group, targetScale) {
  group.scale.setScalar(0.0001);
  spawnAnims.push({ group, targetScale, start: performance.now(), duration: 1200 });
}

function updateSpawnAnimations() {
  for (let i = spawnAnims.length - 1; i >= 0; i--) {
    const a = spawnAnims[i];
    const k = Math.min(1, (performance.now() - a.start) / a.duration);
    const c1 = 1.70158, c3 = c1 + 1;              // easeOutBack — a little overshoot
    const e = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
    a.group.scale.setScalar(Math.max(0.0001, a.targetScale * e));
    if (k >= 1) { a.group.scale.setScalar(a.targetScale); spawnAnims.splice(i, 1); }
  }
}

function addNewBadge(record, newSince) {
  const sprite = makeBadge('NEW');
  sprite.position.copy(record.plot.dir)
    .multiplyScalar(record.plot.radius + 1.3 + record.roofY * 0.8 + 7.0);
  scene.add(sprite);
  record.badge = sprite;
  newBadges.push({ sprite, base: sprite.scale.clone(), expires: newSince + NEW_WINDOW_MS, record });
}

function updateNewBadges(elapsed) {
  const now = Date.now();
  for (let i = newBadges.length - 1; i >= 0; i--) {
    const b = newBadges[i];
    if (now > b.expires) {
      scene.remove(b.sprite);
      b.sprite.material.map.dispose();
      b.sprite.material.dispose();
      if (b.record.li) b.record.li.classList.remove('fresh');
      newBadges.splice(i, 1);
      continue;
    }
    const pulse = 1 + 0.1 * Math.sin(elapsed * 4.5);   // gentle heartbeat
    b.sprite.scale.set(b.base.x * pulse, b.base.y * pulse, 1);
  }
}

// Poll the manifest for newly-merged settlers and raise their houses live.
// A self-rescheduling timeout (not a fixed interval) so the dev panel can read
// the countdown and trigger an immediate rescan.
const SETTLER_SCAN_MS = 45000;
let pollingStarted = false;
let pollInFlight = false;
let nextScanAt = 0;
let scanTimer = null;

function startLiveSettlerPolling() {
  if (pollingStarted) return;
  pollingStarted = true;
  scheduleScan(SETTLER_SCAN_MS);
}

function scheduleScan(delayMs) {
  nextScanAt = Date.now() + delayMs;
  clearTimeout(scanTimer);
  scanTimer = setTimeout(runSettlerScan, delayMs);
}

function scanForSettlersNow() { scheduleScan(0); }

// ---------------------------------------------------- dev / host panel

// Reads open PRs straight from the public GitHub API (CORS-enabled) so the
// host can see what's queued and when the next settler scan fires.
const GH_REPO = detectRepo();
const PR_THROTTLE_MS = 75000; // unauthenticated API allows 60 req/h — stay well under

function detectRepo() {
  const host = location.hostname;
  const seg = location.pathname.split('/').filter(Boolean);
  if (host.endsWith('github.io') && seg.length) return `${host.split('.')[0]}/${seg[0]}`;
  return 'tomacco/scalable-core-world';
}

let devOpen = false;
function setDevOpen(open) {
  devOpen = open;
  devpanel.hidden = !open;
  devToggle.style.display = open ? 'none' : '';
  if (open) refreshPRs();
}
devToggle.addEventListener('click', () => setDevOpen(true));
devClose.addEventListener('click', () => setDevOpen(false));
scanNowBtn.addEventListener('click', scanForSettlersNow);
prRefreshBtn.addEventListener('click', () => refreshPRs(true));
window.addEventListener('keydown', (e) => {
  if ((e.key === 'd' || e.key === 'D') && !e.metaKey && !e.ctrlKey && !e.altKey) setDevOpen(!devOpen);
});
if (/(^|[#&])dev\b/.test(location.hash)) setDevOpen(true); // deep link: #dev

function countLiveSettlers() {
  let n = 0;
  for (const v of contributorsById.values()) if (v) n++;
  return n;
}

// One tick drives the countdown, settler count, render stats, and PR refresh.
setInterval(() => {
  if (!devOpen) return;
  const secs = Math.max(0, Math.ceil((nextScanAt - Date.now()) / 1000));
  scanCountdown.textContent = pollInFlight ? 'scanning…' : `${secs}s`;
  settlerCount.textContent = countLiveSettlers();

  const info = renderer.info;
  statFps.textContent = Math.round(fps);
  statFps.style.color = fps >= 50 ? '#7fd18a' : fps >= 30 ? 'var(--gold)' : '#e07a5f';
  statCalls.textContent = info.render.calls;
  statTris.textContent = info.render.triangles.toLocaleString();
  statGeo.textContent = info.memory.geometries;

  if (Date.now() - lastPRFetch > PR_THROTTLE_MS) refreshPRs();
}, 500);

let prFetchInFlight = false;
let lastPRFetch = 0;
async function refreshPRs(force = false) {
  if (prFetchInFlight) return;
  if (!force && Date.now() - lastPRFetch < PR_THROTTLE_MS) return;
  prFetchInFlight = true;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GH_REPO}/pulls?state=open&per_page=20&sort=created&direction=asc`,
      { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' }
    );
    lastPRFetch = Date.now();
    if (res.status === 403) return renderPRError('GitHub API rate-limited — retrying soon');
    if (!res.ok) return renderPRError(`GitHub API error ${res.status}`);
    renderPRs(await res.json());
  } catch {
    renderPRError('could not reach the GitHub API');
  } finally {
    prFetchInFlight = false;
  }
}

function renderPRs(prs) {
  prCount.textContent = `(${prs.length})`;
  prList.replaceChildren();
  if (!prs.length) {
    prFoot.textContent = `updated ${new Date().toLocaleTimeString()}`;
    const li = document.createElement('li');
    li.className = 'dev-empty';
    li.textContent = 'no open PRs — the queue is clear';
    prList.appendChild(li);
    return;
  }
  for (const pr of prs) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'pr-row';
    const num = document.createElement('span');
    num.className = 'pr-num';
    num.textContent = `#${pr.number}`;
    const title = document.createElement('span');
    title.className = 'pr-title';
    title.textContent = pr.title;            // textContent: PR titles are untrusted
    row.append(num, title);
    const meta = document.createElement('span');
    meta.className = 'pr-meta';
    meta.textContent = `@${pr.user?.login ?? '?'} · ${pr.head?.ref ?? '?'}${pr.draft ? ' · draft' : ''}`;
    li.append(row, meta);
    if (typeof pr.html_url === 'string' && pr.html_url.startsWith('https://github.com/')) {
      li.style.cursor = 'pointer';
      li.title = 'open on GitHub';
      li.addEventListener('click', () => window.open(pr.html_url, '_blank', 'noopener'));
    }
    prList.appendChild(li);
  }
  prFoot.textContent = `updated ${new Date().toLocaleTimeString()} · click a PR to open it`;
}

function renderPRError(msg) {
  prCount.textContent = '(?)';
  prList.replaceChildren();
  const li = document.createElement('li');
  li.className = 'dev-empty';
  li.textContent = msg;
  prList.appendChild(li);
}

async function runSettlerScan() {
  if (!pollInFlight) {
    pollInFlight = true;
    try {
      const manifest = await fetchJSON('contributors/manifest.json', { bust: true });
      const ids = manifest.contributors || [];
      for (let i = 0; i < ids.length; i++) {
        if (!contributorsById.has(ids[i])) await addSettler(ids[i], i, { announce: true });
      }
    } catch (err) {
      console.warn('settler poll failed (will retry):', err.message);
    } finally {
      pollInFlight = false;
    }
  }
  scheduleScan(SETTLER_SCAN_MS);
}

function announceArrival(record) {
  console.log(`🏠 new settler: ${record.config.name || record.id}`);
  playArrivalChime();
  const el = document.createElement('div');
  el.className = 'arrival-toast';
  el.textContent = `◆ ${record.config.name || record.id} just settled`;
  el.addEventListener('click', () => flyTo(record.id));
  toastLayer.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 600);
  }, 9000);
}

// ------------------------------------------------------- 8-bit chime

// Synthesized, not a file: keeps the page self-contained and CSP-clean.
// Browsers block audio until a user gesture, so we unlock on first interaction.
let audioCtx = null;
function getAudioCtx() {
  if (audioCtx === null) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
window.addEventListener('pointerdown', getAudioCtx, { once: true });
window.addEventListener('keydown', getAudioCtx, { once: true });

function playArrivalChime() {
  const ctx = getAudioCtx();
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.16;
  master.connect(ctx.destination);

  // rising square-wave arpeggio: C5 E5 G5 C6
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const t = t0 + i * 0.085;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(f, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + 0.12);
  });

  // sparkle sweep to finish
  const ts = t0 + 4 * 0.085;
  const spark = ctx.createOscillator();
  spark.type = 'triangle';
  spark.frequency.setValueAtTime(1046.5, ts);
  spark.frequency.exponentialRampToValueAtTime(2093, ts + 0.16);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.5, ts);
  sg.gain.exponentialRampToValueAtTime(0.0001, ts + 0.28);
  spark.connect(sg); sg.connect(master);
  spark.start(ts); spark.stop(ts + 0.3);
}

// ------------------------------------------------------------ fauna

const butterflies = [];
const birds = [];

function tangentFrame(dir) {
  let e1 = new THREE.Vector3(0, 1, 0).cross(dir);
  if (e1.lengthSq() < 0.01) e1 = new THREE.Vector3(1, 0, 0).cross(dir);
  e1.normalize();
  const e2 = dir.clone().cross(e1).normalize();
  return { e1, e2 };
}

// one material per creature color, not per creature part
const BUTTERFLY_BODY_MAT = new THREE.MeshBasicMaterial({ color: 0x26222b });
const BIRD_MAT = new THREE.MeshBasicMaterial({ color: 0x2a2b33, side: THREE.DoubleSide });

function makeWingPair(w, h, mat) {
  const geoL = new THREE.PlaneGeometry(w, h);
  geoL.rotateX(-Math.PI / 2);
  geoL.translate(w / 2, 0, 0);
  const geoR = geoL.clone();
  geoR.translate(-w, 0, 0);
  return { left: new THREE.Mesh(geoL, mat), right: new THREE.Mesh(geoR, mat) };
}

function spawnButterfly(spot) {
  const s = spot.seed;
  const color = new THREE.Color().setHSL(rnd.hash(s, 21, 1), 0.8, 0.62);
  const group = new THREE.Group();
  const wings = makeWingPair(0.55, 0.42, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.45), BUTTERFLY_BODY_MAT);
  group.add(wings.left, wings.right, body);
  scene.add(group);
  butterflies.push({
    group, wings,
    dir: spot.dir.clone(), radius: spot.radius,
    frame: tangentFrame(spot.dir),
    phase: rnd.hash(s, 22, 2) * Math.PI * 2,
    drift: 0.9 + rnd.hash(s, 23, 3) * 1.1,
  });
}

function spawnBirds(count) {
  for (let i = 0; i < count; i++) {
    const axis = new THREE.Vector3(
      rnd.hash(i, 31, 1) - 0.5, rnd.hash(i, 32, 2) - 0.5, rnd.hash(i, 33, 3) - 0.5
    ).normalize();
    const { e1 } = tangentFrame(axis);
    const group = new THREE.Group();
    const wings = makeWingPair(1.1, 0.38, BIRD_MAT);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.8), BIRD_MAT);
    group.add(wings.left, wings.right, body);
    scene.add(group);
    birds.push({
      group, wings, axis, base: e1,
      radius: 66 + rnd.hash(i, 34, 4) * 16,
      speed: (0.05 + rnd.hash(i, 35, 5) * 0.05) * (rnd.hash(i, 36, 6) > 0.5 ? 1 : -1),
      phase: rnd.hash(i, 37, 7) * Math.PI * 2,
    });
  }
}

const _q = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function updateFauna(t) {
  for (const b of butterflies) {
    const wander = t * 0.55 * b.drift + b.phase;
    _v1.copy(b.frame.e1).multiplyScalar(Math.cos(wander) * 1.4)
      .addScaledVector(b.frame.e2, Math.sin(wander) * 1.4);
    const lift = 2.0 + Math.sin(t * 1.8 + b.phase * 3) * 0.6;
    b.group.position.copy(b.dir).multiplyScalar(b.radius + lift).add(_v1);
    b.group.quaternion.setFromUnitVectors(_v2.set(0, 1, 0), b.dir);
    const flap = Math.sin(t * 14 + b.phase) * 0.85;
    b.wings.left.rotation.z = flap;
    b.wings.right.rotation.z = -flap;
  }

  for (const b of birds) {
    const a = t * b.speed + b.phase;
    _q.setFromAxisAngle(b.axis, a);
    _v1.copy(b.base).applyQuaternion(_q).multiplyScalar(b.radius);
    _q.setFromAxisAngle(b.axis, a + 0.03 * Math.sign(b.speed));
    _v2.copy(b.base).applyQuaternion(_q).multiplyScalar(b.radius);
    b.group.position.copy(_v1);
    b.group.lookAt(_v2);
    const flap = Math.sin(t * 7 + b.phase) * 0.55;
    b.wings.left.rotation.z = flap;
    b.wings.right.rotation.z = -flap;
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

// Distinguish a real click from the mouse-up at the end of an orbit drag, so
// spinning the globe never accidentally triggers navigation or a reset.
let pointerDownAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDownAt = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('click', (e) => {
  if (flying || viewer.classList.contains('open')) return;
  const moved = pointerDownAt
    ? Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y) : 0;
  if (moved > 6) return; // it was a drag, not a click

  if (hoveredId) {
    flyTo(hoveredId);                 // clicked a house → visit it
  } else if (mode === 'house') {
    returnToGlobe();                  // clicked empty space while zoomed in → reset
  } else {
    hideCard();                       // clicked empty space on the globe → dismiss any card
  }
});

const pickCandidates = [];
const NO_HITS = [];

function pick() {
  if (flying || clickables.length === 0) { hoveredId = null; return; }
  raycaster.setFromCamera(pointer, camera);
  // sphere gate: full triangle intersection only for estates the ray grazes
  pickCandidates.length = 0;
  for (const rec of contributorsById.values()) {
    if (rec?.pickSphere && raycaster.ray.intersectsSphere(rec.pickSphere)) {
      pickCandidates.push(...rec.meshes);
    }
  }
  const hits = pickCandidates.length ? raycaster.intersectObjects(pickCandidates, false) : NO_HITS;
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

function flyCamera(endPos, endTarget, duration = 2000, onDone = null, endUp = null) {
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
  const u0 = camera.up.clone();
  const u1 = endUp ? endUp.clone().normalize() : null; // reorient the up-axis en route
  const a = new THREE.Vector3(), b = new THREE.Vector3(); // scratch for the flight's frames

  tween = {
    start: performance.now(),
    duration,
    update(k) {
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
      a.copy(p0).lerp(p1, e);
      b.copy(p1).lerp(p2, e);
      camera.position.copy(a.lerp(b, e));
      controls.target.copy(a.copy(t0).lerp(t1, e));
      if (u1) camera.up.copy(a.copy(u0).lerp(u1, e).normalize());
    },
    done() {
      flying = false;
      controls.enabled = true;
      if (u1) camera.up.copy(u1);
      if (onDone) onDone();
    },
  };
}

function flyTo(id) {
  const rec = contributorsById.get(id);
  if (!rec) return;
  hideCard();
  focusedId = id;
  setMode('house'); // widen distance limits before the descent starts
  flyToHouse(rec, () => showCard(rec));
}

// Descend onto a dome around the house: interpolate the camera in the house's
// own spherical frame — azimuth held (so it comes straight down from where you
// clicked), distance eased in, elevation eased to the arrival angle and never
// below a floor. The camera slides down the dome instead of bulging out into
// space or grazing the planet the way a world-space arc did.
const DOME_DIST = 28;                                // arrival distance from the house
const DOME_ELEV = THREE.MathUtils.degToRad(27);      // arrival elevation above ground
const FLIGHT_ELEV_FLOOR = THREE.MathUtils.degToRad(5);

function flyToHouse(rec, onDone) {
  controls.autoRotate = false;
  controls.enabled = false;
  flying = true;

  const N = rec.plot.dir.clone();                    // local up (surface normal)
  const center = N.clone().multiplyScalar(rec.plot.radius + 3.5);

  // stable tangent basis at the house, for measuring azimuth around the dome
  let t1 = new THREE.Vector3(0, 1, 0).cross(N);
  if (t1.lengthSq() < 1e-4) t1 = new THREE.Vector3(1, 0, 0).cross(N);
  t1.normalize();
  const t2 = N.clone().cross(t1).normalize();

  const dirFrom = (az, el) => t1.clone().multiplyScalar(Math.cos(el) * Math.cos(az))
    .addScaledVector(t2, Math.cos(el) * Math.sin(az))
    .addScaledVector(N, Math.sin(el));

  const startVec = camera.position.clone().sub(center);
  const dStart = Math.max(startVec.length(), DOME_DIST);
  const sDir = startVec.clone().normalize();
  const azStart = Math.atan2(sDir.dot(t2), sDir.dot(t1));
  const elStart = Math.asin(THREE.MathUtils.clamp(sDir.dot(N), -1, 1));

  const t0 = controls.target.clone();
  const u0 = camera.up.clone();
  const dir = new THREE.Vector3(), pos = new THREE.Vector3();

  tween = {
    start: performance.now(),
    duration: 2200,
    update(k) {
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const dist = THREE.MathUtils.lerp(dStart, DOME_DIST, e);
      const el = Math.max(THREE.MathUtils.lerp(elStart, DOME_ELEV, e), FLIGHT_ELEV_FLOOR);
      dir.copy(dirFrom(azStart, el));                 // azimuth held → straight dome descent
      pos.copy(center).addScaledVector(dir, dist);
      camera.position.copy(pos);
      controls.target.copy(t0).lerp(center, e);
      camera.up.copy(u0).lerp(N, e).normalize();
    },
    done() {
      flying = false;
      controls.enabled = true;
      camera.up.copy(N);
      if (onDone) onDone();
    },
  };
}

function returnToGlobe() {
  hideCard();
  focusedId = null;
  setMode('globe');
  const out = camera.position.clone().normalize().multiplyScalar(155);
  flyCamera(out, new THREE.Vector3(0, 0, 0), 1800, null, WORLD_UP);
}

homeBtn.addEventListener('click', returnToGlobe);

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
    else if (mode === 'house' && !flying) returnToGlobe();
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

// The frame loop, newspaper style: read the headline, descend only to debug.
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsed += dt;
  if (dt > 0) fps += (1 / dt - fps) * 0.1; // exponential smoothing

  const sunDir = advanceSun(dt);
  const { nightF, duskF } = lightTheWorld(sunDir);
  if (energy) energy.update(dt, elapsed, nightF);
  fadeLabelsUpClose();
  updateSpawnAnimations();
  updateNewBadges(elapsed);
  updateFauna(elapsed);
  advanceFlight();
  tuneControlFeel();
  clampHouseElevation();
  controls.update();
  keepCameraAboveTerrain();
  pick();
  renderFrame(sunDir, nightF, duskF);
}

function advanceSun(dt) {
  if (phaseTarget !== null) {
    const diff = ((phaseTarget - sunAngle) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 2.2);
    sunAngle += step;
    if (Math.abs(diff) < 0.01) { sunAngle = phaseTarget; phaseTarget = null; }
  } else {
    sunAngle += (Math.PI * 2 / DAY_LENGTH) * SPEEDS[speedIdx] * dt;
  }
  clockTime.textContent = formatSolTime(sunAngle);
  return sunDirFromAngle(sunAngle);
}

function lightTheWorld(sunDir) {
  const { nightF, duskF } = sky.update(sunDir, elapsed, auroraBoost);
  const dayF = 1 - nightF;

  sunLight.position.copy(sunDir).multiplyScalar(170);
  sunLight.intensity = 0.1 + dayF * 2.6;
  sunLight.color.setRGB(1, 1 - duskF * 0.38, 1 - duskF * 0.62);
  hemi.intensity = 0.18 + dayF * 0.55;
  moonFill.position.copy(sunDir).multiplyScalar(-150);
  moonFill.intensity = nightF * 0.55;

  const glowLevel = 0.5 + nightF * 0.75; // windows and lamps wake at dusk
  for (const mat of GLOW_MATERIALS) mat.color.setScalar(glowLevel);

  return { nightF, duskF };
}

// name labels fade out when you're close enough to read the front door
// (skip the null placeholders addSettler parks while a config is in flight)
function fadeLabelsUpClose() {
  for (const rec of contributorsById.values()) {
    if (rec) rec.label.visible = camera.position.distanceTo(rec.label.position) > 30;
  }
}

function advanceFlight() {
  if (!tween) return;
  const k = Math.min(1, (performance.now() - tween.start) / tween.duration);
  tween.update(k);
  if (k >= 1) { const t = tween; tween = null; t.done(); }
}

// gentle up close, brisk when spinning the globe from afar
function tuneControlFeel() {
  const closeness = mode === 'globe'
    ? THREE.MathUtils.clamp((camera.position.length() - GLOBE_MIN) / 200, 0, 1)
    : THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) / 90, 0, 1);
  controls.rotateSpeed = 0.15 + closeness * 0.85;
  controls.zoomSpeed = 0.55 + closeness * 0.65;
}

// Keep the camera above the house's local ground. With the orbit up-axis set
// to the surface normal, polar angle is measured from that normal, so a
// maxPolarAngle just under 90° is exactly "min elevation above the horizon".
// The floor eases lower the closer you are, for a natural walk-around feel.
function clampHouseElevation() {
  if (mode !== 'house' || flying) { controls.maxPolarAngle = Math.PI; return; }
  const dist = camera.position.distanceTo(controls.target);
  const t = THREE.MathUtils.clamp(
    (dist - controls.minDistance) / (controls.maxDistance - controls.minDistance), 0, 1);
  const elevation = HOUSE_ELEV_MIN + (HOUSE_ELEV_MAX - HOUSE_ELEV_MIN) * t;
  controls.maxPolarAngle = Math.PI / 2 - elevation;
}

// Hard floor for globe mode: never let the camera dive inside the planet. In
// house mode the elevation clamp already keeps us above the local ground, and
// this world-radius floor would fight getting close, so it's globe-only.
function keepCameraAboveTerrain() {
  if (mode !== 'globe') return;
  if (!tween && camera.position.length() < SAFE_RADIUS) {
    camera.position.setLength(SAFE_RADIUS);
  }
}

function renderFrame(sunDir, nightF, duskF) {
  renderer.info.reset(); // start a fresh per-frame tally before the pass chain
  postfx.update(_v1.copy(sunDir).multiplyScalar(640), duskF, nightF);
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
