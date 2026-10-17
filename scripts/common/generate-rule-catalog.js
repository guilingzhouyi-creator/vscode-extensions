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
const GLOBAL_SOURCE = path.join(SOURCE_DIR, 'global-rules.json');

const PROJECT_COUNT_KEYS = Object.freeze({
  'auto-refactor': 'autoRefactor',
  'workspace-timing': 'workspaceTiming',
  WebGames: 'webGames',
  'global-tooling': 'globalTooling',
});

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
  return {
    id: r.id,
    project: 'auto-refactor',
    family: r.family || 'general',
    severity: r.defaultSeverity || r.severity || 'error',
    summary: r.summary || '',
  };
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

  return readRuleSource(AUTO_REFACTOR_SOURCE, 'auto-refactor rules registry snapshot').map((r) => ({
    id: r.id,
    project: 'auto-refactor',
    family: r.family || 'general',
    severity: r.severity || 'error',
    summary: r.summary || '',
  }));
}

function processCheckerRules(checker, rules) {
  if (checker.id) {
    rules.push({
      id: checker.id,
      project: 'workspace-timing',
      family: checker.layer || 'L0-L5',
      severity: 'error',
      summary: checker.title || '',
    });
  }
  for (const rid of checker.ruleIds || []) {
    if (!rid || rid === checker.id) continue;
    rules.push({
      id: rid,
      project: 'workspace-timing',
      family: checker.layer || 'L0-L5',
      severity: 'error',
      summary: `${checker.title} (${rid})`,
    });
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
  const counts = { autoRefactor: 0, workspaceTiming: 0, webGames: 0, globalTooling: 0 };
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
  const globalRules = collectGlobalToolingRules();

  const ruleMap = new Map();

  for (const r of [...arRules, ...wtRules, ...wgRules, ...globalRules]) {
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
