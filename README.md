# 🪐 Scalable Core World

A tiny voxel planet, settled one contributor at a time.

Every settler owns a plot with a **house, a garden, and a voxel avatar** of
themselves. Click a house and the camera flies in; step through the door and
you land on a **website that settler built** about something they love. The
whole thing is a static site rendered with Three.js and hosted on GitHub Pages
— no build step, no server.

Built as a workshop playground for [Claude Code](https://claude.com/claude-code):
contributors don't place voxels by hand, their **agent** interviews them and
raises the homestead in a single pull request.

## Visit

**https://tomacco.github.io/scalable-core-world/**

- **Drag** to spin the globe, **scroll** to zoom — all the way down to terrain
  level. The planet core is always the pivot; there is no panning.
- **Click a house** (or a name in the *Settlers* roster) and the camera flies
  over: now the *house* is your orbit pivot. Return with **🌍 Planet view** or `Esc`.
- Use the sky console (top right) to summon **dawn, noon, dusk, night — or the
  aurora borealis** over the pole.
- The wilds are alive: forests, bushes, wildflowers, mushrooms, rocks — plus
  sheep, rabbits, foxes, chickens, butterflies over the flowers, and birds
  riding great circles around the planet.
- Deep links: `#phase=dusk` (or `dawn`/`noon`/`night`/`aurora`) and
  `#visit=ivan-gonzalez` jump straight to a sky event or a settler's house.

## Claim a plot

Open the repo with your coding agent and say *"I want to settle here."*
The agent will read [`AGENTS.md`](AGENTS.md) — the world's rulebook — interview
you about your avatar, your house, and your website topic, and open a PR that
touches only your own folder:

```
contributors/
├── manifest.json          ← +1 line: your slug
└── your-name/
    ├── config.json        ← avatar + house + garden
    └── site/index.html    ← your website, behind your front door
```

Plots are assigned automatically in order of arrival. There are 20.

## Run locally

```bash
git clone https://github.com/tomacco/scalable-core-world
cd scalable-core-world
python -m http.server 8080    # or: npx serve
```

Then open http://localhost:8080. (Opening `index.html` from disk won't work —
the world `fetch()`es contributor data.)

## How it's made

| Piece | Where | What |
|---|---|---|
| Planet | `src/planet.js` | Seeded-noise voxel sphere: oceans, beaches, snow caps, 20 flattened plots |
| Structures | `src/structures.js` | Config-driven houses, gardens, and avatars from merged voxel geometry |
| Sky | `src/sky.js` | Atmosphere dome, day/night cycle, stars, moon, shader-driven aurora |
| Light | `src/postfx.js` | Bloom + screen-space god rays at dawn and dusk |
| Conductor | `src/main.js` | Loads settlers, camera flights, the door-to-website transition |

Three.js is loaded from a CDN via import maps — the repository is served
exactly as committed.

## For agents

Everything you need is in **[AGENTS.md](AGENTS.md)**. `CLAUDE.md` just points
there. The one-sentence version: *interview your human, write only inside
`contributors/<your-slug>/`, append one line to the manifest, and never touch
the engine.*
