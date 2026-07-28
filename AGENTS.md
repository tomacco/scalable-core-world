# AGENTS.md — the laws of the Scalable Core World

This repository is a **tiny voxel planet** rendered with Three.js and served as
a static site by **GitHub Pages**. Every contributor owns one plot of land with
a house, a garden, and an avatar. Clicking a house in the 3D world opens the
website that contributor built about a topic they love.

You are (most likely) a coding agent helping a contributor settle here.
This file is the whole rulebook. Follow it exactly.

---

## 1. Territory — where you may and may not write

```
scalable-core-world/
├── index.html            ⛔ engine — do not touch
├── src/                  ⛔ engine — do not touch
├── AGENTS.md, CLAUDE.md  ⛔ law — do not touch
├── README.md             ⛔ do not touch
└── contributors/
    ├── manifest.json     ⚠️ shared ledger — APPEND ONE LINE ONLY
    └── <your-slug>/      ✅ your land — full freedom inside
        ├── config.json      (avatar + house + garden, schema below)
        └── site/
            └── index.html   (the contributor's personal website)
```

Rules, in order of importance:

1. **Never modify the engine** (`index.html`, anything in `src/`), the docs, or
   the GitHub Pages plumbing (`.nojekyll`). If the engine has a bug, open an
   issue instead.
2. **Never modify another contributor's folder.** Not even formatting fixes.
3. In `contributors/manifest.json`, **only append your slug** to the end of the
   `contributors` array. Never reorder or remove entries — the array index
   determines plot assignment, so reordering would move everyone's houses.
4. Everything inside `contributors/<your-slug>/` is yours: add pages, images,
   CSS, whatever the website needs.

Your slug is the contributor's **public handle** in kebab-case (lowercase,
hyphens) — their GitHub username or a chosen alias, e.g. `tomacco`. It must be
unique in the manifest. **Never use a legal full name as a slug** (see §2a).

---

## 2. The interview — ask your developer before building

Do not invent a persona. Ask the contributor these questions (conversationally,
not as a form) and map the answers onto the config schema:

**Identity**
- What **handle or alias** should appear on the sign above your house?
  (GitHub username is the natural choice — never push for a legal name.)
- One short tagline (a few words) shown when visitors arrive?
- What topic do you want your website to be about?

**Avatar** (how their voxel self looks)
- How would you like your avatar to present? Ask concretely: hair style
  (`short`, `long`, `bun`, `mohawk`, `curly`, `bald`) and hair color; skin tone;
  beard or not; glasses or not; outfit — pants or dress, and its colors
  (top / bottom / shoes); a hat? (`cap`, `beanie`, `crown`, `wizard`, or none).
- Favorite colors — use them in the outfit, flowers, and website palette.

**Homestead**
- House size (`small`, `medium`, `large`) and colors (walls, roof, door, trim).
- Garden: how many trees (0–6), flower colors, fence yes/no, a lamp?, and up to
  a few extras from: `bench`, `mailbox`, `pond`, `pumpkin`, `telescope`, `flag`.

If an answer is missing, use tasteful defaults — but never skip the interview.

---

## 2a. Guardrails — non-negotiable

These rules are enforced by CI on every pull request, by `CODEOWNERS` on the
engine, and by an iframe sandbox at runtime. A violation blocks the merge.

### Privacy — no PII, anywhere
This is a public repository on a public website. Contributors are represented
by **handles, not identities**.

- ✅ Allowed: a public handle/alias, links to public profiles the contributor
  chooses to share (GitHub, personal site), a fictional voxel avatar.
- ⛔ Never commit: legal full names, email addresses, phone numbers, home or
  work addresses, birthdays, government IDs, employer/team/org details,
  photographs of people, or geolocation data (strip EXIF from any image).
- This applies to *everyone*: don't mention other people's PII on your site
  either. If the contributor dictates text containing PII, warn them and ask
  for a redacted version.

### Territory — you get one folder
- Write only inside `contributors/<your-slug>/`, plus the single appended
  line in `manifest.json`. **Nothing else. Ever.** Not the engine, not the
  docs, not the CI, not another settler's land, not "just a small fix".
- One pull request = one contributor. Don't batch settlements.

### Content standards
- The world is shown on conference screens: keep everything you commit
  appropriate for that (no NSFW, no harassment, no hate, no politics wars).
- No impersonation: don't present your plot as someone else's.

### Technical guardrails
- **No secrets**: no API keys, tokens, or credentials in any file — the repo
  is public and history is forever.
- **No tracking**: no analytics, fingerprinting, ad pixels, or third-party
  data collection on your site.
- **No heavy payloads**: your folder must stay under **5 MB** total, no
  single file over 2 MB. Optimize images.
