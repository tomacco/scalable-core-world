# Architecture — how humans and agents share one world

## The core idea: kernel and userland

This repository is designed for a specific population: **one human owner**, a
handful of human reviewers, and **many coding agents** arriving with pull
requests. The architecture that works for that population is the one operating
systems discovered decades ago:

```
┌────────────────────────────────────────────────────────────┐
│  KERNEL — the engine (src/, index.html)                    │
│  Owner-maintained. Small, stable, reviewed. Agents never   │
│  write here.                                               │
├────────────────────────────────────────────────────────────┤
│  SYSCALL LAYER — the contract                              │
│  contributors/manifest.json  (append-only registry)        │
│  config.json schema          (declarative settlement API)  │
│  site/index.html             (sandboxed content entry)     │
├────────────────────────────────────────────────────────────┤
│  USERLAND — contributors/<slug>/                           │
│  Agent-written. Isolated. Data and content only — never    │
│  executable engine code.                                   │
└────────────────────────────────────────────────────────────┘
```

The load-bearing decision: **agents extend the world with data, not code.**
A settlement is a JSON document plus a static site. The engine interprets the
JSON; it never executes anything a contributor wrote. This is why a hundred
agents can work in parallel without merge conflicts, regressions, or review
bottlenecks — the blast radius of any contribution is its own folder.

Isolation is enforced four times, at different layers:

| Layer | Mechanism | Catches |
|---|---|---|
| Social | `AGENTS.md` (the law) | agents that read instructions |
| Review | `.github/CODEOWNERS` (incl. `* @tomacco` catch-all) | any file outside a settler folder — engine, CI, or a new top-level file like `CNAME` |
| CI | `scripts/validate-contribution.mjs` | territory, manifest order, schema, size, PII, and a site-content scan for secrets/trackers/off-site calls/frame probing |
| Runtime | `<iframe sandbox>` (opaque origin) + `textContent` rendering + `JSON.parse` | site breakout, host-page XSS via `name`/`tagline`, malformed config |

Never rely on only the social layer. Agents are obedient but fallible;
the mechanical layers make the rules true rather than merely stated. Two red-
team findings shaped this table: a stored XSS through `config.name` (rendered
in the host page, outside the sandbox — now `textContent`) and a `CNAME`
domain-hijack that no CODEOWNERS rule guarded (now the `*` catch-all). When
you add a feature that renders contributor data or accepts a new file type,
add its guardrail in the same PR.

## Engine module map

No build step, no framework, no state library. Three.js from a CDN via import
maps; ES modules straight to the browser. Every module owns one concern and
they compose in `main.js` only — modules never import each other sideways
except through `noise.js` (a shared leaf), `planet.js` (the terrain
authority), and `structures.js`'s `VoxelBuilder` (the shared voxel mesher).

| Module | Owns | Depends on |
|---|---|---|
| `noise.js` | deterministic seeded noise | — |
| `planet.js` | terrain field, voxelization, plots, wild spots | noise |
| `structures.js` | houses, gardens, avatars, animals, labels | noise |
| `energy.js` | wind turbines, substation, pylons & cables | noise, planet, structures |
| `sky.js` | atmosphere, stars, sun/moon, aurora | noise |
| `postfx.js` | bloom, god rays | three/addons |
| `quality.js` | the quality ladder and the FPS governor that walks it | three |
| `main.js` | composition: scene, camera modes, settlers, UI, the frame loop | all of the above |

Determinism is a feature: all randomness flows from seeded hashes so every
visitor sees the identical planet. `Math.random()` is banned in the engine.

## Coding style: Primera Plana, adapted

Engine code follows [Primera Plana](https://github.com/tomacco/primera-plana):
public functions are **headlines** — a linear sequence of named steps —
and complexity lives in **leaves**. `boot()` and `animate()` in `main.js`
are the reference examples: read either and you know the whole story;
descend into a step only when debugging it.

Adaptations for a real-time voxel engine (the "when to break the rules"
clause, exercised deliberately):

1. **Hot loops stay dense.** Voxelization and meshing run hundreds of
   thousands of iterations; extracting per-voxel helpers costs real frame
   budget and locality. A tight, commented loop *is* the leaf.
2. **Data tables are prose.** Voxel models (avatars, animals, houses) are
   coordinate tables. Splitting them into functions would hide the shape;
   their headline is the section comment above them.
3. **Shaders are foreign country.** GLSL blocks follow GLSL idiom, not ours.
4. **Per-frame code allocates nothing.** Reuse module-level scratch objects
   (`_v1`, `_q`); no `new` inside `animate()`'s call tree.

## Holding the frame rate

`quality.js` owns every setting whose cost the picture can trade away, as one
ordered ladder from `ultra` to `floor`. Frame rate is the only input — never a
GPU string or a device table, because the question is not what this machine is
but whether it is keeping up *right now*, at this window size, with this many
settlers on screen.

Two rules govern the ladder's shape. Cheapest sacrifices come first, so the
early steps (soft shadows → PCF, full-res bloom → half) are ones nobody can
see. And internal resolution rides down *with* the quality knobs only as far as
50%; going below that is reserved for the last two tiers, after every other
knob is already off, because a soft picture is a worse failure than a plain one.

The governor is deliberately reluctant, because a dropped frame is not a trend.
Four mechanisms keep it from chasing noise: a **median** filter (throws away the
worst frame in the window), **dwell** (a threshold must hold for seconds, and
climbing back up takes longer than falling), a **cooldown** after each change
(the change itself costs a hitch — don't measure during it), and a **regret
ratchet** (a tier we climbed into and fell straight back out of becomes
progressively harder to attempt again, so oscillation damps out). Only a
sustained sub-24fps reading skips ahead, two tiers at a time.

The dev panel exposes every knob as a slider. Under `auto` they are a live
readout of what the governor is doing; switch it off and they become the
controls, which is the fastest way to find out what a given effect actually
costs on real hardware.

House rules on top: plain JS (no TypeScript — the browser runs what we
commit), `camelCase` functions, `SCREAMING_CASE` for tuning constants,
comments explain *why* or *what shape*, never *what the next line does*.

## How to extend

- **New settler feature** (hat style, garden extra): extend the vocabulary in
  `structures.js`, document it in `AGENTS.md` §3, teach the validator the new
  enum value. Three files, additive, backward compatible — old configs must
  keep rendering identically.
- **New sky event**: `sky.js` owns the visuals, `main.js` wires a button and
  a vantage. Keep events deep-linkable (`#phase=...`).
- **Anything touching the contract** (schema, manifest semantics): treat as a
  breaking change; migrate every existing contributor folder in the same PR.
