#!/usr/bin/env node
/**
 * Module: Verification Harness — Constant Semantic Governance & Position Tracking
 * File Path: scripts/validate-constant-governance.js
 * Architecture Role: Comprehensive automated test suite verifying constant semantic identity,
 *     cross-line relocation detection, Anti-Gaming debouncing, file layout discipline,
 *     scope over-widening guards, near-literal clustering, domain naming, and cross-file ownership.
 * Dependencies & Triggers: Run via `npm test` or `node scripts/validate-constant-governance.js`.
 * Responsibilities: Assert that the 7 core questions and 9 capability phases
 *     execute with 100% precision.
 * Exit Semantics & Design Rationale: Exits 0 on all tests passing, 1 on any assertion failure.
 */

'use strict';

const assert = require('assert');

// Target built modules from dist
const {
  computeConstantFingerprint,
  normalizeLiteralValue,
  areSemanticallyEqual,
} = require('../dist/core/intelligence/constant-identity');

const {
  extractConstantEntities,
  analyzeConstantTransitions,
} = require('../dist/core/diff/constant-relocation-detector');

const { generateSemanticConstantName } = require('../dist/core/governance/semantic-naming-engine');

const { checkConstantLayoutAndScope } = require('../dist/core/governance/constant-layout-guard');

const { scanNearLiteralClusters } = require('../dist/core/intelligence/near-literal-cluster');

const {
  arbitrateConstantOwnership,
} = require('../dist/core/architecture/constant-ownership-arbiter');

const { detectConstantDrift } = require('../dist/core/architecture/constant-drift-guard');

const { evaluatePatchQuality } = require('../dist/core/scoring/patchQuality');

const { detectDiffScoreGaming } = require('../dist/core/scoring/antiGaming');

console.log('=== Running Constant Governance & Position Tracking Test Suite ===\n');

// -------------------------------------------------------------
// Test 1: Stable Identity & Semantic Fingerprinting
// -------------------------------------------------------------
console.log('Test 1: Stable Identity & Fingerprinting...');
{
  const fp1 = computeConstantFingerprint({
    value: '5000',
    isNumeric: true,
    semanticKind: 'time-ms',
  });
  const fp2 = computeConstantFingerprint({
    value: '5000',
    isNumeric: true,
    semanticKind: 'time-ms',
  });
  const fp3 = computeConstantFingerprint({
    value: '3000',
    isNumeric: true,
    semanticKind: 'time-ms',
  });

  assert.strictEqual(
    fp1.semanticHash,
    fp2.semanticHash,
    'Identical values must have identical semantic hashes',
  );
  assert.notStrictEqual(
    fp1.semanticHash,
    fp3.semanticHash,
    'Different values must have distinct semantic hashes',
  );
  assert.strictEqual(areSemanticallyEqual(fp1, fp2), true);
  assert.strictEqual(areSemanticallyEqual(fp1, fp3), false);

  // Normalization of string quotes
  assert.strictEqual(normalizeLiteralValue("'hello'", false), 'hello');
  assert.strictEqual(normalizeLiteralValue('"hello"', false), 'hello');
  assert.strictEqual(normalizeLiteralValue('`hello`', false), 'hello');
}
console.log('  PASS: Stable fingerprint hashes match deterministically.\n');

