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
const STEP_ID_PATTERN = /^(?:PC|PP)-\d{2}-\d{2}$/;
const EXTERNAL_PREFIXES = Object.freeze(['UTF-', 'SHA-', 'RFC-', 'CVE-', 'ISO-']);

const FIXTURE_ALLOWLIST = new Map([
  ['FAKE-XYZ-999', 'Negative fixture for commit-msg anti-hallucination self-test'],
  ['TC-DOM-001', 'Documented test-case identifier example in validate-skills'],
  ['ADV-CMP-001', 'Documented rule-ID example inside a code comment'],
  ['LINK-ABS-FILE-URI', 'Diagnostic tag emitted by validate-skills for absolute-path links'],
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
 * Loads registered rule identifiers from the SSOT catalog.
 *
 * @returns {Set<string>} Registered rule IDs.
 */
function loadRegisteredIds() {
  if (!fs.existsSync(CATALOG_FILE)) {
    throw new Error(`Rule catalog not found: ${path.relative(REPO_ROOT, CATALOG_FILE)}`);
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  if (!Array.isArray(catalog.rules) || catalog.rules.length === 0) {
    throw new Error('Rule catalog contains no rules');
  }
  return new Set(catalog.rules.map((rule) => rule.id));
}

/**
 * Runs the closure audit and returns unregistered references.
 *
 * @returns {{totalReferenced: number, unregistered: Array<object>}} Audit result.
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
    if (registered.has(id) || FIXTURE_ALLOWLIST.has(id)) continue;
    unregistered.push({ id, files: [...files] });
  }

  return { totalReferenced: references.size, unregistered };
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  let result;
  try {
    result = runClosureAudit();
  } catch (err) {
    console.error(`[FAIL] Rule ID closure audit could not run: ${err.message}`);
    process.exit(1);
  }

  const passed = result.unregistered.length === 0;
  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'rule-id-closure',
          totalReferenced: result.totalReferenced,
          unregistered: result.unregistered,
          summary: passed
            ? 'All referenced rule identifiers are registered in the SSOT catalog.'
            : `${result.unregistered.length} referenced rule identifiers are not registered.`,
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

  console.error(
    `[FAIL] Rule ID closure: ${result.unregistered.length} unregistered identifier(s) referenced by gate assets.`,
  );
  for (const item of result.unregistered) {
    console.error(`  - ${item.id} <= ${item.files.join(', ')}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({
  runClosureAudit,
  loadRegisteredIds,
  RULE_ID_PATTERN,
});
