# 🪐 Claim your plot — workshop quick start

Welcome. In a few minutes you'll have a **house on the planet** with a
**website behind its door**. You never write engine code — you answer a few
questions and your agent builds your plot.

## How

1. Open this repo in **Claude Code** (or any coding agent).
2. Paste the prompt below and answer the questions it asks you.
3. Review the diff, push your branch, and open a pull request.
4. CI checks your settlement automatically; when it's green, it merges and
   your house appears at **https://tomacco.github.io/scalable-core-world/**.

You only ever edit your own `contributors/<your-handle>/` folder plus one line
in the manifest. The full rulebook is [AGENTS.md](AGENTS.md).

---

## 📋 The prompt — copy everything in this box

```text
I want to claim my plot in the Scalable Core World (this repo).

Start by reading AGENTS.md — it's the rulebook. Follow it exactly: I only get
my own folder at contributors/<my-handle>/ plus ONE appended line in
contributors/manifest.json. Never touch the engine, the docs, or anyone else's
folder, and stage files by explicit path (never `git add -A`).

Then interview me before building anything. Ask in small batches, and offer a
sensible default for every option so I can just say "default":

1. ME: my handle (use my GitHub username — no legal names), a short tagline for
   the sign over my house, and what I want my website to be about.
2. MY AVATAR: size (small villager / medium / large / house-tall GIANT), hair
   style (short, long, bun, mohawk, curly, bald) + color, skin tone, beard?,
   glasses?, outfit (pants or dress + top / bottom / shoe colors), and a hat?
   (cap, beanie, crown, wizard, or none).
3. MY HOUSE: size (small / medium / large), and colors for walls, roof, door,
   and trim. Windows lit at night?
4. MY GARDEN: platform (cozy or grand), how many trees (0–6), flower colors,
   fence?, a lamp?, a path?, and extras (bench, mailbox, pond, pumpkin,
   telescope, flag).
5. MY WEBSITE: the topic, a one-line intro, and 2–4 sections I want on the page.

After the interview:
- Create contributors/<handle>/config.json using the schema in AGENTS.md §3
  (strict JSON, #rrggbb colors, my answers).
- Scaffold contributors/<handle>/site/index.html — a real, self-contained
  static page about my topic with the sections I chose. Pick a distinctive
  font, design it with intent (look at contributors/tomacco/site for structure,
  but make it visually mine), use relative asset paths only, and no trackers or
  external network calls. No lorem-ipsum placeholder.
- Append "<handle>" as the LAST item in contributors/manifest.json (change
  nothing else in that file).
- Run:  node scripts/validate-contribution.mjs origin/main  — and fix anything
  it flags.
- If you can, start a local server (npx serve, or python -m http.server 8080)
  and open http://localhost:8080/#visit=<handle> so I can see my house, avatar,
  and site.
- Commit on a new branch named settle/<handle> with the message
  "settle: <handle> claims a plot", show me the diff, and tell me how to push
  and open a pull request.

If subagents are available, you can use this repo's avatar-artisan and
homestead-designer agents for steps 2–4.
```

---

## What happens next

- Your PR runs the **validator** (`scripts/validate-contribution.mjs`) — it
  checks you stayed in your folder, appended one manifest entry, used a valid
  config, and committed no PII, secrets, trackers, or oversized files.
- **Copilot** and the repo owner review it.
- Green + approved → merge → your house is on the planet. 🎉

Stuck? The rules and the full `config.json` schema are in
[AGENTS.md](AGENTS.md); the founder's plot in `contributors/tomacco/` is a
working example you can copy from.
