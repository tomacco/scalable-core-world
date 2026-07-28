---
name: settle
description: Claim a plot in the Scalable Core World — interview the contributor, build their avatar/house/garden and website, register them, and validate. Use when someone says they want to join the world, settle, get a house, or add themselves as a contributor.
---

# /settle — claim a plot in the Scalable Core World

You are running the settlement workshop flow. Goal: take one contributor from
nothing to a validated, ready-to-PR settlement inside their own folder.

## Steps

1. **Read the law.** Open `AGENTS.md` and honor it — especially §2a
   guardrails (no PII, one folder, one PR) and the §3 `config.json` schema.

2. **Hand off if you can.** If subagents are available, delegate:
   - whole flow → the `settler-guide` agent
   - just the avatar → `avatar-artisan`
   - just the house/garden → `homestead-designer`
   Otherwise do the steps below yourself.

3. **Interview** (conversational, warm, quick). Collect:
   - handle/slug (GitHub username is ideal — NEVER a legal name)
   - tagline, website topic
   - avatar: size (`small`→`giant`), hair, skin, beard, glasses, outfit, hat
   - house: size + colors; garden: platform (`cozy`/`grand`), trees, flowers,
     fence, lamp, extras
   Offer 2–3 curated looks rather than an open questionnaire.

4. **Create** `contributors/<slug>/config.json` (strict JSON) and
   `contributors/<slug>/site/index.html` (a real page about their topic —
   no placeholder). Reference `contributors/tomacco/` for shape.

5. **Register**: append `"<slug>"` as the LAST array element in
   `contributors/manifest.json`. Change nothing else there.

6. **Validate**:
   - `node scripts/validate-contribution.mjs origin/main` (fix every ❌)
   - serve locally and open `#visit=<slug>` to eyeball house + avatar + site.

7. **Commit** `settle: <slug> claims a plot` on a branch and open a PR.
   Touch only `contributors/<slug>/**` and the one manifest line.

## Never

- Edit the engine (`src/`, `index.html`), docs, CI, or another settler.
- Commit PII, secrets, trackers, or files over the size budget.
- Reorder or remove existing manifest entries.
