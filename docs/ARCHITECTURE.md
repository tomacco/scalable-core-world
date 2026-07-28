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
| Review | `.github/CODEOWNERS` | engine changes without owner approval |
| CI | `scripts/validate-contribution.mjs` | territory, schema, size, PII violations |
| Runtime | `<iframe sandbox>` + `JSON.parse` | anything that slipped through |

Never rely on only the social layer. Agents are obedient but fallible;
the mechanical layers make the rules true rather than merely stated.

## Engine module map

No build step, no framework, no state library. Three.js from a CDN via import
maps; ES modules straight to the browser. Every module owns one concern and
they compose in `main.js` only — modules never import each other sideways
except through `noise.js` (a shared leaf) and `planet.js` (the terrain
authority).

| Module | Owns | Depends on |
|---|---|---|
| `noise.js` | deterministic seeded noise | — |
| `planet.js` | terrain field, voxelization, plots, wild spots | noise |
| `structures.js` | houses, gardens, avatars, animals, labels | noise |
| `sky.js` | atmosphere, stars, sun/moon, aurora | noise |
| `postfx.js` | bloom, god rays | three/addons |
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
