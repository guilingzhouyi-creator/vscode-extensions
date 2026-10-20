/**
 * Module: Gate Step Registry — Single Source of Step Identity and Display Order
 * File Path: scripts/common/gate-step-registry.js
 * Architecture Role: Loader and CLI projection for gate-step-registry.json, the sole authority
 *   over gate step identity, display ordinal, and rule attribution across every entry point.
 * Dependencies & Triggers: Consumes gate-step-registry.json and rule-catalog.json; imported by
 *   validate-gate-step-registry.js, and invoked as a CLI by the Bash gate implementations, which
 *   have no JSON parser available.
 * Responsibilities:
 *   1. Load and structurally validate the registry (unique ids, contiguous ordinals, known rules);
 *   2. Project one entry as ordered step records with a derived display ordinal;
 *   3. Emit a tab-separated projection so Bash can resolve a step without a JSON dependency;
 *   4. Report registry defects instead of throwing, so callers decide the failure mode.
 * Exit Semantics & Design Rationale: A pure data layer plus a thin CLI; exit 0 on a clean
 *   projection, 1 on an unknown entry or a registry defect. Ordinals are derived from array
 *   position rather than stored, because a stored ordinal drifts the moment a step is inserted.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REGISTRY_FILE = path.join(__dirname, 'gate-step-registry.json');
const CATALOG_FILE = path.join(__dirname, 'rule-catalog.json');
const ENTRY_ORDER = Object.freeze(['pre-commit', 'commit-msg', 'pre-push', 'audit-all', 'audit-taxis']);
const STATUS_VOCABULARY = Object.freeze(['PASS', 'BLOCK', 'SKIP', 'WARN']);
const STEP_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2}$/;
const TSV_SEPARATOR = '\t';

let cachedRegistry = null;

/**
 * Reads and caches the registry document.
 *
 * @returns {object} Parsed registry document.
 * @throws {Error} When the registry file is missing or not valid JSON.
 */
function loadRegistry() {
  if (cachedRegistry) return cachedRegistry;
  if (!fs.existsSync(REGISTRY_FILE)) {
    throw new Error(`Gate step registry missing: ${path.relative(process.cwd(), REGISTRY_FILE)}`);
  }
  cachedRegistry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  return cachedRegistry;
}

/**
 * Lists the entry point ids declared by the registry, in declaration order.
 *
 * @returns {string[]} Entry ids.
 */
function listEntryIds() {
  return Object.keys(loadRegistry().entries || {});
}

/**
 * Projects one entry into ordered step records with derived ordinals.
 *
 * The ordinal is the 1-based array position, so inserting a step renumbers the remainder
 * instead of leaving a stale stored value behind.
 *
 * @param {string} entryId - Entry point id such as `pre-push`.
 * @returns {{ id: string, title: string, scripts: object, steps: Array<object> }} Entry projection.
 * @throws {Error} When the entry id is unknown.
 */
function getEntry(entryId) {
  const entries = loadRegistry().entries || {};
  const entry = entries[entryId];
  if (!entry) {
    throw new Error(`Unknown gate entry '${entryId}'. Known entries: ${listEntryIds().join(', ')}`);
  }
  const steps = (entry.steps || []).map((step, offset) => ({
    id: step.id,
    ordinal: offset + 1,
    title: step.title,
    ruleId: step.ruleId,
  }));
  return { id: entryId, title: entry.title, scripts: entry.scripts || {}, steps };
}

/**
 * Resolves one step record within an entry.
 *
 * @param {string} entryId - Entry point id.
 * @param {string} stepId - Step identifier such as `ENGINE-TESTS-12`.
 * @returns {object|undefined} The step record, or undefined when absent.
 */
function getStep(entryId, stepId) {
  return getEntry(entryId).steps.find((step) => step.id === stepId);
}

/**
 * Reports whether every rule id referenced by a step is registered in the SSOT catalog.
 *
 * @param {Set<string>} registeredIds - Registered rule identifiers.
 * @returns {Array<{ entry: string, step: string, ruleId: string }>} Unregistered attributions.
 */
