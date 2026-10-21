/**
 * Module: Rule ID Closure Guard — Gate Script Reference Integrity
 * File Path: scripts/common/validate-rule-id-closure.js
 * Architecture Role: Platform-level governance guard asserting that every rule identifier
 *   referenced by gate scripts, hooks, and CI workflows is registered in the SSOT catalog.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path) and
 *   scripts/common/rule-catalog.json; invoked by pre-push gate and CI.
 * Responsibilities:
 *   1. Scan gate entry points for rule-ID shaped tokens;
 *   2. Reject external identifier prefixes (UTF/SHA/RFC/CVE/ISO) that are not rule IDs;
 *   3. Report unregistered identifiers with their referencing files;
 *   4. Emit human or Agent-Native JSON output with fail-closed exit semantics.
 * Exit Semantics & Design Rationale: 0 = every referenced rule ID is registered,
 *   1 = unregistered reference detected or catalog unreadable. Fail-closed because an
 *   unregistered identifier either breaks commit anti-hallucination checks or hides drift.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CATALOG_FILE = path.join(__dirname, 'rule-catalog.json');

const SCAN_TARGETS = Object.freeze([
  'scripts/common',
  'scripts/ps1',
  'scripts/sh',
  '.githooks',
  '.github/workflows',
]);

const SCAN_EXTENSIONS = new Set(['.js', '.ps1', '.sh', '.yml', '.yaml']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'out', 'archive']);

const RULE_ID_PATTERN =
  /(?<![A-Z0-9-])([A-Z]{2,4}(?:-[A-Z0-9]+){2,}|L[0-5](?:-[A-Z0-9]+)+)(?![A-Z0-9-])/g;
const LAYER_RANGE_PATTERN = /^L\d-L\d$/;
// Semantic step identifiers always end with a two-digit position suffix, while
// rule identifiers use a three-digit numeric tail, so the two spaces never overlap.
const STEP_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2}$/;
const EXTERNAL_PREFIXES = Object.freeze(['UTF-', 'SHA-', 'RFC-', 'CVE-', 'ISO-']);

const FIXTURE_ALLOWLIST = new Map([
  ['FAKE-XYZ-999', 'Negative fixture for commit-msg anti-hallucination self-test'],
  ['TC-DOM-001', 'Documented test-case identifier example in validate-skills'],
  ['ADV-CMP-001', 'Documented rule-ID example inside a code comment'],
  ['LINK-ABS-FILE-URI', 'Diagnostic tag emitted by validate-skills for absolute-path links'],
  ['HIGH-DEBT-UNKNOWN', 'Sentinel tag for unrecognized high technical debt in tech-debt-corridor'],
  ['DEBT-CORRIDOR-BLOCK', 'Gate blocker tag emitted by validate-commit-msg for debt ratchet breach'],
]);

/**
 * Recursively collects scannable files beneath a directory.
 *
 * @param {string} dir - Absolute directory path.
 * @param {string[]} accumulator - Collector array.
 * @returns {string[]} Absolute file paths.
 */
function collectFiles(dir, accumulator = []) {
  if (!fs.existsSync(dir)) return accumulator;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, accumulator);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      accumulator.push(full);
    }
  }
  return accumulator;
}

/**
 * Extracts rule-ID shaped tokens from a text file.
 *
 * @param {string} file - Absolute file path.
 * @param {Map<string, Set<string>>} references - Identifier to referencing files map.
 * @returns {void}
 */
function collectReferences(file, references) {
  const text = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = RULE_ID_PATTERN.exec(text)) !== null) {
    const id = match[1];
    if (EXTERNAL_PREFIXES.some((prefix) => id.startsWith(prefix))) continue;
    if (LAYER_RANGE_PATTERN.test(id)) continue;
    if (STEP_ID_PATTERN.test(id)) continue;
    if (!references.has(id)) references.set(id, new Set());
    references.get(id).add(path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
  }
}

/**
 * Lists the non-canonical entries that fail to state why they are non-canonical.
 *
 * Pure over the rule list so the self-probe can drive it with a synthetic catalog; a guard that can
 * only be exercised against the real catalog cannot distinguish "corpus is clean" from "detector
 * never fires", which is exactly the failure this repository has paid for before.
 *
 * @param {Array<object>} rules - Catalog rule entries.
 * @returns {string[]} Ids missing a usable `legacyReason`.
 */
function findMissingLegacyReasons(rules) {
  return rules
    .filter((rule) => rule.canonical === false)
    .filter((rule) => typeof rule.legacyReason !== 'string' || rule.legacyReason.trim() === '')
    .map((rule) => rule.id);
}

