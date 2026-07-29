// Validates a settlement PR against the laws in AGENTS.md.
// Usage: node scripts/validate-contribution.mjs <baseRef>
// Env:   PR_ACTOR, REPO_OWNER — engine-territory violations become warnings
//        when the actor IS the owner (the owner maintains the engine).

import { execSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const baseRef = process.argv[2] || 'origin/main';
const actor = process.env.PR_ACTOR || '';
const owner = process.env.REPO_OWNER || '';
const actorIsOwner = actor !== '' && actor === owner;

const errors = [];
const warnings = [];

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

main();

function main() {
  const changed = changedFiles();
  console.log(`validating ${changed.length} changed file(s) against ${baseRef}\n`);

  checkTerritory(changed);
  const slugs = touchedSlugs(changed);
  checkSingleSettlement(slugs);
  checkManifestAppendOnly(changed);
  checkPlotCollisions(changed);
  for (const slug of slugs) {
    checkConfig(slug);
    checkSizeBudget(slug);
    const own = changed.filter((f) => f.startsWith(`contributors/${slug}/`));
    checkPII(own);
    checkSiteContent(own);
  }
  reviewerSummary(changed, slugs);
  report();
}

// A glance-friendly digest so a human reviewer sees the load-bearing facts
// (engine files touched, folders added) without trusting the commit title.
function reviewerSummary(changed, slugs) {
  const outside = changed.filter((f) => !f.startsWith('contributors/'));
  console.log('── review summary ──');
  console.log(`settler folders touched: ${slugs.length ? slugs.join(', ') : 'none'}`);
  console.log(`files outside contributors/: ${outside.length ? outside.join(', ') : 'none'}`);
  console.log('────────────────────\n');
}

// ------------------------------------------------------------ checks

function checkTerritory(changed) {
  const outside = changed.filter((f) => !f.startsWith('contributors/'));
  if (outside.length === 0) return;
  const msg = `files changed outside contributors/: ${outside.join(', ')}`;
  if (actorIsOwner) warnings.push(`${msg} (allowed: actor is the repo owner)`);
  else errors.push(`${msg} — the engine, docs, and CI are owner territory (AGENTS.md §1)`);
}

function checkSingleSettlement(slugs) {
  if (slugs.length > 1) {
    errors.push(`PR touches ${slugs.length} contributor folders (${slugs.join(', ')}) — one PR settles one contributor`);
  }
}

function checkManifestAppendOnly(changed) {
  if (!changed.includes('contributors/manifest.json')) return;
  let before;
  try {
    before = JSON.parse(execSync(`git show ${baseRef}:contributors/manifest.json`, { encoding: 'utf8' }));
  } catch {
    warnings.push('could not read manifest from base ref — skipping append-only check');
    return;
  }
  const after = JSON.parse(readFileSync('contributors/manifest.json', 'utf8'));
  const a = before.contributors || [], b = after.contributors || [];
  if (b.length < a.length) {
    // Settlers never remove anyone — but the owner may retire a settler
    // (test accounts, departures), as long as the survivors keep their
    // relative order so the plot shuffle is the predictable index shift.
    const removed = a.filter((s) => !b.includes(s));
    if (actorIsOwner && isSubsequence(b, a)) {
      warnings.push(`manifest: owner retired settler(s): ${removed.join(', ')} — later plots shift down by index`);
      return;
    }
    return errors.push('manifest: contributors were removed');
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return errors.push(`manifest: existing order changed at index ${i} ("${a[i]}" → "${b[i]}") — plots are assigned by index; append only`);
  }
  const added = b.slice(a.length);
  if (added.length > 1) errors.push(`manifest: ${added.length} slugs appended — one settlement per PR`);
  for (const slug of added) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) errors.push(`manifest: slug "${slug}" is not kebab-case`);
    if (!existsSync(join('contributors', slug, 'config.json'))) errors.push(`manifest: slug "${slug}" has no contributors/${slug}/config.json`);
  }
}

