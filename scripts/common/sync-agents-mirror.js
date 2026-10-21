/**
 * Module: Workspace Governance — Agent Definition Mirror
 * File Path: scripts/common/sync-agents-mirror.js
 * Architecture Role: Single source of truth for mirroring tracked SubAgent definition templates
 *   (`.agents/subagents/agents/*.md` and `AGENTS.md`) into the gitignored plugin bundle that the
 *   Antigravity runtime actually loads, and for proving the mirror is byte-identical.
 * Dependencies & Triggers: Invoked by `sync-skills.js` after the skills mirror, by `pre-push-gate`,
 *   and manually as `node scripts/common/sync-agents-mirror.js [--check-only]`.
 * Responsibilities: Mirror agent templates and the governance rulebook; reject CRLF in mirrored
 *   Markdown; detect stale rule/analyzer/pillar figures before they reach a SubAgent prompt.
 * Exit Semantics & Design Rationale: 0 = mirror verified (or healed), 1 = drift or stale figure.
 *   The bundle is a derived, gitignored artefact, so a missing destination is a visible SKIP rather
 *   than a failure: a clean clone legitimately has no bundle, and treating that as FAIL is what made
 *   the previous guard unfixable outside a developer machine.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SUBAGENTS_AGENTS = path.join(REPO_ROOT, '.agents/subagents/agents');
const BUNDLE_ROOT = path.join(REPO_ROOT, '.agents/plugins/workspace-governance');
const BUNDLE_AGENTS = path.join(BUNDLE_ROOT, 'agents');
const ROOT_RULEBOOK = path.join(REPO_ROOT, 'AGENTS.md');
const BUNDLE_RULEBOOK = path.join(BUNDLE_ROOT, 'rules/AGENTS.md');
const CATALOG_FILE = path.join(REPO_ROOT, 'scripts/common/rule-catalog.json');

/** Figures that make a mirrored definition self-contradicting once the catalog moves. */
const STALE_FIGURE_PATTERNS = Object.freeze([
  { label: 'rule total', pattern: /(\d{3,4})\s*条(?:内置)?规则/g, expected: (c) => liveRuleFigures(c) },
  { label: 'rule total in parentheses', pattern: /（(\d{3,4})\s*条/g, expected: (c) => liveRuleFigures(c) },
  { label: 'analyzer count', pattern: /(\d{1,3})\s*(?:个)?(?:内置)?分析器/g, expected: () => new Set([30]) },
  { label: 'pillar count', pattern: /(\d)\s*大支柱/g, expected: () => new Set([6]) },
]);

/**
 * Collects every rule total a document may legitimately quote.
 *
 * @param {object} catalog - Parsed `rule-catalog.json`.
 * @returns {Set<number>} Workspace total plus each project count.
 */
function liveRuleFigures(catalog) {
  const figures = new Set([catalog.totalRules]);
  for (const value of Object.values(catalog.counts || {})) figures.add(value);
  return figures;
}

/**
 * Enumerates the mirror pairs that must stay byte-identical.
 *
 * @returns {Array<{label: string, source: string, target: string, sourceIsDir: boolean}>} Mirror pairs.
 */
function mirrorPairs() {
  return [
    { label: 'agents/', source: SUBAGENTS_AGENTS, target: BUNDLE_AGENTS, sourceIsDir: true },
    { label: 'rules/AGENTS.md', source: ROOT_RULEBOOK, target: BUNDLE_RULEBOOK, sourceIsDir: false },
  ];
}

/**
 * Reads one template and asserts the forbidden-figure contract.
 *
 * @param {string} filePath - Absolute template path.
 * @param {object} catalog - Parsed `rule-catalog.json`.
 * @returns {string[]} Violations, each naming the file, line and offending figure.
 */
function findStaleFigures(filePath, catalog) {
  const violations = [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  for (const { label, pattern, expected } of STALE_FIGURE_PATTERNS) {
    const legal = expected(catalog);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(pattern)) {
        const value = Number(match[1]);
        if (!legal.has(value)) {
          violations.push(`${rel}:${index + 1} stale ${label} ${value} (legal: ${[...legal].join(', ')})`);
        }
      }
    });
  }
  return violations;
}

/**
 * Verifies every tracked template is free of retired figures and CRLF endings.
 *
 * @returns {string[]} Violations found in the tracked source.
 */
