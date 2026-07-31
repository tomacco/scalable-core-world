// Adaptive quality: one ordered ladder of presets, and a governor that walks
// it using frame rate as the only signal. No GPU-string sniffing, no device
// tables — the only question worth asking is whether THIS machine, at THIS
// window size, with THIS many settlers on screen, is holding the target now.
//
// The ladder is ordered by cost-to-beauty: cheapest sacrifices first. Internal
// resolution rides down alongside the quality knobs, but only as far as 50%.
// Tiers 8-9 are triage — every knob is already off and the frame buffer is the
// last thing left to shrink, so the picture gets soft rather than empty.
//
// The governor is deliberately reluctant. A dropped frame is not a trend: a
// garbage collection pause, a settler spawning, or a flight tween starting will
// all dent the frame rate for a moment, and a system that re-tiers on every
// dent would spend its life rebuilding shadow maps instead of drawing. See
// ANTI-THRASH below for the four mechanisms that keep it calm.

import * as THREE from 'three';

// ------------------------------------------------------------ vocabulary

// Every knob is a fixed list of legal values. The ladder may only use values
// from these lists, which is what lets the dev panel's sliders be exact
// integer indices into them — the slider and the engine can never disagree.
export const KNOBS = {
  res: {
    label: 'resolution',
    values: [0.25, 0.35, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    format: (v) => `${Math.round(v * 100)}%`,
  },
  shadowSize: {
    label: 'shadow map',
    values: [0, 512, 768, 1024, 1536, 2048],
    format: (v) => (v ? `${v}²` : 'off'),
  },
  shadowSoft: {
    label: 'shadow filter',
    values: [0, 1, 2],
    format: (v) => ['hard', 'PCF', 'soft'][v],
  },
  bloom: {
    label: 'bloom',
    values: [0, 0.5, 1],
    format: (v) => (v === 0 ? 'off' : v === 0.5 ? 'half-res' : 'full-res'),
  },
  rays: {
    label: 'god rays',
    values: [0, 8, 12, 16, 24, 36],
    format: (v) => (v ? `${v} samples` : 'off'),
  },
  fauna: {
    label: 'fauna',
    values: [0, 0.25, 0.4, 0.55, 0.75, 1],
    format: (v) => `${Math.round(v * 100)}%`,
  },
};

export const KNOB_NAMES = Object.keys(KNOBS);

const LADDER = [
  { name: 'ultra',     res: 1,    shadowSize: 2048, shadowSoft: 2, bloom: 1,   rays: 36, fauna: 1 },
  { name: 'high',      res: 1,    shadowSize: 2048, shadowSoft: 1, bloom: 0.5, rays: 36, fauna: 1 },
  { name: 'high−',     res: 0.9,  shadowSize: 1536, shadowSoft: 1, bloom: 0.5, rays: 24, fauna: 1 },
  { name: 'medium+',   res: 0.8,  shadowSize: 1024, shadowSoft: 1, bloom: 0.5, rays: 16, fauna: 0.75 },
  { name: 'medium',    res: 0.7,  shadowSize: 1024, shadowSoft: 0, bloom: 0.5, rays: 12, fauna: 0.55 },
  { name: 'medium−',   res: 0.6,  shadowSize: 768,  shadowSoft: 0, bloom: 0.5, rays: 8,  fauna: 0.4 },
  { name: 'low',       res: 0.5,  shadowSize: 512,  shadowSoft: 0, bloom: 0.5, rays: 0,  fauna: 0.25 },
  { name: 'minimal',   res: 0.5,  shadowSize: 0,    shadowSoft: 0, bloom: 0,   rays: 0,  fauna: 0.25 },
  { name: 'emergency', res: 0.35, shadowSize: 0,    shadowSoft: 0, bloom: 0,   rays: 0,  fauna: 0.25 },
  { name: 'floor',     res: 0.25, shadowSize: 0,    shadowSoft: 0, bloom: 0,   rays: 0,  fauna: 0.25 },
];

const LAST_TIER = LADDER.length - 1;

const SHADOW_TYPES = [THREE.BasicShadowMap, THREE.PCFShadowMap, THREE.PCFSoftShadowMap];

// --------------------------------------------------- governor tuning

export const TARGET_FPS = 50;

const DOWN_FPS = TARGET_FPS - 4;    // below this we are failing the target
const UP_FPS = TARGET_FPS + 10;     // above this there is room to spend again
const PANIC_FPS = 24;               // visibly broken, not merely short

const SAMPLE_MS = 250;
const WINDOW = 8;                   // 2s of samples behind the median
const FAST_WINDOW = 4;              // 1s, for the panic path only

// ANTI-THRASH, mechanism 1 of 4: dwell. A threshold must be breached
// continuously for this long before it counts. Demotion is quicker than
// promotion because being slow is worse than being plain.
const DOWN_DWELL_MS = 2500;
const UP_DWELL_MS = 6000;
const PANIC_DWELL_MS = 800;

// ANTI-THRASH, mechanism 2: cooldown. Every tier change costs a hitch of its
// own (buffers reallocate, shaders may recompile). Measuring during that hitch
// would read it as evidence the new tier is also too slow.
const COOLDOWN_MS = 1500;

// ANTI-THRASH, mechanism 3: the regret ratchet. If we climb into a tier and
// fall straight back out of it, that tier was a mistake — each mistake makes
// the next attempt at it wait proportionally longer, so an oscillation damps
// out instead of running forever.
const REGRET_MS = 8000;
const MAX_REGRET = 5;

// (Mechanism 4 is the median filter itself — see readSignal.)

// ------------------------------------------------------------ module

export function createQuality(targets) {
  const { renderer, scene, sunLight, postfx, maxPixelRatio,
          setFaunaDensity, getFps, onChange } = targets;

  let knobs = { ...LADDER[0] };
  let applied = null;               // last config actually pushed to the engine
  let tier = 0;
  let auto = true;

  let viewW = window.innerWidth, viewH = window.innerHeight;

  // Three re-renders every shadow-casting object into the shadow map on every
  // frame that autoUpdate is on. The sun moves 2°/second at ×1, so that is a
  // whole extra scene pass spent redrawing a picture that barely changed.
  renderer.shadowMap.autoUpdate = false;

  applyAll({ force: true });

  // ------------------------------------------------------ applying

  function applyAll({ force = false } = {}) {
    const prev = applied;
    if (force || knobs.res !== prev.res) applyResolution();
    if (force || knobs.bloom !== prev.bloom) postfx.setBloomScale(knobs.bloom);
    if (force || knobs.rays !== prev.rays) postfx.setRaySamples(knobs.rays);
    if (force || knobs.fauna !== prev.fauna) setFaunaDensity(knobs.fauna);
    if (force || knobs.shadowSize !== prev.shadowSize || knobs.shadowSoft !== prev.shadowSoft) {
      applyShadows(force);
    }
    applied = { ...knobs };
    onChange(applied, tier, LADDER[tier].name, auto);
  }

  function applyResolution() {
    const pr = maxPixelRatio * knobs.res;
    renderer.setPixelRatio(pr);
    renderer.setSize(viewW, viewH);
    postfx.setPixelRatio(pr);
    postfx.setSize(viewW, viewH);
  }

  function applyShadows(force) {
    const on = knobs.shadowSize > 0;
    const type = SHADOW_TYPES[knobs.shadowSoft];
    // Whether shadows exist at all, and which filter samples them, are baked
    // into every material's compiled program — those two need a recompile.
    // Map size does not: it only reallocates the depth target.
    const structural = force || renderer.shadowMap.enabled !== on || renderer.shadowMap.type !== type;

    renderer.shadowMap.enabled = on;
    renderer.shadowMap.type = type;
    sunLight.castShadow = on;

    if (on && sunLight.shadow.mapSize.x !== knobs.shadowSize) {
      sunLight.shadow.mapSize.set(knobs.shadowSize, knobs.shadowSize);
      sunLight.shadow.map?.dispose();
      sunLight.shadow.map = null;    // three rebuilds it at the new size
    }

    if (structural) recompileMaterials();
    renderer.shadowMap.needsUpdate = true;  // whatever we just changed, redraw it once
  }

  function recompileMaterials() {
    scene.traverse((obj) => {
      const mat = obj.material;
      if (!mat) return;
      if (Array.isArray(mat)) for (const m of mat) m.needsUpdate = true;
      else mat.needsUpdate = true;
    });
  }

  // ------------------------------------------------------- per frame

  // Refresh the shadow map on a cadence instead of every frame. At ×1 the sun
  // sweeps 2°/s, so 20 refreshes a second is already far finer than anyone can
  // see; fast-forward tightens it so the shadows don't visibly staircase.
  let shadowCountdown = 0;
  function beginFrame(sunSpeed) {
    if (!renderer.shadowMap.enabled) return;
    if (--shadowCountdown > 0) return;
    shadowCountdown = sunSpeed >= 16 ? 1 : sunSpeed >= 4 ? 2 : 3;
    renderer.shadowMap.needsUpdate = true;
  }

  // ------------------------------------------------------- governor

  const samples = [];
  let downSince = 0, upSince = 0, panicSince = 0;
  let changedAt = 0, startedAt = 0;
  const regret = new Array(LADDER.length).fill(0);
  let promotedTo = -1, promotedAt = 0;

  // ANTI-THRASH, mechanism 4: never decide on an instantaneous reading. The
  // median of the window throws away the single worst frame — which is exactly
  // the GC pause or spawn hitch we do not want to react to — where a mean
  // would let it drag the whole decision down.
  function readSignal(count) {
    const slice = count ? samples.slice(-count) : samples;
    const sorted = slice.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function forget() {
    samples.length = 0;
    downSince = upSince = panicSince = 0;
  }

  function setTier(next) {
    if (next === tier) return;
    tier = next;
    knobs = { ...LADDER[tier] };
    applyAll();
    changedAt = Date.now();
    forget();                        // the old readings describe the old tier
  }

  function stepDown(steps) {
    if (tier >= LAST_TIER) return;
    // falling out of a tier we only just climbed into means that climb was
    // wrong — charge the ratchet so the next attempt at it costs more
    if (promotedTo === tier && Date.now() - promotedAt < REGRET_MS) {
      regret[tier] = Math.min(regret[tier] + 1, MAX_REGRET);
    }
    promotedTo = -1;
    setTier(Math.min(LAST_TIER, tier + steps));
  }

  function stepUp() {
    if (tier === 0) return;
    promotedTo = tier - 1;
    promotedAt = Date.now();
    setTier(tier - 1);
  }

  function upDwellFor(target) {
    return UP_DWELL_MS * (1 + regret[target]);
  }

  setInterval(() => {
    if (!auto || document.hidden) { forget(); return; }

    const now = Date.now();
    if (!startedAt) { startedAt = now; return; }
    if (now - startedAt < 2000) return;          // let boot settle

    const fps = getFps();
    if (!(fps > 0)) return;
    samples.push(fps);
    if (samples.length > WINDOW) samples.shift();

    if (now - changedAt < COOLDOWN_MS) { downSince = upSince = panicSince = 0; return; }

    // The panic path decides on the short window: a full second of frames all
    // under 24fps is not a hiccup under any reading, and making a visibly
    // broken picture wait out the long window just prolongs the pain.
    if (samples.length >= FAST_WINDOW && readSignal(FAST_WINDOW) <= PANIC_FPS) {
      if (!panicSince) panicSince = now;
      if (now - panicSince >= PANIC_DWELL_MS) { stepDown(2); return; }
    } else {
      panicSince = 0;
    }

    if (samples.length < WINDOW) return;   // ordinary moves need the full window
    const signal = readSignal();

    if (signal < DOWN_FPS) {
      if (!downSince) downSince = now;
      if (now - downSince >= DOWN_DWELL_MS) { stepDown(1); return; }
    } else {
      downSince = 0;
    }

    if (signal > UP_FPS && tier > 0) {
      if (!upSince) upSince = now;
      if (now - upSince >= upDwellFor(tier - 1)) stepUp();
    } else {
      upSince = 0;
    }
  }, SAMPLE_MS);

  // ---------------------------------------------------------- public

  // Returning to auto after hand-tuning should not jolt the picture, so we
  // rejoin the ladder at whichever tier the manual settings already resemble.
  function nearestTier() {
    let best = 0, bestCost = Infinity;
    for (let i = 0; i < LADDER.length; i++) {
      const t = LADDER[i];
      const cost = Math.abs(t.res - knobs.res) * 4
        + Math.abs(knobIndex('shadowSize', t.shadowSize) - knobIndex('shadowSize', knobs.shadowSize)) * 0.5
        + Math.abs(t.shadowSoft - knobs.shadowSoft) * 0.3
        + Math.abs(t.bloom - knobs.bloom) * 0.5
        + Math.abs(knobIndex('rays', t.rays) - knobIndex('rays', knobs.rays)) * 0.2
        + Math.abs(t.fauna - knobs.fauna) * 0.3;
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    return best;
  }

  return {
    beginFrame,

    setAuto(on) {
      auto = on;
      forget();
      if (on) {
        tier = nearestTier();
        knobs = { ...LADDER[tier] };
        changedAt = Date.now();
        applyAll();
      } else {
        onChange(applied, tier, LADDER[tier].name, auto);
      }
    },

    setKnob(name, value) {
      if (auto || knobs[name] === value) return;   // auto owns the knobs
      knobs[name] = value;
      applyAll();
    },

    handleResize() {
      viewW = window.innerWidth;
      viewH = window.innerHeight;
      applyResolution();
      forget();                       // a resize changes the cost of every frame
      changedAt = Date.now();
    },

    // fauna spawns after boot, so its density has to be pushed once more
    reapplyFauna() { setFaunaDensity(knobs.fauna); },

    isAuto: () => auto,
    isExhausted: () => tier >= LAST_TIER,
  };
}

export function knobIndex(knob, value) {
  const i = KNOBS[knob].values.indexOf(value);
  return i < 0 ? 0 : i;
}