// Two settlers must never share a plot. Plots are assigned by manifest
// index, so the two ways to collide are a duplicated slug and an overflow
// past the world's plot count (the engine wraps index % PLOT_COUNT, which
// would stack a newcomer's house on the founder's lawn).
function checkPlotCollisions(changed) {
  if (!changed.includes('contributors/manifest.json')) return;
  let list;
  try {
    list = JSON.parse(readFileSync('contributors/manifest.json', 'utf8')).contributors || [];
  } catch {
    return; // unparseable manifest is already reported elsewhere
  }
  const dupes = [...new Set(list.filter((s, i) => list.indexOf(s) !== i))];
  if (dupes.length) errors.push(`manifest: duplicate slug(s) ${dupes.join(', ')} — a settler can hold only one plot`);
  const plotCount = readPlotCount();
  if (plotCount != null && list.length > plotCount) {
    errors.push(`manifest: ${list.length} settlers but the world has ${plotCount} plots — the engine would wrap and stack two houses on one plot`);
  }
}

function readPlotCount() {
  try {
    const m = readFileSync('src/planet.js', 'utf8').match(/PLOT_COUNT\s*=\s*(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

function checkConfig(slug) {
  const path = join('contributors', slug, 'config.json');
  if (!existsSync(path)) return errors.push(`${slug}: missing config.json`);
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return errors.push(`${slug}: config.json is not valid JSON (${e.message}) — the engine will silently skip this settler`);
  }
  if (typeof cfg.name !== 'string' || !cfg.name.trim()) errors.push(`${slug}: config.name (public handle) is required`);

  // Rendered strings must be plain text — the engine shows name/tagline in the
  // host page. Reject angle brackets, control chars, and absurd lengths so a
  // config can never carry markup or an injection payload.
  for (const [where, value] of textFields(cfg)) {
    if (/[<>]/.test(value)) errors.push(`${slug}: ${where} may not contain "<" or ">" — plain text only (prevents injection)`);
    if (CONTROL_CHARS.test(value)) errors.push(`${slug}: ${where} contains control characters`);
    if (value.length > 120) errors.push(`${slug}: ${where} is ${value.length} chars — keep it under 120`);
  }

  const hex = /^#[0-9a-fA-F]{6}$/;
  for (const [where, value] of colorFields(cfg)) {
    if (!hex.test(value)) errors.push(`${slug}: ${where} = "${value}" is not a #rrggbb color`);
  }
  const enums = [
    ['avatar.size', cfg.avatar?.size, ['small', 'medium', 'large', 'giant']],
    ['avatar.hair.style', cfg.avatar?.hair?.style, ['short', 'long', 'bun', 'mohawk', 'curly', 'bald']],
    ['avatar.outfit.type', cfg.avatar?.outfit?.type, ['pants', 'dress']],
    ['avatar.hat.style', cfg.avatar?.hat?.style, ['cap', 'beanie', 'crown', 'wizard', 'none']],
    ['house.size', cfg.house?.size, ['small', 'medium', 'large']],
    ['garden.platform', cfg.garden?.platform, ['cozy', 'grand']],
  ];
  for (const [where, value, allowed] of enums) {
    if (value != null && !allowed.includes(value)) errors.push(`${slug}: ${where} = "${value}" (allowed: ${allowed.join(', ')})`);
  }
  const trees = cfg.garden?.trees;
  if (trees != null && (!Number.isInteger(trees) || trees < 0 || trees > 6)) errors.push(`${slug}: garden.trees must be an integer 0–6`);
  checkSitePath(slug, cfg.site || 'site/index.html');
}

// config.site must resolve to a plain relative path inside the contributor's
// own folder — no traversal, no absolute paths (unix OR windows), no URLs.
function checkSitePath(slug, site) {
  if (typeof site !== 'string' || !site.trim()) return errors.push(`${slug}: config.site must be a non-empty string`);
  if (site.includes('..')) return errors.push(`${slug}: config.site may not contain ".." (traversal)`);
  if (site.startsWith('/') || /^[a-zA-Z]:/.test(site) || site.includes('\\')) return errors.push(`${slug}: config.site must be a relative path (no leading "/", drive letter, or backslash)`);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(site)) return errors.push(`${slug}: config.site may not be a URL`);
  const base = resolve('contributors', slug);
  const target = resolve(base, site);
  if (target !== base && !target.startsWith(base + sep)) return errors.push(`${slug}: config.site "${site}" escapes your folder`);
  if (!existsSync(join('contributors', slug, site))) errors.push(`${slug}: site entry "${site}" does not exist`);
}

function colorFields(cfg) {
  const out = [];
  const walk = (obj, path) => {
    if (obj == null || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (typeof v === 'string' && v.startsWith('#')) out.push([p, v]);
      else if (Array.isArray(v)) v.forEach((item, i) => { if (typeof item === 'string' && item.startsWith('#')) out.push([`${p}[${i}]`, item]); });
      else walk(v, p);
    }
  };
  walk(cfg, '');
  return out;
}

// every non-color string in the config (these may be rendered)
function textFields(cfg) {
  const out = [];
  const walk = (obj, path) => {
    if (obj == null || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (typeof v === 'string' && !v.startsWith('#')) out.push([p, v]);
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p);
    }
  };
  walk(cfg, '');
  return out;
}

function checkSizeBudget(slug) {
  const dir = join('contributors', slug);
  if (!existsSync(dir)) return;
  let total = 0;
  const files = execSync(`git ls-files -- "${dir}"`, { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of files) {
    if (!existsSync(f)) continue;
    const size = statSync(f).size;
    total += size;
    if (size > 2 * 1024 * 1024) errors.push(`${f}: ${(size / 1048576).toFixed(1)} MB — single files must stay under 2 MB`);
  }
  if (total > 5 * 1024 * 1024) errors.push(`${dir}: ${(total / 1048576).toFixed(1)} MB total — folders must stay under 5 MB`);
}

function checkPII(files) {
  const email = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phone = /(?:\+\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?)\d{3}[ .-]?\d{3,4}\b/;
  const textExt = /\.(html?|css|js|mjs|json|md|txt|svg)$/i;
  for (const f of files) {
    if (!textExt.test(f) || !existsSync(f)) continue;
    const text = readFileSync(f, 'utf8');
    const emailHit = text.match(email);
    if (emailHit) errors.push(`${f}: contains an email address ("${emailHit[0]}") — no PII (AGENTS.md §2a)`);
    const phoneHit = text.match(phone);
    if (phoneHit) errors.push(`${f}: contains "${phoneHit[0]}" — looks like a phone number; no PII (AGENTS.md §2a). If this is not a phone, reword it.`);
  }
}

// Scans site source for behavior AGENTS.md §2a forbids but that the sandbox
// alone can't guarantee: parent-frame probing, off-site network calls,
// trackers, service workers, and committed secrets.
function checkSiteContent(files) {
  const codeExt = /\.(html?|js|mjs)$/i;
  const RULES = [
    [/\bwindow\.(parent|top)\b/, 'reaches window.parent/top (frame-breakout attempt)'],
    [/\bpostMessage\s*\(/, 'uses postMessage to the host page'],
    [/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(\s*['"`]?https?:/i, 'makes an off-site network request (no tracking/beacons — AGENTS.md §2a)'],
    [/navigator\.sendBeacon\s*\(/, 'uses navigator.sendBeacon (tracking)'],
    [/serviceWorker\s*\.\s*register\s*\(/, 'registers a service worker (not allowed)'],
    [/<script[^>]+src\s*=\s*['"]https?:\/\/(?!(?:cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com))/i, 'loads a third-party script from an unapproved host'],
    [/\bsk_live_[a-zA-Z0-9]{8,}/, 'contains a live secret key (sk_live_…)'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'contains an AWS access key id'],
    [/\bghp_[a-zA-Z0-9]{20,}/, 'contains a GitHub token (ghp_…)'],
    [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'contains a private key'],
  ];
  for (const f of files) {
    if (!codeExt.test(f) || !existsSync(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const [re, why] of RULES) {
      if (re.test(text)) errors.push(`${f}: ${why}`);
    }
  }
}

// ------------------------------------------------------------- leaves

// true when every element of sub appears in full, in the same order
function isSubsequence(sub, full) {
  let i = 0;
  for (const s of full) if (i < sub.length && sub[i] === s) i++;
  return i === sub.length;
}

function changedFiles() {
  const out = execSync(`git diff --name-only --diff-filter=ACMR ${baseRef}...HEAD`, { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function touchedSlugs(changed) {
  const slugs = new Set();
  for (const f of changed) {
    const m = f.match(/^contributors\/([^/]+)\//);
    if (m) slugs.add(m[1]);
  }
  return [...slugs];
}

function report() {
  for (const w of warnings) console.log(`⚠️  ${w}`);
  for (const e of errors) console.log(`❌ ${e}`);
  if (errors.length) {
    console.log(`\n${errors.length} violation(s). Read AGENTS.md and amend the PR.`);
    process.exit(1);
  }
  console.log('\n✅ contribution respects the laws of the core world');
}
