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

const LEXICON_FILE = path.join(__dirname, 'rule-lexicon.json');

const SCAN_TARGETS = Object.freeze([
  'scripts/common',
  'scripts/ps1',
  'scripts/sh',
  '.githooks',
  '.github/workflows',
  'auto-refactor/src',
  'fractal-git/scripts',
  'fractal-git/ts',
  'fractal-git/crates',
  'fractal-git/src',
  'WebGames/scripts',
  'workspace-timing/scripts',
  '.agents/subagents',
]);

const SCAN_EXTENSIONS = new Set(['.js', '.ps1', '.sh', '.yml', '.yaml', '.ts', '.rs', '.md']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'out', 'archive', 'target', '.godot', 'reports']);

/**
 * Loads the identifier vocabulary shared with the analysis engine.
 *
 * This guard and auto-refactor's `rule-catalog-ssot` both decide "is this token a rule id, a step
 * id, an external standard, or a date". They used to hold separate copies, and the copies drifted:
 * this guard accepted any `<PREFIX>…-<2-digit>` token as a semantic step identifier while the
 * engine accepted only `PC-nn-nn`/`PP-nn-nn`, so every gate step id read as a hallucinated rule id
 * to one surface and as benign to the other. The shapes now come from one file. Fail-closed here
 * (unlike the engine's degrade-to-clean) because this is a gate: an unreadable lexicon means the
 * guard cannot judge, which must not be reported as a pass.
 *
 * @returns {{ruleIdPattern: RegExp, layerRange: RegExp, calendarDate: RegExp, semanticStepId: RegExp, externalPrefixes: readonly string[]}}
 * @throws {Error} When the lexicon is missing or a shape is not a compilable pattern.
 */
function loadLexicon() {
  if (!fs.existsSync(LEXICON_FILE)) {
    throw new Error(`shared rule lexicon missing: ${path.relative(REPO_ROOT, LEXICON_FILE)}`);
  }
  const document = JSON.parse(fs.readFileSync(LEXICON_FILE, 'utf8'));
  // The anchored shapes are compiled WITHOUT the global flag: they are consumed by `.test()`,
  // and a global regex carries `lastIndex` between calls, so the verdict would depend on call
  // order. Only the candidate shape is scanned repeatedly, so only it is global.
  const compile = (source, label, flags) => {
    if (typeof source !== 'string' || source.length === 0) {
      throw new Error(`rule lexicon field '${label}' must be a non-empty pattern string`);
    }
    return new RegExp(source, flags);
  };
  if (!Array.isArray(document.externalStandardPrefixes) || document.externalStandardPrefixes.length === 0) {
    throw new Error("rule lexicon field 'externalStandardPrefixes' must be a non-empty array");
  }
  return {
    ruleIdPattern: compile(document.ruleIdCandidate, 'ruleIdCandidate', 'g'),
    layerRange: compile(document.layerRange, 'layerRange', ''),
    calendarDate: compile(document.calendarDate, 'calendarDate', ''),
    semanticStepId: compile(document.semanticStepId, 'semanticStepId', ''),
    externalPrefixes: Object.freeze([...document.externalStandardPrefixes]),
  };
}

const LEXICON = loadLexicon();
const RULE_ID_PATTERN = LEXICON.ruleIdPattern;
const LAYER_RANGE_PATTERN = LEXICON.layerRange;
const DATE_PATTERN = LEXICON.calendarDate;
const STEP_ID_PATTERN = LEXICON.semanticStepId;
const EXTERNAL_PREFIXES = LEXICON.externalPrefixes;

const FIXTURE_ALLOWLIST = new Map([
  ['FAKE-XYZ-999', 'Negative fixture for commit-msg anti-hallucination self-test'],
  ['TC-DOM-001', 'Documented test-case identifier example in validate-skills'],
  ['ADV-CMP-001', 'Documented rule-ID example inside a code comment'],
  ['LINK-ABS-FILE-URI', 'Diagnostic tag emitted by validate-skills for absolute-path links'],
  ['HIGH-DEBT-UNKNOWN', 'Sentinel tag for unrecognized high technical debt in tech-debt-corridor'],
  ['DEBT-CORRIDOR-BLOCK', 'Gate blocker tag emitted by validate-commit-msg for debt ratchet breach'],
  ['L3-CONFLICT', 'Negative fixture asserted to be rejected by gate-bridge'],
  ['L1-FAKE-CRASH', 'Negative probe fixture in validate-skills self-probe'],
]);

const ALIASES_RELATIVE_PATH = 'auto-refactor/src/core/rules/aliases.ts';

/**
 * Dynamically extracts target canonical IDs from the legacy rule aliases table.
 *
 * @param {string} aliasesPath - Absolute path to aliases.ts.
 * @returns {Set<string>} Canonical target rule IDs mapped in aliases.ts.
 */
function loadLegacyAliasTargets(aliasesPath) {
  if (!fs.existsSync(aliasesPath)) return new Set();
  const content = fs.readFileSync(aliasesPath, 'utf8');
  const blockMatch = content.match(
    /LEGACY_RULE_ALIASES:\s*Readonly<Record<string,\s*string>>\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/,
  );
  if (!blockMatch) return new Set();
  const re = /'([a-z0-9-]+)':\s*'([A-Z0-9-]+)'/g;
  const targets = new Set();
  let m;
  while ((m = re.exec(blockMatch[1])) !== null) {
    targets.add(m[2]);
  }
  return targets;
}