function checkTrackedTemplates() {
  if (!fs.existsSync(SUBAGENTS_AGENTS)) {
    return [`tracked template directory missing: ${path.relative(REPO_ROOT, SUBAGENTS_AGENTS)}`];
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  const violations = [];
  const files = fs.readdirSync(SUBAGENTS_AGENTS).filter((f) => f.endsWith('.md'));
  if (files.length === 0) violations.push('tracked template directory is empty');
  for (const file of files) {
    const full = path.join(SUBAGENTS_AGENTS, file);
    if (fs.readFileSync(full, 'utf8').includes('\r\n')) violations.push(`${file}: contains CRLF`);
    violations.push(...findStaleFigures(full, catalog));
  }
  return violations;
}

/**
 * Compares source and target byte-for-byte for every mirror pair.
 *
 * @returns {{drift: string[], missingBundle: boolean}} Drift descriptions and bundle presence.
 */
function detectMirrorDrift() {
  if (!fs.existsSync(BUNDLE_ROOT)) {
    return { drift: [], missingBundle: true };
  }
  const drift = [];
  for (const pair of mirrorPairs()) {
    if (!fs.existsSync(pair.target)) {
      drift.push(`${pair.label}: mirror target missing`);
      continue;
    }
    if (!pair.sourceIsDir) {
      if (!fs.readFileSync(pair.source).equals(fs.readFileSync(pair.target))) {
        drift.push(`${pair.label}: bytes differ from ${path.relative(REPO_ROOT, pair.source)}`);
      }
      continue;
    }
    const sourceFiles = fs.readdirSync(pair.source).filter((f) => f.endsWith('.md')).sort();
    const targetFiles = fs.readdirSync(pair.target).filter((f) => f.endsWith('.md')).sort();
    const missing = sourceFiles.filter((f) => !targetFiles.includes(f));
    const extra = targetFiles.filter((f) => !sourceFiles.includes(f));
    if (missing.length > 0) drift.push(`${pair.label}: missing in mirror -> ${missing.join(', ')}`);
    if (extra.length > 0) drift.push(`${pair.label}: orphan in mirror -> ${extra.join(', ')}`);
    for (const file of sourceFiles.filter((f) => targetFiles.includes(f))) {
      if (!fs.readFileSync(path.join(pair.source, file)).equals(fs.readFileSync(path.join(pair.target, file)))) {
        drift.push(`${pair.label}: ${file} bytes differ`);
      }
    }
  }
  return { drift, missingBundle: false };
}

/**
 * Copies every mirror pair from source to target, pruning orphans.
 *
 * @returns {number} Number of files written.
 */
function syncMirror() {
  let written = 0;
  fs.mkdirSync(BUNDLE_AGENTS, { recursive: true });
  fs.mkdirSync(path.dirname(BUNDLE_RULEBOOK), { recursive: true });

  const sourceFiles = fs.readdirSync(SUBAGENTS_AGENTS).filter((f) => f.endsWith('.md'));
  const sourceSet = new Set(sourceFiles);
  for (const file of fs.readdirSync(BUNDLE_AGENTS).filter((f) => f.endsWith('.md'))) {
    if (!sourceSet.has(file)) fs.unlinkSync(path.join(BUNDLE_AGENTS, file));
  }
  for (const file of sourceFiles) {
    fs.copyFileSync(path.join(SUBAGENTS_AGENTS, file), path.join(BUNDLE_AGENTS, file));
    written += 1;
  }
  fs.copyFileSync(ROOT_RULEBOOK, BUNDLE_RULEBOOK);
  written += 1;
  return written;
}

/**
 * Runs the mirror contract: verify tracked source, then verify or heal the derived bundle.
 *
 * @param {{checkOnly: boolean}} options - `checkOnly` forbids writing.
 * @returns {number} Exit code.
 */
function run({ checkOnly }) {
  const sourceViolations = checkTrackedTemplates();
  if (sourceViolations.length > 0) {
    process.stderr.write('❌ [BLOCK] tracked agent templates violate the figure contract:\n');
    for (const v of sourceViolations) process.stderr.write(`   - ${v}\n`);
    return 1;
  }

  const before = detectMirrorDrift();
  if (before.missingBundle) {
    process.stdout.write(
      '⚠️  [SKIP] plugin agent bundle not materialised (derived artefact, gitignored); ' +
        'mirror parity not evaluated. Tracked templates verified.\n',
    );
    return 0;
  }

  if (before.drift.length === 0) {
    process.stdout.write('✔ [PASS] Agent definition mirror verified: templates and rulebook are byte-identical.\n');
    return 0;
  }

  if (checkOnly) {
    process.stderr.write(`❌ [BLOCK] agent mirror drift (${before.drift.length} item(s)):\n`);
    for (const d of before.drift) process.stderr.write(`   - ${d}\n`);
    process.stderr.write('   → run `node scripts/common/sync-agents-mirror.js` to heal.\n');
    return 1;
  }

  const written = syncMirror();
  const after = detectMirrorDrift();
  if (after.drift.length > 0) {
    process.stderr.write(`❌ [BLOCK] mirror still inconsistent after writing ${written} file(s):\n`);
    for (const d of after.drift) process.stderr.write(`   - ${d}\n`);
    return 1;
  }
  process.stdout.write(`✔ [PASS] Agent definition mirror healed (${written} file(s) written).\n`);
  return 0;
}

if (require.main === module) {
  process.exit(run({ checkOnly: process.argv.includes('--check-only') }));
}

module.exports = { run, checkTrackedTemplates, detectMirrorDrift, syncMirror, findStaleFigures };