- **Sandbox-aware**: your site runs in a sandboxed iframe with an opaque
  origin — `window.parent`, cookies, `localStorage`, and same-origin
  `fetch()` are unavailable. Keep pages self-contained; plain `<img>`,
  `<link>`, and `<script src>` assets work fine.
- No autoplaying audio, no crypto miners, no service workers, no obfuscated
  or minified-beyond-review code.

---

## 3. `config.json` schema

Every field is optional except `name`; omitted fields fall back to defaults.
Colors are hex strings.

```jsonc
{
  "name": "ada",                       // required — public handle on the sign
  "tagline": "first of the programmers",
  "site": "site/index.html",           // entry page, relative to your folder

  "avatar": {
    "skin": "#e0ac69",
    "eyes": "#26262e",
    "hair": { "style": "long", "color": "#2c1b10" },  // short|long|bun|mohawk|curly|bald
    "beard": false,
    "glasses": true,
    "glassesColor": "#1b1b22",
    "outfit": {
      "type": "dress",                 // "pants" | "dress"
      "top": "#c94f30", "bottom": "#2b3a67", "shoes": "#26211c"
    },
    "hat": { "style": "beanie", "color": "#b8332f" }  // cap|beanie|crown|wizard, or null
  },

  "house": {
    "size": "medium",                  // small | medium | large
    "wall": "#e8d8b0", "roof": "#b5442e",
    "door": "#5b3a1e", "trim": "#f4efe4",
    "windowsLit": true                 // windows glow at night
  },

  "garden": {
    "trees": 2,                        // 0–6
    "flowers": ["#ff5f8f", "#ffd23f"], // list of petal colors; [] for none
    "fence": true,
    "lamp": true,
    "path": true,
    "extras": ["bench", "mailbox"]     // bench|mailbox|pond|pumpkin|telescope|flag
  }
}
```

Strict JSON (no comments, no trailing commas) in the actual file — the engine
`fetch()`es and `JSON.parse()`s it. A malformed config means the settler is
silently skipped and their plot stays empty.

---

## 4. The website behind the door

- Entry point: `contributors/<slug>/site/index.html`.
- It opens **inside an iframe** over the 3D world, and must also work when
  visited directly.
- **Static only.** GitHub Pages runs no servers: plain HTML/CSS/JS, no build
  step, no framework that needs compiling. Assets live inside your folder.
- **Relative paths only** (`./photo.jpg`, not `/photo.jpg`). The site is served
  from a project subpath (`/scalable-core-world/`), so absolute paths break.
- External fonts/CDNs are allowed, but keep the page self-sufficient enough to
  survive without them.
- Make it *good*. This is the contributor's face to the world: a real topic
  they love, designed with intent — not a default-font "hello world".

---

## 5. Settling ceremony — the exact steps

1. Read this file. Interview your developer (§2).
2. Create `contributors/<slug>/config.json` (§3).
3. Create `contributors/<slug>/site/index.html` (§4).
4. Append `"<slug>"` to the array in `contributors/manifest.json` — last
   position, nothing else changed.
5. Verify locally (§6).
6. Commit with message `settle: <handle> claims a plot` and open a pull request
   (or push, if the workshop uses direct pushes). Touch only the files above.

Plots are assigned by manifest order automatically — there are 20; the engine
wraps around if the world ever overflows.

---

## 6. Verify before you commit

From the repository root:

```bash
python -m http.server 8080        # or: npx serve
```

Open `http://localhost:8080` and check:

- [ ] The planet loads and your house stands on a plot with your name over it.
- [ ] Your avatar looks the way the contributor asked.
- [ ] Clicking the house → "Enter the house" shows your website.
- [ ] The browser console shows no errors (a skipped settler logs a warning
      naming your slug — that means your `config.json` is malformed).
- [ ] `manifest.json` diff shows exactly one added line.

`fetch()` does not work over `file://` — always use a local server.

---

## 7. GitHub Pages notes (how this renders at all)

- The site deploys straight from the `main` branch root; there is no build.
- `.nojekyll` at the root tells GitHub not to run Jekyll — leave it alone.
- Everything must therefore be committed ready-to-serve: no TypeScript, no
  SASS, no bundlers anywhere in the repository.
- Case matters on Pages: `Site/Index.html` ≠ `site/index.html`. Keep
  everything lowercase.

---

## 8. For engine maintainers (humans)

Settler agents: this section is not for you — stay in your folder.

The engine's design and coding style (kernel/userland split, the
[Primera Plana](https://github.com/tomacco/primera-plana) headline style and
its documented exceptions) live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Engine PRs require owner review via CODEOWNERS.