// -------------------------------------------------------------
// Test 2: Relocation vs Mutation vs Renaming (Diff Matching)
// -------------------------------------------------------------
console.log('Test 2: Relocation vs Mutation vs Renaming Detection...');
{
  const beforeCode = `
import { foo } from './foo';

const RETRY_LIMIT = 3;
const TIMEOUT_MS = 5000;

function execute() {
    return run(TIMEOUT_MS, RETRY_LIMIT);
}
`;

  // In afterCode, RETRY_LIMIT stays at line 4, TIMEOUT_MS moves from line 5 to line 11
  const afterRelocated = `
import { foo } from './foo';

const RETRY_LIMIT = 3;

function execute() {
    return run(TIMEOUT_MS, RETRY_LIMIT);
}

const TIMEOUT_MS = 5000;
`;

  const beforeEntities = extractConstantEntities(beforeCode, 'test.ts');
  const afterEntities = extractConstantEntities(afterRelocated, 'test.ts');

  const result = analyzeConstantTransitions(beforeEntities, afterEntities);
  assert.strictEqual(result.relocatedCount, 1, 'Must detect 1 relocated constant');
  assert.strictEqual(result.unchangedCount, 1, 'RETRY_LIMIT line position is unchanged or tracked');
  assert.strictEqual(result.mutatedCount, 0, 'No semantic mutation should be detected');
  assert.strictEqual(result.insertedCount, 0, 'No new constant should be inserted');
  assert.strictEqual(result.deletedCount, 0, 'No constant should be deleted');

  const timeoutTransition = result.transitions.find(
    (t) => t.before && t.before.identity.name === 'TIMEOUT_MS',
  );
  assert.ok(timeoutTransition, 'Must find TIMEOUT_MS transition');
  assert.strictEqual(timeoutTransition.classification, 'relocated');
  assert.strictEqual(timeoutTransition.isPureRelocation, true);
  assert.ok(result.lineMigrationMap.has(5), 'Must map before line 5 to after line');
}
console.log('  PASS: Relocation accurately identified without false insert/delete.\n');

// -------------------------------------------------------------
// Test 3: Anti-Gaming Debounce & Change Quality Quantification
// -------------------------------------------------------------
console.log('Test 3: Anti-Gaming Debouncing & Change Quality Quantification...');
{
  const beforeCode = `
const A = 100;
const B = 200;
function run() { return A + B; }
`;
  // Pure line relocation of constants
  const afterRelocated = `
// Shifted lines
const B = 200;
const A = 100;
function run() { return A + B; }
`;

  const patchResult = evaluatePatchQuality({
    filePath: 'src/sample.ts',
    beforeContent: beforeCode,
    afterContent: afterRelocated,
  });

  assert.strictEqual(
    patchResult.introducedIssues.length,
    0,
    'Relocated constant must not introduce new issues',
  );
  assert.strictEqual(
    patchResult.resolvedIssues.length,
    0,
    'Relocated constant must not falsely resolve issues',
  );
  assert.ok(patchResult.deltaScore <= 0.0, 'Pure relocation must earn zero positive delta score');
  assert.strictEqual(patchResult.verdict, 'neutral', 'Pure relocation verdict must be neutral');

  // Test malicious artificial relocation padding (>= 4 constants moved)
  const beforeMulti = `
const C1 = 1;
const C2 = 2;
const C3 = 3;
const C4 = 4;
const C5 = 5;
function foo() { return C1 + C2 + C3 + C4 + C5; }
`;
  const afterMultiRelocated = `
function foo() { return C1 + C2 + C3 + C4 + C5; }
const C5 = 5;
const C4 = 4;
const C3 = 3;
const C2 = 2;
const C1 = 1;
`;

  const gamingCheck = detectDiffScoreGaming('src/sample.ts', beforeMulti, afterMultiRelocated);
  assert.strictEqual(
    gamingCheck.hasGaming,
    true,
    'Moving multiple constants without logic change must trigger gaming check',
  );
  assert.ok(gamingCheck.gamingKinds.includes('artificial_relocation_padding'));
  assert.ok(gamingCheck.gamingPenalty >= 15.0);
}
console.log('  PASS: Anti-Gaming debounces relocations and penalizes artificial padding.\n');

