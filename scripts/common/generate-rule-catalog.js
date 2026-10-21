/**
 * Module: Workspace Rule Catalog Generator & SSOT Consolidator
 * File Path: scripts/common/generate-rule-catalog.js
 * Architecture Role: Single source of truth consolidator for all active static analysis and review rules
 *   across auto-refactor, workspace-timing, WebGames, and global tooling.
 * Dependencies & Triggers: Consumes registry.js, review-rules.json, and audit_config.py;
 *   invoked by audit-all, pre-commit-gate, pre-push-gate, CI, and local verification.
 * Responsibilities:
 *   1. Discover and aggregate rule metadata across all sub-projects;
 *   2. Validate standard 3-3-3 topology, severity mappings, and non-empty summaries;
 *   3. Generate canonical rule-catalog.json (SSOT) or assert zero drift in check-only mode.
 * Exit Semantics & Design Rationale: Exits 0 on clean catalog generation or parity check, 1 on schema/drift error.
 *   Provides immutable baseline reference preventing rule ID hallucinations across commits and PRs.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT_FILE = path.join(__dirname, 'rule-catalog.json');
const SOURCE_DIR = path.join(__dirname, 'rule-sources');
const AUTO_REFACTOR_SOURCE = path.join(SOURCE_DIR, 'auto-refactor-rules.json');
const WEBGAMES_SOURCE = path.join(SOURCE_DIR, 'webgames-rules.json');
const FRACTAL_GIT_SOURCE = path.join(SOURCE_DIR, 'fractal-git-rules.json');
const GLOBAL_SOURCE = path.join(SOURCE_DIR, 'global-rules.json');

const PROJECT_COUNT_KEYS = Object.freeze({
  'auto-refactor': 'autoRefactor',
  'workspace-timing': 'workspaceTiming',
  WebGames: 'webGames',
  'fractal-git': 'fractalGit',
  'global-tooling': 'globalTooling',
});

/** Tracked declaration the canonical-id pattern and legacy reason are read from. */
const RULE_TYPES_SOURCE = path.join(ROOT, 'auto-refactor/src/core/rules/types.ts');

/**
 * Reads one exported `const NAME = <literal>;` declaration out of the rule-types source.
 *
 * The canonical-id regex and the legacy-reason string are owned by the engine. Copying either one
 * into this consolidator would let the two drift apart silently: a widened pattern in the engine
 * would keep 15 historical ids marked non-canonical here, and the catalog would report a defect the
 * engine no longer has. Reading the declaration keeps one definition of "canonical".
 *
 * @param {string} name - Exported constant name.
 * @returns {string} Raw text of the literal, without surrounding quotes or slashes.
 */
function readTypesLiteral(name) {
  if (!fs.existsSync(RULE_TYPES_SOURCE)) {
    throw new Error(`cannot derive '${name}': ${path.relative(ROOT, RULE_TYPES_SOURCE)} is missing`);
  }
  const source = fs.readFileSync(RULE_TYPES_SOURCE, 'utf8');
  const declaration = new RegExp(`^export const ${name} = \\/(.+)\\/([a-z]*);`, 'm').exec(source);
  if (declaration) return String.raw`${declaration[1]}`;
  const verbatim = new RegExp(`^export const ${name} = '([^']+)';`, 'm').exec(source);
  if (verbatim) return verbatim[1];
  throw new Error(`cannot derive '${name}': no exported literal declaration in the rule-types source`);
}

/** @type {RegExp|null} */
let cachedRuleIdPattern = null;

/**
 * Returns the engine's canonical rule-id pattern, derived from its single declaration.
 *
 * @returns {RegExp} Non-global pattern, safe to reuse across calls.
 */
function ruleIdPattern() {
  if (cachedRuleIdPattern === null) cachedRuleIdPattern = new RegExp(readTypesLiteral('RULE_ID_PATTERN'));
  return cachedRuleIdPattern;
}

