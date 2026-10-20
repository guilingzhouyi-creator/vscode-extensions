/**
 * Module: Gate Feedback Vocabulary Guard — Ordinal Labels and Status Closure
 * File Path: scripts/common/validate-gate-feedback.js
 * Architecture Role: Static guard over every gate entry point and its validators, asserting that
 *   operator-facing feedback carries semantic step identity and a closed four-state vocabulary
 *   instead of positional labels.
 * Dependencies & Triggers: Consumes gate-step-registry.json, rule-catalog.json, and the gate
 *   script corpus; invoked by pre-push, audit-all, and CI.
 * Responsibilities:
 *   1. Reject positional step labels (`Gate 3`, `Rule 5.1`) in gate feedback;
 *   2. Reject status synonyms outside PASS/BLOCK/SKIP/WARN;
 *   3. Reject step identifiers that are not declared in the single-source registry;
 *   4. Report file-and-line diagnostics for every finding.
 * Exit Semantics & Design Rationale: 0 = closed vocabulary and registry-backed identities,
 *   1 = at least one violation. Positional labels carry no registered meaning, so a renumbered
 *   pipeline silently re-attributes failures; enforcing semantic ids makes reordering inert.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const REGISTRY = require('./gate-step-registry');

const SCAN_TARGETS = Object.freeze([
  'scripts/ps1',
  'scripts/sh',
  'scripts/common',
  'fractal-git/scripts',
  'WebGames/scripts/ps1',
  'WebGames/scripts/sh',
]);

const SCAN_EXTENSIONS = new Set(['.js', '.ps1', '.sh', '.py']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'out', '__pycache__', 'archive', 'fixtures']);

/** Positional labels that must never reach operator-facing feedback. */
const ORDINAL_LABEL_PATTERNS = Object.freeze([
  { id: 'ORDINAL-GATE', pattern: /\bGate\s+\d+(?:\.\d+)?\b/ },
  { id: 'ORDINAL-RULE', pattern: /\bRule\s+\d+(?:\.\d+)?\b/ },
  { id: 'ORDINAL-STAGE', pattern: /\bStage\s+\d+\s*:/ },
]);

/** Status synonyms that collapse into the four-state vocabulary. */
const STATUS_SYNONYMS = Object.freeze([
  { id: 'STATUS-OK', pattern: /\[OK\]/ },
  { id: 'STATUS-PASS-WITH-WARNING', pattern: /(?<![A-Z_])PASS_WITH_WARNING(?![A-Z_])/ },
]);

/** Lines that legitimately mention a pattern (documentation of the ban itself). */
const ALLOW_MARKERS = Object.freeze(['validate-gate-feedback.js', 'gate-step-registry.json']);

/**
 * Recursively collects scannable gate files.
 *
 * @param {string} dir - Absolute directory.
 * @param {string[]} acc - Accumulator.
 * @returns {string[]} Absolute file paths.
 */
function collectFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, acc);
      continue;
    }
    if (SCAN_EXTENSIONS.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

/**
 * Audits one file for banned feedback vocabulary.
 *
 * @param {string} file - Absolute file path.
 * @returns {Array<object>} Findings.
 */
function auditFile(file) {
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  if (ALLOW_MARKERS.some((marker) => rel.endsWith(marker))) return [];
  const findings = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { id, pattern } of [...ORDINAL_LABEL_PATTERNS, ...STATUS_SYNONYMS]) {
      if (pattern.test(line)) {
        findings.push({ type: id, file: rel, line: index + 1, detail: line.trim().slice(0, 120) });
      }
    }
  });
  return findings;
}

/**
 * Collects step identifiers referenced by a gate file.
 *
 * @param {string} file - Absolute file path.
 * @returns {Set<string>} Step identifiers, matched by registry shape.
 */
function collectStepReferences(file) {
  const text = fs.readFileSync(file, 'utf8');
  const found = new Set();
  const pattern = /"([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2})"/g;
  let match = pattern.exec(text);
  while (match !== null) {
    found.add(match[1]);
    match = pattern.exec(text);
  }
  return found;
}

/**
 * Audits the registry and the step references in gate scripts (GUARD-STEP-001).
 *
 * @param {Array<object>} findings - Collector array.
 * @returns {void}
 */
function auditRegistryBinding(findings) {
  const registryAudit = REGISTRY.auditRegistry();
  for (const error of registryAudit.errors) {
    findings.push({ type: 'GUARD-STEP-001', file: 'scripts/common/gate-step-registry.json', line: 0, detail: error });
  }
  const declared = new Set();
  for (const entryId of REGISTRY.listEntryIds()) {
    for (const step of REGISTRY.getEntry(entryId).steps) declared.add(step.id);
  }
  for (const target of SCAN_TARGETS) {
    for (const file of collectFiles(path.join(REPO_ROOT, target))) {
      for (const stepId of collectStepReferences(file)) {
        if (declared.has(stepId)) continue;
        findings.push({
          type: 'GUARD-STEP-001',
          file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
          line: 0,
          detail: stepId,
        });
      }
    }
  }
}

/**
 * Runs the feedback vocabulary audit.
 *
 * @returns {Array<object>} Findings.
 */
function runAudit() {
  const findings = [];
  for (const target of SCAN_TARGETS) {
    for (const file of collectFiles(path.join(REPO_ROOT, target))) {
      findings.push(...auditFile(file));
    }
  }
  auditRegistryBinding(findings);
  return findings;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  const findings = runAudit();
  const passed = findings.length === 0;

  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'gate-feedback-vocabulary',
          findings,
          summary: passed
            ? 'Gate feedback uses semantic step ids and a closed four-state vocabulary.'
            : `${findings.length} positional or non-closed feedback token(s) detected.`,
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }

  if (passed) {
    console.log('  ✔ PASS  gate-feedback-vocabulary  反馈词表为语义步骤标识与四态状态词闭包');
    process.exit(0);
  }

  console.error('✖ BLOCK  gate-feedback-vocabulary');
  for (const item of findings) {
    const location = item.line > 0 ? `${item.file}:${item.line}` : item.file;
    console.error(`  - [${item.type}] ${location} ${item.detail}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({ runAudit, ORDINAL_LABEL_PATTERNS, STATUS_SYNONYMS });