/**
 * Builds the map of non-rule tokens or transitional identifiers permitted only within
 * explicit source files (e.g. SPDX licenses in compliance scanners, transitional alias targets).
 *
 * @param {string} repoRoot - Absolute repository root.
 * @returns {Map<string, {files: Set<string>, rationale: string}>} Scoped allowlist.
 */
function buildScopedAllowlist(repoRoot) {
  const scoped = new Map([
    ['BSD-2-CLAUSE', { files: new Set(['auto-refactor/src/core/intelligence/license-compliance.ts']), rationale: 'SPDX license identifier' }],
    ['BSD-3-CLAUSE', { files: new Set(['auto-refactor/src/core/intelligence/license-compliance.ts']), rationale: 'SPDX license identifier' }],
    ['BSD-4-CLAUSE', { files: new Set(['auto-refactor/src/core/intelligence/license-compliance.ts']), rationale: 'SPDX license identifier' }],
    ['CC-BY-SA-3', { files: new Set(['auto-refactor/src/core/intelligence/license-compliance.ts']), rationale: 'SPDX license identifier' }],
    ['CC-BY-SA-4', { files: new Set(['auto-refactor/src/core/intelligence/license-compliance.ts']), rationale: 'SPDX license identifier' }],
    ['RULE-META-SELF-VIOLATION', { files: new Set(['auto-refactor/src/core/architecture/meta-architecture-rules.ts']), rationale: 'Diagnostic tag for engine self-check' }],
    ['ASY-FLW-001', { files: new Set(['auto-refactor/src/core/cfg/def-use-chain.ts']), rationale: 'Documented flow analysis finding ID in comment' }],
    ['SAF-NIL-001', { files: new Set(['auto-refactor/src/core/cfg/def-use-chain.ts']), rationale: 'Documented null safety finding ID in comment' }],
    ['ARCH-DSP-001', { files: new Set(['auto-refactor/src/core/rules/topic-catalog.ts']), rationale: 'Predecessor topic reference in historical anomaly registry' }],
    ['GOV-AGENT-COLLISION', { files: new Set(['auto-refactor/src/core/trajectory/agentCollisionDetector.ts']), rationale: 'Diagnostic tag for multi-agent collision' }],
  ]);

  const targets = loadLegacyAliasTargets(path.join(repoRoot, ALIASES_RELATIVE_PATH));
  for (const targetId of targets) {
    scoped.set(targetId, {
      files: new Set([ALIASES_RELATIVE_PATH]),
      rationale: 'Transitional canonical alias target in aliases.ts',
    });
  }
  return scoped;
}

const SCOPED_ALLOWLIST = buildScopedAllowlist(REPO_ROOT);

/**
 * Evaluates whether all occurrences of an identifier are valid (registered, fixture, or scoped).
 *
 * @param {string} id - Identifier candidate.
 * @param {Iterable<string>} files - Relative file paths referencing the identifier.
 * @param {Set<string>} registeredIds - Registered rule IDs.
 * @param {Map<string, string>} fixtureAllowlist - Global fixture allowlist.
 * @param {Map<string, {files: Set<string>, rationale: string}>} scopedAllowlist - Scoped allowlist.
 * @returns {{allowed: boolean, unauthorizedFiles: string[]}} Evaluation result.
 */
function auditReference(id, files, registeredIds, fixtureAllowlist, scopedAllowlist) {
  if (registeredIds.has(id) || fixtureAllowlist.has(id)) {
    return { allowed: true, unauthorizedFiles: [] };
  }
  const scoped = scopedAllowlist.get(id);
  if (!scoped) {
    return { allowed: false, unauthorizedFiles: [...files] };
  }
  const unauthorizedFiles = [];
  for (const f of files) {
    if (!scoped.files.has(f)) {
      unauthorizedFiles.push(f);
    }
  }
  return { allowed: unauthorizedFiles.length === 0, unauthorizedFiles };
}

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
      if (path.resolve(full) === __filename) continue;
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
    if (DATE_PATTERN.test(id)) continue;
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

  const mockRegistered = new Set(['GUARD-ORD-001']);
  const mockFixture = new Map([['FAKE-XYZ-999', 'test']]);
  const mockScoped = new Map([
    ['SCOPED-ID-001', { files: new Set(['allowed/path.ts']), rationale: 'test' }],
  ]);

  expect(
    'registered-id-passes',
    auditReference('GUARD-ORD-001', ['any/file.ts'], mockRegistered, mockFixture, mockScoped).allowed,
    true,
  );
  expect(
    'global-fixture-passes',
    auditReference('FAKE-XYZ-999', ['any/file.ts'], mockRegistered, mockFixture, mockScoped).allowed,
    true,
  );
  expect(
    'scoped-id-in-allowed-file-passes',
    auditReference('SCOPED-ID-001', ['allowed/path.ts'], mockRegistered, mockFixture, mockScoped).allowed,
    true,
  );
  expect(
    'scoped-id-in-unauthorized-file-blocks',
    auditReference('SCOPED-ID-001', ['allowed/path.ts', 'leak/path.ts'], mockRegistered, mockFixture, mockScoped).allowed,
    false,
  );
  expect(
    'unregistered-id-blocks',
    auditReference('UNREGISTERED-ID-999', ['any/file.ts'], mockRegistered, mockFixture, mockScoped).allowed,
    false,
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
    const verdict = auditReference(id, files, registered.ids, FIXTURE_ALLOWLIST, SCOPED_ALLOWLIST);
    if (!verdict.allowed) {
      unregistered.push({ id, files: verdict.unauthorizedFiles });
    }
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
  auditReference,
  buildScopedAllowlist,
  loadLegacyAliasTargets,
  RULE_ID_PATTERN,
});