/** Returns the fallback legacy reason, read lazily so importing this module never throws. */
function legacyReasonFallback() {
  return readTypesLiteral('LEGACY_REASON_ID_NOT_CANONICAL');
}

/**
 * Loads a committed rule source catalog and rejects empty or missing sources.
 *
 * @param {string} file - Absolute source catalog path.
 * @param {string} label - Human-readable source label for diagnostics.
 * @returns {Array<object>} Rule entries declared by the source catalog.
 */
function readRuleSource(file, label) {
  if (!fs.existsSync(file)) {
    throw new Error(`${label} source missing: ${path.relative(ROOT, file)}`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : parsed.rules;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${label} source is empty: ${path.relative(ROOT, file)}`);
  }
  return list;
}

function mapRuleEntry(r) {
  if (!r || !r.id) return null;
  const canonical = typeof r.canonical === 'boolean' ? r.canonical : ruleIdPattern().test(r.id);
  const entry = {
    id: r.id,
    project: 'auto-refactor',
    family: r.family || 'general',
    severity: r.defaultSeverity || r.severity || 'error',
    summary: r.summary || '',
    canonical,
  };
  if (!canonical) entry.legacyReason = r.legacyReason || legacyReasonFallback();
  return entry;
}

function collectAutoRefactorRules() {
  const registryPath = path.join(ROOT, 'auto-refactor/dist/core/rules/registry.js');
  if (fs.existsSync(registryPath)) {
    try {
      const { RULE_REGISTRY } = require(registryPath);
      const list = Array.isArray(RULE_REGISTRY) ? RULE_REGISTRY : Object.values(RULE_REGISTRY);
      const mapped = list.map(mapRuleEntry).filter(Boolean);
      if (mapped.length > 0) return mapped;
    } catch (err) {
      console.warn('Warning: Could not load auto-refactor compiled registry:', err.message);
    }
  }

  return readRuleSource(AUTO_REFACTOR_SOURCE, 'auto-refactor rules registry snapshot').map((r) => {
    const canonical = typeof r.canonical === 'boolean' ? r.canonical : ruleIdPattern().test(r.id);
    const entry = {
      id: r.id,
      project: 'auto-refactor',
      family: r.family || 'general',
      severity: r.severity || 'error',
      summary: r.summary || '',
      canonical,
    };
    if (!canonical) entry.legacyReason = r.legacyReason || legacyReasonFallback();
    return entry;
  });
}

/**
 * Projects one checker and its child rules into catalog entries.
 *
 * The theme family comes from `checker.family` and the execution layer from `checker.layer`; these
 * are orthogonal axes and must not be collapsed. Before this split, `family` was assigned
 * `checker.layer`, which made the column mean a theme in four projects and a layer in the fifth, so
 * no cross-project family aggregate could be compared. A checker without a declared family aborts
 * the run rather than falling back to a layer: a silent fallback is what produced that ambiguity.
 *
 * @param {object} checker - One entry of `review-rules.json#checkers`.
 * @param {Array<object>} rules - Collector for emitted catalog entries.
 * @returns {void}
 */
function processCheckerRules(checker, rules) {
  if (!checker.family) {
    throw new Error(
      `workspace-timing checker '${checker.id}' declares no theme family; ` +
        'add one to workspace-timing/scripts/config/review-rules.json rather than deriving it from layer',
    );
  }
  const base = {
    project: 'workspace-timing',
    family: checker.family,
    layer: checker.layer,
    severity: 'error',
  };
  if (checker.id) {
    rules.push({ ...base, id: checker.id, summary: checker.title || '' });
  }
  for (const rid of checker.ruleIds || []) {
    if (!rid || rid === checker.id) continue;
    rules.push({ ...base, id: rid, summary: `${checker.title} (${rid})` });
  }
}

function collectWorkspaceTimingRules() {
  const rules = [];
  const wtPath = path.join(ROOT, 'workspace-timing/scripts/config/review-rules.json');
  if (!fs.existsSync(wtPath)) {
    return rules;
  }

  try {
    const config = JSON.parse(fs.readFileSync(wtPath, 'utf8'));
    for (const checker of config.checkers || []) {
      processCheckerRules(checker, rules);
    }
  } catch (err) {
    console.warn('Warning: Could not load workspace-timing review rules:', err.message);
  }
  return rules;
}

function collectWebGamesRules() {
  return readRuleSource(WEBGAMES_SOURCE, 'WebGames rule catalog').map((r) => ({
    id: r.id,
    project: 'WebGames',
    family: r.family || r.id.split('-')[0],
    severity: r.severity || 'error',
    summary: r.summary || '',
  }));
}

/**
 * Projects fractal-git rules, whose ids carry a project namespace segment.
 *
 * `FGT-ALG-001` reads as [namespace]-[family]-[topic]-[sequence]: `FGT` names the project, `ALG`
 * names the theme. Treating `FGT` as the family would collapse 17 rules into one bucket and hide
 * the whole kernel taxonomy, so the second segment is the family and the namespace is asserted
 * rather than assumed.
 *
 * @param {Array<object>} entries - Source rule entries.
 * @returns {Array<object>} Catalog entries.
 */
function collectFractalGitRules() {
  return readRuleSource(FRACTAL_GIT_SOURCE, 'fractal-git rule catalog').map((r) => {
    const segments = r.id.split('-');
    if (segments.length < 3 || segments[0] !== 'FGT') {
      throw new Error(`fractal-git rule '${r.id}' does not follow [NS]-[FAMILY]-[TOPIC]-[SEQ]`);
    }
    return {
      id: r.id,
      project: 'fractal-git',
      namespace: segments[0],
      family: r.family || segments[1],
      severity: r.severity || 'error',
      summary: r.summary || '',
    };
  });
}

function collectCommitMsgRules() {
  const termsFile = path.join(__dirname, 'commit-msg-forbidden-terms.json');
  if (!fs.existsSync(termsFile)) return [];
  try {
    const config = JSON.parse(fs.readFileSync(termsFile, 'utf8'));
    return (config.rules || []).map((r) => ({
      id: r.id,
      project: 'global-tooling',
      family: 'CMG',
      severity: r.severity || 'error',
      summary: r.title || 'Commit message style and text governance rule',
    }));
  } catch (err) {
    console.warn('Warning: Could not load commit-msg-forbidden-terms.json:', err.message);
    return [];
  }
}

function collectPlatformGovernanceRules() {
  return readRuleSource(GLOBAL_SOURCE, 'global tooling rule catalog').map((r) => ({
    id: r.id,
    project: 'global-tooling',
    family: r.family || r.id.split('-')[0],
    severity: r.severity || 'error',
    summary: r.summary || '',
  }));
}

function collectGlobalToolingRules() {
  const commitRules = collectCommitMsgRules();
  const platformRules = collectPlatformGovernanceRules();
  const dedup = new Map();
  for (const r of [...commitRules, ...platformRules]) {
    dedup.set(r.id, r);
  }
  return Array.from(dedup.values());
}

/**
 * Aggregates deduplicated rule counts by owning project after first-wins resolution.
 *
 * @param {Array<object>} rules - Final catalog rule list.
 * @returns {Record<string, number>} Counts keyed by catalog project counters.
 */
function buildProjectCounts(rules) {
  const counts = { autoRefactor: 0, workspaceTiming: 0, webGames: 0, fractalGit: 0, globalTooling: 0 };
  for (const rule of rules) {
    const key = PROJECT_COUNT_KEYS[rule.project];
    if (key) counts[key] += 1;
  }
  return counts;
}

/**
 * Asserts structural invariants of a generated catalog before comparison or write.
 *
 * @param {Array<object>} rules - Final catalog rule list.
 * @param {Record<string, number>} counts - Deduplicated per-project counts.
 * @returns {void}
 */
function assertCatalogIntegrity(rules, counts) {
  const ids = new Set();
  for (const rule of rules) {
    if (!rule.id || !rule.project || !rule.family || !rule.severity || !rule.summary) {
      throw new Error(`Rule entry lacks mandatory fields: ${JSON.stringify(rule)}`);
    }
    if (ids.has(rule.id)) {
      throw new Error(`Duplicate rule id detected: ${rule.id}`);
    }
    ids.add(rule.id);
  }
  const countSum = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (countSum !== rules.length) {
    throw new Error(`Count sum ${countSum} does not match rule total ${rules.length}`);
  }
}

function generate(checkOnly = false) {
  console.log('🔄 Consolidating workspace rule catalog...');
  const arRules = collectAutoRefactorRules();
  const wtRules = collectWorkspaceTimingRules();
  const wgRules = collectWebGamesRules();
  const fgRules = collectFractalGitRules();
  const globalRules = collectGlobalToolingRules();

  const ruleMap = new Map();

  for (const r of [...arRules, ...wtRules, ...wgRules, ...fgRules, ...globalRules]) {
    if (!ruleMap.has(r.id)) {
      ruleMap.set(r.id, r);
    }
  }

  const generatedRules = Array.from(ruleMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  const counts = buildProjectCounts(generatedRules);
  assertCatalogIntegrity(generatedRules, counts);

  if (checkOnly) {
    if (!fs.existsSync(OUTPUT_FILE)) {
      console.error(`❌ [DRIFT] Rule catalog file missing on disk: ${OUTPUT_FILE}`);
      process.exit(1);
    }
    const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    const existingMap = new Map((existing.rules || []).map((r) => [r.id, r]));

    const missingOnDisk = generatedRules.filter((r) => !existingMap.has(r.id)).map((r) => r.id);
    const orphanOnDisk = (existing.rules || []).filter((r) => !ruleMap.has(r.id)).map((r) => r.id);
    const existingCountSum = Object.values(existing.counts || {}).reduce((sum, value) => sum + value, 0);

    if (missingOnDisk.length > 0 || orphanOnDisk.length > 0) {
      console.error(`❌ [RCFG-RULE-DRIFT] Detected rule catalog drift between registry and disk!`);
      if (missingOnDisk.length > 0) console.error(`   Missing on disk: ${missingOnDisk.join(', ')}`);
      if (orphanOnDisk.length > 0) console.error(`   Orphan on disk: ${orphanOnDisk.join(', ')}`);
      process.exit(1);
    }

    if (existing.totalRules !== existing.rules.length || existingCountSum !== existing.totalRules) {
      console.error(
        `❌ [RCFG-COUNTS-001] Catalog counters are inconsistent: totalRules=${existing.totalRules}, rules=${existing.rules.length}, countsSum=${existingCountSum}. Run with --write to regenerate.`,
      );
      process.exit(1);
    }

    console.log(`✅ [PASS] Rule catalog is in 100% zero-drift parity with registry (${generatedRules.length} rules).`);
    return;
  }

  const catalog = {
    schema: 'workspace-rule-catalog/v1',
    generatedAt: new Date().toISOString(),
    totalRules: generatedRules.length,
    counts,
    rules: generatedRules,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(`✅ Rule catalog generated successfully with ${catalog.totalRules} rules -> ${path.relative(ROOT, OUTPUT_FILE)}`);
}

if (require.main === module) {
  const isWrite = process.argv.includes('--write');
  if (!isWrite && !process.argv.includes('--check-only')) {
    console.log('ℹ️  Default mode is read-only parity check. Pass --write to regenerate rule-catalog.json.');
  }
  generate(!isWrite);
}

module.exports = {
  generate,
  OUTPUT_FILE,
  collectPlatformGovernanceRules,
  collectGlobalToolingRules,
};