function collectRuleDefects(registeredIds) {
  const defects = [];
  for (const entryId of listEntryIds()) {
    for (const step of getEntry(entryId).steps) {
      if (!registeredIds.has(step.ruleId)) {
        defects.push({ entry: entryId, step: step.id, ruleId: step.ruleId });
      }
    }
  }
  return defects;
}

/**
 * Audits registry integrity without throwing (GUARD-STEP-001).
 *
 * Covers the invariants a human cannot eyeball: unique step ids across all entries, ordinals
 * that match the identifier suffix, canonical identifier shape, and rule attributions that
 * resolve against the SSOT catalog.
 *
 * @returns {{ valid: boolean, errors: string[] }} Audit result.
 */
function auditRegistry() {
  const errors = [];
  const seen = new Set();
  let catalogIds;
  try {
    catalogIds = new Set(JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')).rules.map((rule) => rule.id));
  } catch (err) {
    return { valid: false, errors: [`Rule catalog unreadable: ${err.message}`] };
  }

  for (const entryId of listEntryIds()) {
    const entry = getEntry(entryId);
    if (entry.steps.length === 0) errors.push(`${entryId}: entry declares no steps`);
    for (const step of entry.steps) {
      if (seen.has(step.id)) errors.push(`${entryId}/${step.id}: step id duplicated across entries`);
      seen.add(step.id);
      if (!STEP_ID_PATTERN.test(step.id)) {
        errors.push(`${entryId}/${step.id}: id must end with a two-digit ordinal`);
        continue;
      }
      const declared = Number(step.id.slice(-2));
      if (declared !== step.ordinal) {
        errors.push(`${entryId}/${step.id}: id suffix ${declared} disagrees with position ${step.ordinal}`);
      }
      if (!step.title || !step.title.trim()) errors.push(`${entryId}/${step.id}: title is empty`);
      if (!catalogIds.has(step.ruleId)) {
        errors.push(`${entryId}/${step.id}: rule '${step.ruleId}' is not registered in rule-catalog.json`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Renders one entry as tab-separated rows for shell consumers.
 *
 * @param {string} entryId - Entry point id.
 * @returns {string} One line per step: `ordinal<TAB>id<TAB>ruleId<TAB>title`.
 */
function toTsv(entryId) {
  return getEntry(entryId)
    .steps.map((step) => [step.ordinal, step.id, step.ruleId, step.title].join(TSV_SEPARATOR))
    .join('\n');
}

/**
 * Returns the total step count for an entry, for progress denominators.
 *
 * @param {string} entryId - Entry point id.
 * @returns {number} Step count.
 */
function stepCount(entryId) {
  return getEntry(entryId).steps.length;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const argv = process.argv.slice(2);
  const entryIndex = argv.indexOf('--entry');
  const entryId = entryIndex >= 0 ? argv[entryIndex + 1] : '';

  if (argv.includes('--audit')) {
    const result = auditRegistry();
    if (result.valid) {
      console.log(`PASS 步骤登记表一致: ${listEntryIds().length} entries, ${[...new Set(listEntryIds().map((id) => getEntry(id).steps.length))].reduce((a, b) => a + b, 0)} steps.`);
      process.exit(0);
    }
    console.error('BLOCK 步骤登记表存在未登记或未使用的标识:');
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  if (argv.includes('--entries')) {
    console.log(listEntryIds().join('\n'));
    process.exit(0);
  }

  if (!entryId) {
    console.error('Usage: gate-step-registry.js --entry <entryId> [--tsv|--ids|--count] | --audit | --entries');
    process.exit(1);
  }

  let entry;
  try {
    entry = getEntry(entryId);
  } catch (err) {
    console.error(`BLOCK ${err.message}`);
    process.exit(1);
  }

  if (argv.includes('--count')) {
    console.log(String(entry.steps.length));
    process.exit(0);
  }
  if (argv.includes('--ids')) {
    console.log(entry.steps.map((step) => step.id).join('\n'));
    process.exit(0);
  }
  console.log(toTsv(entryId));
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({
  REGISTRY_FILE,
  ENTRY_ORDER,
  STATUS_VOCABULARY,
  listEntryIds,
  getEntry,
  getStep,
  auditRegistry,
  collectRuleDefects,
  toTsv,
  stepCount,
});