/**
 * Proves the legacy-reason detector still discriminates before trusting a green run.
 *
 * @returns {string[]} Probe failures; empty when the detector behaves as specified.
 */
function runSelfProbes() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`probe "${label}": expected ${wanted}, got ${actual}`);
  };
  expect(
    'canonical-entry-without-reason-is-fine',
    findMissingLegacyReasons([{ id: 'GUARD-ORD-001', canonical: true }]).length,
    0,
  );
  expect(
    'non-canonical-without-reason-blocks',
    findMissingLegacyReasons([{ id: 'high-complexity', canonical: false }]).join(','),
    'high-complexity',
  );
  expect(
    'non-canonical-blank-reason-blocks',
    findMissingLegacyReasons([{ id: 'high-complexity', canonical: false, legacyReason: '   ' }]).length,
    1,
  );
  expect(
    'non-canonical-with-reason-passes',
    findMissingLegacyReasons([
      { id: 'high-complexity', canonical: false, legacyReason: 'id-not-canonical' },
    ]).length,
    0,
  );
  return failures;
}

/**
 * Loads registered rule identifiers from the SSOT catalog.
 *
 * Also asserts that every non-canonical entry states why it is non-canonical. The catalog records
 * this because 17 historical and wildcard ids are real identities that cannot satisfy the canonical
 * pattern; without the reason a reader cannot tell a deliberate historical name from a typo, and
 * the next person to "fix" the id would break every suppression comment that names it.
 *
 * @returns {{ids: Set<string>, missingReason: string[]}} Registered ids and entries lacking a reason.
 */
function loadRegisteredIds() {
  if (!fs.existsSync(CATALOG_FILE)) {
    throw new Error(`Rule catalog not found: ${path.relative(REPO_ROOT, CATALOG_FILE)}`);
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  if (!Array.isArray(catalog.rules) || catalog.rules.length === 0) {
    throw new Error('Rule catalog contains no rules');
  }
  return {
    ids: new Set(catalog.rules.map((rule) => rule.id)),
    missingReason: findMissingLegacyReasons(catalog.rules),
  };
}

/**
 * Runs the closure audit and returns unregistered references and missing legacy reasons.
 *
 * @returns {{totalReferenced: number, unregistered: Array<object>, missingReason: string[]}} Audit result.
 */
function runClosureAudit() {
  const references = new Map();
  for (const target of SCAN_TARGETS) {
    for (const file of collectFiles(path.join(REPO_ROOT, target))) {
      collectReferences(file, references);
    }
  }

  const registered = loadRegisteredIds();
  const unregistered = [];
  for (const [id, files] of references.entries()) {
    if (registered.ids.has(id) || FIXTURE_ALLOWLIST.has(id)) continue;
    unregistered.push({ id, files: [...files] });
  }

  return { totalReferenced: references.size, unregistered, missingReason: registered.missingReason };
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  const probeFailures = runSelfProbes();
  if (probeFailures.length > 0) {
    console.error('✖ BLOCK Rule ID closure: built-in probes no longer discriminate.');
    for (const failure of probeFailures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  let result;
  try {
    result = runClosureAudit();
  } catch (err) {
    console.error(`✖ BLOCK Rule ID closure audit could not run: ${err.message}`);
    process.exit(1);
  }

  const passed = result.unregistered.length === 0 && result.missingReason.length === 0;
  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'rule-id-closure',
          totalReferenced: result.totalReferenced,
          unregistered: result.unregistered,
          missingLegacyReason: result.missingReason,
          summary: passed
            ? 'All referenced rule identifiers are registered in the SSOT catalog.'
            : `${result.unregistered.length} referenced rule identifiers are not registered; ` +
              `${result.missingReason.length} non-canonical entries lack a legacy reason.`,
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }

  if (passed) {
    console.log(
      `  PASS Rule ID closure: ${result.totalReferenced} referenced identifiers, 0 unregistered.`,
    );
    process.exit(0);
  }

  if (result.unregistered.length > 0) {
    console.error(
      `✖ BLOCK Rule ID closure: ${result.unregistered.length} unregistered identifier(s) referenced by gate assets.`,
    );
    for (const item of result.unregistered) {
      console.error(`  - ${item.id} <= ${item.files.join(', ')}`);
    }
  }
  if (result.missingReason.length > 0) {
    console.error(
      `✖ BLOCK Rule ID closure: ${result.missingReason.length} non-canonical entr(ies) omit their legacy reason.`,
    );
    for (const id of result.missingReason) console.error(`  - ${id}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({
  runClosureAudit,
  loadRegisteredIds,
  findMissingLegacyReasons,
  runSelfProbes,
  RULE_ID_PATTERN,
});
