/**
 * Module: Commit Rule Coverage Closure Validator
 * File Path: scripts/common/validate-commit-rule-coverage.js
 * Architecture Role: Enforces that every commit-message gate step registered for the `commit-msg`
 *   gate is either mapped to a Rust kernel rule or explicitly declared not-applicable with a
 *   reason. This is the guard that stops the Rust (Taxis) implementation from silently drifting
 *   behind the JavaScript reference implementation: a rule that exists on one side and is absent
 *   from the coverage manifest fails the build instead of being discovered months later.
 * Dependencies & Triggers: Reads commit-rule-coverage.json, gate-step-registry.json and
 *   rule-catalog.json. Invoked by pre-commit-gate (ps1/sh) and by local CI.
 * Responsibilities:
 *   1. Assert every registered `commit-msg` step appears exactly once in the manifest;
 *   2. Assert every manifest entry points at a registered rule ID or a documented exemption;
 *   3. Assert `pending` entries carry an owner batch so an indefinite zombie is impossible;
 *   4. Reject manifest entries that name a step the registry does not define.
 * Exit Semantics & Design Rationale: Exits 0 only when the closure holds in both directions.
 *   A one-directional check (manifest -> registry) would let a newly registered gate step go
 *   unmapped, which is exactly the failure this file exists to prevent, so the reverse direction
 *   is checked with the same weight.
 *
 * @module validate-commit-rule-coverage
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FILE_COVERAGE = 'commit-rule-coverage.json';
const FILE_STEP_REGISTRY = 'gate-step-registry.json';
const FILE_RULE_CATALOG = 'rule-catalog.json';
const GATE_ID = 'commit-msg';
const VALID_STATUS = new Set(['implemented', 'pending', 'not-applicable']);
const RULE_ID_SHAPE = /^[A-Z]{2,4}-[A-Z]{2,4}-\d{3}$/;

/**
 * Reads and parses a JSON file, returning a finding instead of throwing.
 *
 * @param {string} filePath - Absolute path to parse.
 * @returns {{data: object|null, error: string|null}} Parsed payload or a diagnostic.
 */
function readJson(filePath) {
  try {
    return { data: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (parseError) {
    return { data: null, error: parseError.message };
  }
}

/**
 * Collects the step identifiers registered for the commit-msg gate.
 *
 * @param {object} registry - Parsed gate-step-registry.json.
 * @returns {string[]} Registered step identifiers.
 */
function registeredSteps(registry) {
  const gate = registry && registry.entries ? registry.entries[GATE_ID] : null;
  if (!gate || !Array.isArray(gate.steps)) return [];
  return gate.steps.map((step) => step.id);
}

/**
 * Collects every registered rule identifier.
 *
 * @param {object} catalog - Parsed rule-catalog.json.
 * @returns {Set<string>} Registered rule identifiers.
 */
function registeredRuleIds(catalog) {
  const rules = catalog && Array.isArray(catalog.rules) ? catalog.rules : [];
  return new Set(rules.map((rule) => rule.id).filter(Boolean));
}

/**
 * Validates one manifest entry in isolation.
 *
 * @param {object} entry - Manifest entry.
 * @param {Set<string>} knownRules - Registered rule identifiers.
 * @param {number} index - Position in the manifest, for diagnostics.
 * @returns {string[]} Findings for this entry.
 */
function validateEntry(entry, knownRules, index) {
  const findings = [];
  const label = `entries[${index}] (${entry.jsStep || 'unnamed'})`;

  if (!entry.jsStep) {
    findings.push(`${label}: missing jsStep`);
    return findings;
  }
  if (!VALID_STATUS.has(entry.status)) {
    findings.push(`${label}: status '${entry.status}' is outside ${[...VALID_STATUS].join('/')}`);
    return findings;
  }

  if (entry.status === 'not-applicable') {
    const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
    if (reason.length < 40) {
      findings.push(
        `${label}: not-applicable requires a reason of at least 40 characters explaining why the kernel does not replicate the rule`,
      );
    }
    if (entry.rustRule) {
      findings.push(`${label}: not-applicable must not name a rustRule`);
    }
    return findings;
  }

  if (!entry.rustRule) {
    findings.push(`${label}: status '${entry.status}' requires a rustRule`);
    return findings;
  }
  if (!RULE_ID_SHAPE.test(entry.rustRule)) {
    findings.push(`${label}: rustRule '${entry.rustRule}' does not match the 3-3-3 rule shape`);
  }
  if (!knownRules.has(entry.rustRule)) {
    findings.push(
      `${label}: rustRule '${entry.rustRule}' is not registered in rule-catalog.json (RCFG-RULE-DRIFT)`,
    );
  }
  if (entry.status === 'pending') {
    const owner = typeof entry.ownerBatch === 'string' ? entry.ownerBatch.trim() : '';
    if (!owner) {
      findings.push(
        `${label}: status 'pending' requires an ownerBatch so the item cannot hang indefinitely`,
      );
    }
  }
  return findings;
}

/**
 * Runs the full bidirectional closure validation.
 *
 * @returns {string[]} Every finding collected.
 */
function validateCoverage() {
  const baseDir = __dirname;
  const coverage = readJson(path.join(baseDir, FILE_COVERAGE));
  const registry = readJson(path.join(baseDir, FILE_STEP_REGISTRY));
  const catalog = readJson(path.join(baseDir, FILE_RULE_CATALOG));

  const loadErrors = [coverage, registry, catalog]
    .map((result) => result.error)
    .filter(Boolean);
  if (loadErrors.length > 0) {
    return loadErrors.map((message) => `unreadable baseline: ${message}`);
  }

  const findings = [];
  const entries = Array.isArray(coverage.data.entries) ? coverage.data.entries : [];
  const knownRules = registeredRuleIds(catalog.data);
  const registered = registeredSteps(registry.data);

  if (registered.length === 0) {
    findings.push(`gate-step-registry.json declares no steps for gate '${GATE_ID}'`);
  }

  const seenSteps = new Set();
  entries.forEach((entry, index) => {
    const entryFindings = validateEntry(entry, knownRules, index);
    findings.push(...entryFindings);
    if (entry.jsStep) {
      if (seenSteps.has(entry.jsStep)) {
        findings.push(`duplicate manifest entry for step '${entry.jsStep}'`);
      }
      seenSteps.add(entry.jsStep);
    }
  });

  // Direction 1: every registered step must be mapped.
  for (const stepId of registered) {
    if (!seenSteps.has(stepId)) {
      findings.push(
        `registered step '${stepId}' has no coverage entry; a gate rule is unreachable from the kernel manifest`,
      );
    }
  }

  // Direction 2: no manifest entry may name a step the registry does not define.
  const registeredSet = new Set(registered);
  for (const stepId of seenSteps) {
    if (!registeredSet.has(stepId)) {
      findings.push(
        `manifest step '${stepId}' is not registered in gate-step-registry.json; zombie coverage entry`,
      );
    }
  }

  return findings;
}

/**
 * Prints findings and terminates with the matching exit status.
 */
function main() {
  const findings = validateCoverage();
  if (findings.length === 0) {
    console.log('PASS: commit rule coverage closure holds in both directions.');
    process.exit(0);
  }
  console.error(`BLOCK: ${findings.length} coverage closure finding(s):`);
  for (const finding of findings) {
    console.error(`  - ${finding}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { validateCoverage, registeredSteps, registeredRuleIds };
