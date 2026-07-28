// Validates a settlement PR against the laws in AGENTS.md.
// Usage: node scripts/validate-contribution.mjs <baseRef>
// Env:   PR_ACTOR, REPO_OWNER — engine-territory violations become warnings
//        when the actor IS the owner (the owner maintains the engine).

import { execSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const baseRef = process.argv[2] || 'origin/main';
const actor = process.env.PR_ACTOR || '';
const owner = process.env.REPO_OWNER || '';
const actorIsOwner = actor !== '' && actor === owner;

const errors = [];
const warnings = [];

main();

function main() {
  const changed = changedFiles();
  console.log(`validating ${changed.length} changed file(s) against ${baseRef}\n`);

  checkTerritory(changed);
  const slugs = touchedSlugs(changed);
  checkSingleSettlement(slugs);
  checkManifestAppendOnly(changed);
  for (const slug of slugs) {
    checkConfig(slug);
    checkSizeBudget(slug);
    checkPII(changed.filter((f) => f.startsWith(`contributors/${slug}/`)));
  }
  report();
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
  if (b.length < a.length) return errors.push('manifest: contributors were removed');
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
  const hex = /^#[0-9a-fA-F]{6}$/;
  for (const [where, value] of colorFields(cfg)) {
    if (!hex.test(value)) errors.push(`${slug}: ${where} = "${value}" is not a #rrggbb color`);
  }
  const enums = [
    ['avatar.hair.style', cfg.avatar?.hair?.style, ['short', 'long', 'bun', 'mohawk', 'curly', 'bald']],
    ['avatar.outfit.type', cfg.avatar?.outfit?.type, ['pants', 'dress']],
    ['avatar.hat.style', cfg.avatar?.hat?.style, ['cap', 'beanie', 'crown', 'wizard', 'none']],
    ['house.size', cfg.house?.size, ['small', 'medium', 'large']],
  ];
  for (const [where, value, allowed] of enums) {
    if (value != null && !allowed.includes(value)) errors.push(`${slug}: ${where} = "${value}" (allowed: ${allowed.join(', ')})`);
  }
  const trees = cfg.garden?.trees;
  if (trees != null && (!Number.isInteger(trees) || trees < 0 || trees > 6)) errors.push(`${slug}: garden.trees must be an integer 0–6`);
  const site = cfg.site || 'site/index.html';
  if (site.includes('..') || site.startsWith('/')) errors.push(`${slug}: config.site must be a relative path inside your folder`);
  else if (!existsSync(join('contributors', slug, site))) errors.push(`${slug}: site entry "${site}" does not exist`);
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
    if (phoneHit) warnings.push(`${f}: "${phoneHit[0]}" looks like a phone number — verify it is not PII`);
  }
}

// ------------------------------------------------------------- leaves

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