// -------------------------------------------------------------
// Test 4: File Layout Sequence Rule (CONST-LAY-001)
// -------------------------------------------------------------
console.log('Test 4: File Layout Sequence Governance (CONST-LAY-001)...');
{
  const misplacedCode = `
import { util } from './util';

function doWork() {
    return 42;
}

// VIOLATION: Module constant placed AFTER functions
const MODULE_TIMEOUT_MS = 5000;
`;

  const issues = checkConstantLayoutAndScope(misplacedCode, 'src/work.ts');
  const layIssue = issues.find((i) => i.rule === 'CONST-LAY-001');
  assert.ok(layIssue, 'Must detect misplaced module constant after function declaration');
  assert.strictEqual(layIssue.severity, 'warning');
  assert.ok(layIssue.message.includes('MODULE_TIMEOUT_MS'));

  const compliantCode = `
import { util } from './util';

const MODULE_TIMEOUT_MS = 5000;

function doWork() {
    return MODULE_TIMEOUT_MS;
}
`;
  const cleanIssues = checkConstantLayoutAndScope(compliantCode, 'src/work.ts');
  const cleanLayIssue = cleanIssues.find((i) => i.rule === 'CONST-LAY-001');
  assert.strictEqual(cleanLayIssue, undefined, 'Compliant code must not emit CONST-LAY-001');
}
console.log('  PASS: CONST-LAY-001 enforces standard file layout topology.\n');

// -------------------------------------------------------------
// Test 5: Scope Over-widening Guard (CONST-SCP-001)
// -------------------------------------------------------------
console.log('Test 5: Scope Over-widening Guard (CONST-SCP-001)...');
{
  const overWidenedCode = `
import { log } from './log';

// Private constant used only inside calculate() on a single line
const LOCAL_OFFSET = 42;

function calculate(val: number) {
    return val + LOCAL_OFFSET;
}

function otherWork() {
    return 'ok';
}
`;

  const issues = checkConstantLayoutAndScope(overWidenedCode, 'src/calc.ts');
  const scpIssue = issues.find((i) => i.rule === 'CONST-SCP-001');
  assert.ok(
    scpIssue,
    'Must flag top-level constant that is only consumed in single local function',
  );
  assert.ok(scpIssue.message.includes('作用域过度扩大'));
}
console.log('  PASS: CONST-SCP-001 prevents over-widening local invariants.\n');

// -------------------------------------------------------------
// Test 6: Near-Literal Calling Domain Clustering (CONST-CLU-001)
// -------------------------------------------------------------
console.log('Test 6: Near-Literal Calling Domain Clustering (CONST-CLU-001)...');
{
  const mockLiterals = [
    {
      value: '200',
      numeric: true,
      isConstBound: true, // already extracted as constant
      tolerated: false,
      line: 10,
      node: { start: { line: 10, column: 5 }, text: '200' },
    },
    {
      value: '404',
      numeric: true,
      isConstBound: false, // still hardcoded
      tolerated: false,
      line: 12,
      node: { start: { line: 12, column: 15 }, text: '404' },
    },
    {
      value: '500',
      numeric: true,
      isConstBound: false, // still hardcoded
      tolerated: false,
      line: 15,
      node: { start: { line: 15, column: 15 }, text: '500' },
    },
  ];

  const clusterIssues = scanNearLiteralClusters(mockLiterals, 'src/api/handler.ts');
  assert.ok(clusterIssues.length > 0, 'Must detect unextracted sibling literals');
  const cluIssue = clusterIssues[0];
  assert.strictEqual(cluIssue.rule, 'CONST-CLU-001');
  assert.ok(cluIssue.message.includes('http_status'));
  assert.ok(cluIssue.suggestion.includes('HTTP_STATUS_NOT_FOUND'));
  assert.ok(cluIssue.suggestion.includes('HTTP_STATUS_INTERNAL_SERVER_ERROR'));
}
console.log('  PASS: CONST-CLU-001 identifies sibling unextracted literals with batch advice.\n');

