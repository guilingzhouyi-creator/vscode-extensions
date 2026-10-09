/**
 * Module: Workspace Rule Catalog Generator & SSOT Consolidator
 * File Path: scripts/common/generate-rule-catalog.js
 * Architecture Role: Single source of truth consolidator for all active static analysis and review rules
 *   across auto-refactor, workspace-timing, and WebGames.
 * Dependencies & Triggers: Invoked by build scripts, CI, and local gate verification.
 * Exit Semantics: Exits 0 on success, 1 on error.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUTPUT_FILE = path.join(__dirname, 'rule-catalog.json');
const MATCH_EXTENSIONS = new Set(['.gd', '.sh', '.json', '.md']);

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
  if (!fs.existsSync(registryPath)) {
    return [];
  }

  try {
    const { RULE_REGISTRY } = require(registryPath);
    const list = Array.isArray(RULE_REGISTRY) ? RULE_REGISTRY : Object.values(RULE_REGISTRY);
    return list.map(mapRuleEntry).filter(Boolean);
  } catch (err) {
    console.warn('Warning: Could not load auto-refactor compiled registry:', err.message);
    return [];
  }
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

function scanFileForRules(fullPath, rulePattern, found) {
  const text = fs.readFileSync(fullPath, 'utf8');
  let m;
  while ((m = rulePattern.exec(text)) !== null) {
    const id = m[1];
    if (!found.has(id)) {
      found.set(id, path.relative(ROOT, fullPath).replace(/\\/g, '/'));
    }
  }
}

function collectCandidateFiles(dir, accumulator = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectCandidateFiles(full, accumulator);
    } else if (MATCH_EXTENSIONS.has(path.extname(entry.name))) {
      accumulator.push(full);
    }
  }
  return accumulator;
}

function collectWebGamesRules() {
  const webgamesDir = path.join(ROOT, 'WebGames');
  if (!fs.existsSync(webgamesDir)) {
    return [];
  }

  const rulePattern = /\b([A-Z]{2,4}-[A-Z0-9]+-[0-9]{3})\b/g;
  const found = new Map();
  const candidateFiles = collectCandidateFiles(webgamesDir);

  for (const file of candidateFiles) {
    scanFileForRules(file, rulePattern, found);
  }

  const rules = [];
  for (const [id, source] of found.entries()) {
    rules.push({
      id,
      project: 'WebGames',
      family: id.split('-')[0],
      severity: 'error',
      summary: `WebGames domain gate rule (source: ${source})`,
    });
  }
  return rules;
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

function generate() {
  console.log('🔄 Consolidating workspace rule catalog...');
  const arRules = collectAutoRefactorRules();
  const wtRules = collectWorkspaceTimingRules();
  const wgRules = collectWebGamesRules();
  const cmgRules = collectCommitMsgRules();

  const ruleMap = new Map();

  for (const r of [...arRules, ...wtRules, ...wgRules, ...cmgRules]) {
    if (!ruleMap.has(r.id)) {
      ruleMap.set(r.id, r);
    }
  }

  const catalog = {
    schema: 'workspace-rule-catalog/v1',
    generatedAt: new Date().toISOString(),
    totalRules: ruleMap.size,
    counts: {
      autoRefactor: arRules.length,
      workspaceTiming: wtRules.length,
      webGames: wgRules.length,
      globalTooling: cmgRules.length,
    },
    rules: Array.from(ruleMap.values()).sort((a, b) => a.id.localeCompare(b.id)),
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(`✅ Rule catalog generated successfully with ${catalog.totalRules} rules -> ${path.relative(ROOT, OUTPUT_FILE)}`);
}

if (require.main === module) {
  generate();
}

module.exports = { generate, OUTPUT_FILE };
