#!/usr/bin/env node
/**
 * Module: Verification Harness — Preflight Audit Index & Sparse Review Execution Architecture
 * File Path: scripts/validate-preflight-audit-index.js
 * Architecture Role: Verification harness for preflight audit indexing,
 *   sparse activation, and Bayesian scope normalization subsystems.
 * Dependencies & Triggers: `npm test` or `node scripts/validate-preflight-audit-index.js`;
 *   imports dist/core/preflight and Node built-in assert/fs/path/os.
 * Responsibilities:
 *   1. ELOC baseline: Assert historical audit ELOC unknown locking, updates, and ledger.
 *   2. Preflight index: Assert lightweight index extraction (roles, lang, deps, risk).
 *   3. Scope decision: Assert explicit scope decisions (PROJECT, CHANGESET, DOMAIN).
 *   4. Sparse activation: Assert affinity scoring A(r,f), language cross-blocking, and pruning.
 *   5. Slice partitioning: Assert orthogonal slice partitioning and shared cache deduplication.
 *   6. Progressive expansion: Assert controlled expansion and depth-bounded blast radius bounds.
 *   7. Audit bus: Assert finding aggregation, duplicate suppression, and confidence decoupling.
 *   8. Scope normalization: Assert Bayesian conjugate updating and score stability.
 *   9. Controller facade: Assert preflight controller execution and gate differentiation.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passed; exits 1 on failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  readAuditedBaseline,
  updateAuditedBaseline,
  buildFileAuditIndex,
  PreflightAuditIndexStore,
  decideAuditScope,
  activateSparseAnalyzers,
  partitionReviewSlices,
  SharedContextCache,
  traceProgressiveExpansion,
  AuditBus,
  normalizeScopeQuality,
  executePreflightPlan,
  finalizeAuditSession,
} = require('../dist/core/preflight');

function createIsolatedWorkspace(prefix) {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return workspacePath;
}

function removeDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// ELOC Baseline Confirmation & Ledger Verification
// ---------------------------------------------------------------------------
async function testElocBaselineConfirmation() {
  console.log('  ▶ [ELOC Baseline] Verifying baseline confirmation and historical locking...');
  const isolatedDir = createIsolatedWorkspace('eloc-audit-');
  try {
    // 1. Unrecorded state must explicitly be marked 'Unknown', never fabricated
    const initialStatus = await readAuditedBaseline(isolatedDir);
    assert.strictEqual(
      initialStatus.historicalAuditedEloc,
      'Unknown',
      'Unrecorded historical audited ELOC must be locked to "Unknown"',
    );
    assert.strictEqual(initialStatus.status, 'Unknown');
    assert.strictEqual(initialStatus.accumulatedEloc.processed, 0);

    // 2. Incremental update with first session
    const session1 = await updateAuditedBaseline({
      ledgerDir: isolatedDir,
      delta: {
        processed: 120,
        unique: 110,
        changed: 45,
        semantic: 38,
      },
      reviewId: 'rev-001',
      commitHash: 'c1a2b3d',
      gateVerdict: { pass: true, code: 'PASS' },
    });

    assert.strictEqual(session1.accumulatedEloc.processed, 120);
    assert.strictEqual(session1.accumulatedEloc.unique, 110);
    assert.strictEqual(session1.accumulatedEloc.changed, 45);
    assert.strictEqual(session1.accumulatedEloc.semantic, 38);
    assert.strictEqual(session1.lastReviewId, 'rev-001');
    assert.strictEqual(session1.lastCommitHash, 'c1a2b3d');
    assert.strictEqual(session1.lastGateVerdict.code, 'PASS');

    // 3. Second session increments cumulatively
    const session2 = await updateAuditedBaseline({
      ledgerDir: isolatedDir,
      delta: {
        processed: 500,
        unique: 450,
        changed: 200,
        semantic: 180,
      },
      reviewId: 'rev-002',
      commitHash: 'e4f5a6b',
      gateVerdict: { pass: true, code: 'PASS' },
    });

    assert.strictEqual(session2.accumulatedEloc.processed, 620);
    assert.strictEqual(session2.accumulatedEloc.unique, 560);
    assert.strictEqual(session2.accumulatedEloc.changed, 245);
    assert.strictEqual(session2.accumulatedEloc.semantic, 218);
    assert.strictEqual(session2.lastReviewId, 'rev-002');

    // 4. Persistence reload parity
    const reloaded = await readAuditedBaseline(isolatedDir);
    assert.strictEqual(reloaded.accumulatedEloc.processed, 620);
    assert.strictEqual(reloaded.accumulatedEloc.unique, 560);
    assert.strictEqual(reloaded.lastCommitHash, 'e4f5a6b');
  } finally {
    removeDir(isolatedDir);
  }
}

// ---------------------------------------------------------------------------
// Lightweight Preflight Index Verification
// ---------------------------------------------------------------------------
function testLightweightAuditIndex() {
  console.log('  ▶ [Audit Index] Verifying lightweight index extraction without deep AST...');
  const store = new PreflightAuditIndexStore();

  // 1. TypeScript normal source
  const tsCode = [
    'import { foo } from "./foo";',
    'import * as bar from "./bar";',
    'export function calc(x: number): number {',
    '  return x * 2;',
    '}',
    'export const CONST_VAL = 42;',
  ].join('\n');

  const tsIndex = buildFileAuditIndex('src/math/calc.ts', tsCode);
  assert.strictEqual(tsIndex.lang, 'typescript');
  assert.strictEqual(tsIndex.deps.imports.length, 2);
  assert.strictEqual(tsIndex.deps.exports.length, 2);
  assert(tsIndex.deps.exports.includes('calc'));
  assert(tsIndex.deps.exports.includes('CONST_VAL'));
  assert(tsIndex.eloc.estimatedEloc > 0);

  // 2. Rules registry file identification
  const ruleCode = 'export const RULES = { "RULE-01": { id: "RULE-01" } };';
  const ruleIndex = buildFileAuditIndex('src/core/rules/registry.ts', ruleCode);
  assert.strictEqual(ruleIndex.role, 'rules_registry');

  // 3. Test suite identification
  const testCode = 'describe("calc", () => { it("works", () => { assert(true); }); });';
  const testIndex = buildFileAuditIndex('tests/unit/calc.test.ts', testCode);
  assert.strictEqual(testIndex.role, 'test_suite');
  assert.strictEqual(testIndex.type, 'test');

  // 4. Config file identification
  const jsonConfig = JSON.stringify({ name: 'pkg', version: '1.0.0' }, null, 2);
  const configIndex = buildFileAuditIndex('src/config/settings.json', jsonConfig);
  assert.strictEqual(configIndex.lang, 'json');
  assert.strictEqual(configIndex.role, 'config_constant');
  assert.strictEqual(configIndex.type, 'config');

  // 5. Constants library identification
  const constCode = 'export const TIMEOUT = 5000; export const RETRIES = 3;';
  const constIndex = buildFileAuditIndex('src/constants/limits.ts', constCode);
  assert.strictEqual(constIndex.role, 'config_constant');

  // 6. Fan-in and Fan-out resolution via batchIndex
  const fileMap = new Map([
    ['src/a.ts', 'import { b } from "./b"; export const a = 1;'],
    ['src/b.ts', 'import { c } from "./c"; export const b = 2;'],
    ['src/c.ts', 'export const c = 3;'],
  ]);
  const batchEntries = store.batchIndex(fileMap);
  assert.strictEqual(batchEntries.length, 3);
  assert.strictEqual(store.size, 3);
  const bEntry = store.get('src/b.ts');
  assert(bEntry !== undefined);
  assert.strictEqual(bEntry.deps.fanOut, 1);
}

// ---------------------------------------------------------------------------
// Explicit Scope Decision Verification
// ---------------------------------------------------------------------------
function testScopeDecision() {
  console.log('  ▶ [Scope Decision] Verifying explicit scope mode decisions...');
  const store = new PreflightAuditIndexStore();

  const sampleFiles = new Map([
    ['src/feature/a.ts', 'export const a = 1;'],
    ['src/feature/b.ts', 'export const b = 2;'],
    ['src/constants/shared.ts', 'export const PI = 3.14;'],
    ['package.json', '{"name":"demo"}'],
  ]);
  store.batchIndex(sampleFiles);
  const allFiles = Array.from(sampleFiles.keys());

  // 1. Explicit mode override
  const explicitProject = decideAuditScope({
    explicitMode: 'PROJECT',
    allProjectFiles: allFiles,
    indexStore: store,
  });
  assert.strictEqual(explicitProject.mode, 'PROJECT');
  assert.strictEqual(explicitProject.selectedFilesCount, allFiles.length);

  const explicitDomain = decideAuditScope({
    explicitMode: 'DOMAIN',
    explicitDomain: 'constants',
    allProjectFiles: allFiles,
    indexStore: store,
  });
  assert.strictEqual(explicitDomain.mode, 'DOMAIN');
  assert.strictEqual(explicitDomain.domain, 'constants');
  assert(explicitDomain.targetFiles.some((f) => f.includes('constants')));

  // 2. Diff with small localized changes -> CHANGESET
  const diffDecision = decideAuditScope({
    diffFiles: ['src/feature/a.ts'],
    allProjectFiles: allFiles,
    indexStore: store,
  });
  assert.strictEqual(diffDecision.mode, 'CHANGESET');
  assert(diffDecision.targetFiles.includes('src/feature/a.ts'));
  assert.strictEqual(diffDecision.isFallbackFromRisk, false);

  // 3. Diff exceeding max blast radius -> safety fallback to PROJECT
  const safetyFallbackDecision = decideAuditScope({
    diffFiles: ['src/feature/a.ts'],
    allProjectFiles: allFiles,
    indexStore: store,
    maxChangesetBlastRadius: 0, // Force blast radius barrier hit
  });
  assert.strictEqual(safetyFallbackDecision.mode, 'PROJECT');
  assert.strictEqual(safetyFallbackDecision.isFallbackFromRisk, true);
}

// ---------------------------------------------------------------------------
// Sparse Activation Verification
// ---------------------------------------------------------------------------
function testSparseActivation() {
  console.log('  ▶ [Sparse Activation] Verifying sparse activation scoring...');
  const store = new PreflightAuditIndexStore();

  const sampleFiles = new Map([
    ['src/core/engine.ts', 'export function run() { return 1; }'],
    ['src/scripts/tool.py', 'def run():\n    pass\n'],
    ['package.json', '{"key": "value"}'],
  ]);
  const entries = store.batchIndex(sampleFiles);

  const scopeDecision = decideAuditScope({
    explicitMode: 'CHANGESET',
    diffFiles: ['src/core/engine.ts'],
    allProjectFiles: Array.from(sampleFiles.keys()),
    indexStore: store,
  });

  const availableAnalyzers = ['typescript-modern', 'python-modern', 'hygiene'];

  const result = activateSparseAnalyzers(
    availableAnalyzers,
    entries,
    scopeDecision,
    new Set(['src/core/engine.ts']),
    new Set(),
    0.35,
  );

  // 1. engine.ts is changed TS file -> typescript-modern and hygiene should be active
  const engineAnalyzers = result.fileAnalyzerMap['src/core/engine.ts'] || [];
  assert(engineAnalyzers.includes('typescript-modern'));
  assert(engineAnalyzers.includes('hygiene'));
  // Python analyzer must NOT activate on TS file
  assert(!engineAnalyzers.includes('python-modern'));

  // 2. tool.py is unchanged python file in CHANGESET -> skipped
  assert(result.skippedFiles.includes('src/scripts/tool.py'));

  // 3. Summary metrics output
  assert(result.selectedFiles.includes('src/core/engine.ts'));
  assert(result.activatedAnalyzers.includes('typescript-modern'));
  assert(result.summaryText.includes('Files Selected:'));
}

// ---------------------------------------------------------------------------
// Slice Partitioning & Context Cache Verification
// ---------------------------------------------------------------------------
function testSlicePartitioningAndContextCache() {
  console.log('  ▶ [Slice Partitioning] Verifying orthogonal slice partitioning...');
  const cache = new SharedContextCache();
  const store = new PreflightAuditIndexStore();

  const files = new Map([
    ['src/core/syntax.ts', 'export const x = 1;'],
    ['src/core/logic.ts', 'export const y = 2;'],
    ['tests/unit/logic.test.ts', 'it("works", () => {});'],
  ]);
  const entries = store.batchIndex(files);

  const activation = {
    selectedFiles: Array.from(files.keys()),
    activatedAnalyzers: ['hygiene', 'complexity', 'test-modernity'],
    skippedAnalyzers: [],
    skippedFiles: [],
    activationRatio: 1.0,
    summaryText: 'All activated',
    fileAnalyzerMap: {
      'src/core/syntax.ts': ['hygiene'],
      'src/core/logic.ts': ['complexity'],
      'tests/unit/logic.test.ts': ['test-modernity'],
    },
    rationaleMap: {},
  };

  const partitionResult = partitionReviewSlices(activation, entries, 4);
  assert(partitionResult.slices.length >= 2, 'Should partition into multiple slices');
  assert(partitionResult.maxConcurrency <= 4);

  // SharedContextCache assertion
  const dummyAst = { type: 'Program', body: [] };
  const dummySymbols = ['x', 'y'];

  cache.setAst('src/core/syntax.ts', dummyAst);
  cache.setSymbols('src/core/syntax.ts', dummySymbols);

  assert.strictEqual(cache.hasAst('src/core/syntax.ts'), true);
  assert.strictEqual(cache.getAst('src/core/syntax.ts'), dummyAst);
  assert.deepStrictEqual(cache.getSymbols('src/core/syntax.ts'), dummySymbols);
  assert.strictEqual(cache.hasAst('src/core/logic.ts'), false);

  cache.clear();
  assert.strictEqual(cache.hasAst('src/core/syntax.ts'), false);
}

// ---------------------------------------------------------------------------
// Progressive Controlled Expansion Verification
// ---------------------------------------------------------------------------
function testProgressiveExpansion() {
  console.log('  ▶ [Progressive Expansion] Verifying controlled expansion bounds...');
  const store = new PreflightAuditIndexStore();

  // Create a mini dependency network:
  // a.ts -> imports b; b.ts -> imports c; c.ts -> imports d; d.ts
  const files = new Map([
    ['src/a.ts', 'import { b } from "./b"; export const a = 1;'],
    ['src/b.ts', 'import { c } from "./c"; export const b = 2;'],
    ['src/c.ts', 'import { d } from "./d"; export const c = 3;'],
    ['src/d.ts', 'export const d = 4;'],
  ]);
  store.batchIndex(files);

  // Case 1: High threshold -> stops expansion early
  const tightResult = traceProgressiveExpansion(['src/d.ts'], store, {
    expansionThreshold: 0.99, // Unreachable barrier
  });
  assert(tightResult.allAuditedFiles.includes('src/d.ts'));

  // Case 2: Permissive threshold -> expands into callers (c.ts imports d)
  const permissiveResult = traceProgressiveExpansion(['src/d.ts'], store, {
    expansionThreshold: 0.05,
  });
  assert(permissiveResult.firstOrderNeighbors.length >= 1);
  assert(permissiveResult.firstOrderNeighbors.includes('src/c.ts'));
  assert(permissiveResult.allAuditedFiles.length >= 2);
}

// ---------------------------------------------------------------------------
// Audit Bus Aggregation Verification
// ---------------------------------------------------------------------------
function testAuditBusAggregation() {
  console.log('  ▶ [Audit Bus] Verifying audit bus aggregation and duplicate suppression...');
  const bus = new AuditBus();

  // Register finding events from parallel analyzers
  bus.emitFindings([
    {
      issue: {
        rule: 'SYNTAX-ERR',
        message: 'Syntax error: unexpected token',
        severity: 'error',
        location: {
          file: 'src/core/math.ts',
          start: { line: 10, column: 5 },
          end: { line: 10, column: 12 },
        },
      },
      analyzerId: 'syntax-pass-1',
      confidence: 0.95,
    },
    {
      issue: {
        rule: 'SYNTAX-ERR',
        message: 'Duplicate syntax error from parallel worker',
        severity: 'error',
        location: {
          file: 'src/core/math.ts',
          start: { line: 10, column: 5 },
          end: { line: 10, column: 12 },
        },
      },
      analyzerId: 'syntax-pass-2',
      confidence: 0.95,
    },
    {
      issue: {
        rule: 'NESTING-DEEP',
        message: 'Deeply nested block',
        severity: 'warning',
        location: {
          file: 'src/core/math.ts',
          start: { line: 25, column: 1 },
          end: { line: 30, column: 1 },
        },
      },
      analyzerId: 'complexity-pass',
      confidence: 0.85,
    },
  ]);

  bus.emitMetric({
    filePath: 'src/core/math.ts',
    physicalLines: 50,
    nonBlankLines: 40,
    eloc: 35,
  });

  const aggregated = bus.finalize();

  // 1. Duplicate finding on line 10 SYNTAX-ERR must be deduplicated
  const syntaxFindings = aggregated.uniqueFindings.filter((f) => f.rule === 'SYNTAX-ERR');
  assert.strictEqual(syntaxFindings.length, 1);
  assert.strictEqual(syntaxFindings[0].occurrencesCount, 2);

  // 2. Total findings deduplication counts
  assert.strictEqual(aggregated.totalEmittedFindings, 3);
  assert.strictEqual(aggregated.uniqueFindings.length, 2);
  assert.strictEqual(aggregated.deduplicatedCount, 1);
  assert.strictEqual(aggregated.findingsBySeverity.error, 1);
  assert.strictEqual(aggregated.findingsBySeverity.warning, 1);

  // 3. Unique audited files and ELOC
  assert.strictEqual(aggregated.uniqueFilesAudited.length, 1);
  assert.strictEqual(aggregated.totalAuditedEloc, 35);
}

// ---------------------------------------------------------------------------
// Scope Normalization & Bayesian Stability Verification
// ---------------------------------------------------------------------------
function testScopeNormalizationAndBayesianStability() {
  console.log('  ▶ [Scope Normalization] Verifying Bayesian score cliff prevention...');

  const baselineScore = 99.2;
  const totalRepoEloc = 50000;

  // Simulate localized 3-file changeset with 50 ELOC and a local score of 72.0
  const localSliceScores = {
    security: 70,
    performance: 75,
    architecture: 72,
    reliability: 70,
    maintainability: 74,
    testCoverage: 70,
    codeStyle: 75,
    documentation: 70,
    dependencyHealth: 70,
    operationalReadiness: 70,
  };

  const normalizedResult = normalizeScopeQuality({
    mode: 'CHANGESET',
    priorProjectMean: baselineScore,
    priorProjectConfidence: 0.95,
    sliceAfterScores: localSliceScores,
    elocAudited: 50,
    elocBlastRadius: 50,
    elocTotalProject: totalRepoEloc,
    elocSemantic: 40,
    averageEvidenceConfidence: 0.85,
  });

  // Bayesian conjugate update prevents localized finding from causing a score cliff:
  // Global posterior mean must NOT drop to ~72, but remain stable around baseline (~99.1-99.2)
  const posteriorMean = normalizedResult.projectBaseline.mean;
  assert(
    posteriorMean >= 99.0 && posteriorMean <= 99.3,
    `Expected posterior mean to stay stable around baseline (~99.1), got ${posteriorMean}`,
  );

  // Changeset delta is localized
  assert(normalizedResult.changesetDelta !== undefined);
  assert(normalizedResult.changesetDelta.deltaQ < 0);

  // 95% Confidence Interval is bounded
  const [ciLower, ciUpper] = normalizedResult.projectBaseline.confidenceInterval95;
  assert(ciLower <= posteriorMean);
  assert(ciUpper >= posteriorMean);

  // Full project scan updates baseline directly
  const projectResult = normalizeScopeQuality({
    mode: 'PROJECT',
    priorProjectMean: baselineScore,
    priorProjectConfidence: 0.95,
    sliceAfterScores: {
      security: 95,
      performance: 95,
      architecture: 95,
      reliability: 95,
      maintainability: 95,
      testCoverage: 95,
      codeStyle: 95,
      documentation: 95,
      dependencyHealth: 95,
      operationalReadiness: 95,
    },
    elocAudited: 48000,
    elocBlastRadius: 50000,
    elocTotalProject: totalRepoEloc,
    elocSemantic: 45000,
    averageEvidenceConfidence: 0.95,
  });

  assert(
    Math.abs(projectResult.projectBaseline.mean - 95.0) < 1.0,
    `Project-wide scan should update posterior mean close to observed 95.0, ` +
      `got ${projectResult.projectBaseline.mean}`,
  );
}

// ---------------------------------------------------------------------------
// Preflight Controller End-to-End Verification
// ---------------------------------------------------------------------------
async function testPreflightControllerEndToEnd() {
  console.log('  ▶ [Preflight Controller] Verifying end-to-end plan and finalization...');
  const isolatedDir = createIsolatedWorkspace('preflight-e2e-');
  try {
    const fileContents = new Map([
      ['src/app.ts', 'export function main() { return 0; }'],
      ['src/util.ts', 'export const id = (x: any) => x;'],
      ['tests/unit/app.test.ts', 'it("works", () => {});'],
    ]);

    const analyzers = ['typescript-modern', 'hygiene'];

    // 1. Generate plan via public facade
    const plan = await executePreflightPlan({
      ledgerDir: isolatedDir,
      fileContents,
      availableAnalyzers: analyzers,
      diffFiles: ['src/app.ts'],
      explicitMode: 'CHANGESET',
      activationThreshold: 0.2,
    });

    assert.strictEqual(plan.scopeDecision.mode, 'CHANGESET');
    assert(plan.scopeDecision.targetFiles.includes('src/app.ts'));
    assert(plan.partitionResult.slices.length > 0);
    assert(Object.isFrozen(plan));

    // 2. Finalize audit session with clean findings
    const cleanScores = {
      security: 99,
      performance: 99,
      architecture: 99,
      reliability: 99,
      maintainability: 99,
      testCoverage: 99,
      codeStyle: 99,
      documentation: 99,
      dependencyHealth: 99,
      operationalReadiness: 99,
    };

    const outcome = await finalizeAuditSession({
      planResult: plan,
      reviewId: 'rev-e2e-1',
      commitHash: 'abcdef012345',
      priorProjectMean: 98.5,
      sliceAfterScores: cleanScores,
      elocSemantic: 10,
      ledgerDir: isolatedDir,
    });

    assert.strictEqual(outcome.gateVerdict.code, 'PASS_CHANGESET_LOCAL');
    assert.strictEqual(outcome.gateVerdict.pass, true);
    assert.strictEqual(outcome.mode, 'CHANGESET');
    assert(outcome.transparentReport.auditedEloc >= 0);
    assert(Object.isFrozen(outcome));
  } finally {
    removeDir(isolatedDir);
  }
}

// ---------------------------------------------------------------------------
// Main Harness
// ---------------------------------------------------------------------------
async function runAllTests() {
  console.log('=== Preflight Audit Index & Sparse Review Verification Suite ===\n');

  await testElocBaselineConfirmation();
  testLightweightAuditIndex();
  testScopeDecision();
  testSparseActivation();
  testSlicePartitioningAndContextCache();
  testProgressiveExpansion();
  testAuditBusAggregation();
  testScopeNormalizationAndBayesianStability();
  await testPreflightControllerEndToEnd();

  console.log('\n✔ All 9 preflight audit index architecture test suites passed successfully.');
}

runAllTests().catch((err) => {
  console.error('\n✖ Test suite execution failed:');
  console.error(err);
  process.exit(1);
});