// -------------------------------------------------------------
// Test 7: Domain-Aware Semantic Naming Engine
// -------------------------------------------------------------
console.log('Test 7: Domain-Aware Semantic Naming Engine...');
{
  // HTTP Status codes
  assert.strictEqual(generateSemanticConstantName('200', true), 'HTTP_STATUS_OK');
  assert.strictEqual(generateSemanticConstantName('404', true), 'HTTP_STATUS_NOT_FOUND');
  assert.strictEqual(
    generateSemanticConstantName('500', true),
    'HTTP_STATUS_INTERNAL_SERVER_ERROR',
  );

  // Network Ports
  assert.strictEqual(generateSemanticConstantName('80', true), 'DEFAULT_HTTP_PORT');
  assert.strictEqual(generateSemanticConstantName('443', true), 'DEFAULT_HTTPS_PORT');
  assert.strictEqual(generateSemanticConstantName('8080', true), 'DEFAULT_HTTP_ALT_PORT');

  // Millisecond Durations & Contextual Anchors
  assert.strictEqual(generateSemanticConstantName('1000', true), 'ONE_SECOND_MS');
  assert.strictEqual(
    generateSemanticConstantName('5000', true, { parentPropertyName: 'timeoutMs' }),
    'TIMEOUT_MS',
  );
  assert.strictEqual(
    generateSemanticConstantName('3', true, { parentPropertyName: 'maxRetryCount' }),
    'MAX_RETRY_COUNT',
  );

  // Events & Routes
  assert.strictEqual(generateSemanticConstantName("'click'", false), 'EVENT_CLICK');
  assert.strictEqual(generateSemanticConstantName("'keydown'", false), 'EVENT_KEYDOWN');
  assert.ok(generateSemanticConstantName("'/api/v1/users'", false).includes('USERS'));
}
console.log('  PASS: Semantic naming engine produces domain-accurate names.\n');

// -------------------------------------------------------------
// Test 8: Cross-File Ownership Arbitration & Anti-Drift Guard
// -------------------------------------------------------------
console.log('Test 8: Cross-File Ownership & Anti-Drift Guard...');
{
  // Ownership Tier 1: Single file consumer
  const resSingle = arbitrateConstantOwnership(
    'LOCAL_PAGE_SIZE',
    '20',
    'src/core/router/view.ts',
    5,
    ['src/core/router/view.ts'],
  );
  assert.strictEqual(resSingle.resolution.recommendedTier, 'module_private');

  // Ownership Tier 2: Domain-shared (multiple files in src/core/router/)
  const resDomain = arbitrateConstantOwnership(
    'ROUTER_STATE_IDLE',
    '"idle"',
    'src/core/router/view.ts',
    5,
    ['src/core/router/view.ts', 'src/core/router/parser.ts'],
  );
  assert.strictEqual(resDomain.resolution.recommendedTier, 'domain_shared');
  assert.strictEqual(resDomain.resolution.recommendedTargetFile, 'src/core/router/types.ts');

  // Ownership Tier 3: Protocol-shared (spans across core and analyzers)
  const resProtocol = arbitrateConstantOwnership(
    'GLOBAL_CORE_VERSION',
    '"1.0.0"',
    'src/core/router/view.ts',
    5,
    ['src/core/router/view.ts', 'src/analyzers/constants.ts'],
  );
  assert.strictEqual(resProtocol.resolution.recommendedTier, 'protocol_shared');

  // Anti-Drift Guard: Detect same name with divergent values across files
  const driftDecls = [
    { name: 'DEFAULT_TIMEOUT', normalizedValue: '3000', filePath: 'src/moduleA.ts', line: 10 },
    { name: 'DEFAULT_TIMEOUT', normalizedValue: '5000', filePath: 'src/moduleB.ts', line: 15 },
  ];
  const driftIssues = detectConstantDrift(driftDecls);
  assert.ok(driftIssues.length >= 2, 'Must flag both divergent declaration sites');
  assert.strictEqual(driftIssues[0].rule, 'CONST-DRF-001');
  assert.ok(driftIssues[0].message.includes('DEFAULT_TIMEOUT'));
}
console.log('  PASS: Ownership and Drift guards enforce clean cross-file boundaries.\n');

console.log('=== All Constant Governance & Position Tracking Tests Passed! ===\n');
