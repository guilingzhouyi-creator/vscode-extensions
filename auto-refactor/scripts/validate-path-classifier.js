#!/usr/bin/env node
/**
 * Module: Verification Harness — Polyglot Path Classifier Verification
 * File Path: scripts/validate-path-classifier.js
 * Architecture Role: Asserts correctness and polyglot parity of unified PathClassifier,
 *   verifying tests, fixtures, mocks, benchmarks, scripts, documentation, and generated code.
 * Dependencies & Triggers: `npm test`; tests `dist/api` / `dist/core/path`.
 * Responsibilities:
 *   1. Assert polyglot test detection across TS, JS, Python, Rust, Go, and GDScript;
 *   2. Assert fixture and mock data path recognition;
 *   3. Assert benchmark and performance measurement harness detection;
 *   4. Assert operational script and gate workflow path identification;
 *   5. Assert documentation and generated artifact classification;
 *   6. Assert architectural exemption predicate accuracy;
 *   7. Assert whole-path classification enum outputs.
 * Exit Semantics & Design Rationale: Exits 0 on success, non-zero on assertion failure.
 */
'use strict';

const assert = require('assert');

console.log('🚀 [PATH-CLASSIFIER] Starting Polyglot Path Classifier Verification Harness...\n');

const {
  isTestFilePath,
  isFixtureOrMockPath,
  isBenchmarkPath,
  isScriptOrGatePath,
  isDocumentationPath,
  isGeneratedOrDistPath,
  isExemptFromArchitectureRules,
  classifyFilePath,
  PathClassifier,
} = require('../dist/api');

// --- [1/7] Testing Polyglot Test File Classification ---
console.log('--- [1/7] Testing Polyglot Test File Classification ---');
const positiveTests = [
  'src/analyzers/security.test.ts',
  'src/core/ast/parser.spec.ts',
  'components/Button.test.tsx',
  'components/Modal.spec.jsx',
  'tests/unit/test-codec.js',
  'src/__tests__/scanner.ts',
  'tests/integration/audit.rs',
  'crates/fg-core/tests/quarantine.rs',
  'tests/test_engine.py',
  'engine/core_test.py',
  'game/character_test.gd',
  'tests/battle_system_test.gd',
  'server/router_test.go',
];

for (const p of positiveTests) {
  assert.strictEqual(isTestFilePath(p), true, `Path '${p}' must be recognized as test file`);
  assert.strictEqual(PathClassifier.isTest(p), true, `PathClassifier.isTest must match for '${p}'`);
}

const negativeTests = [
  'src/core/analyzer.ts',
  'src/analyzers/client-exposure.ts',
  'engine/combat_system.gd',
  'server/handler.go',
  'crates/fg-gate/src/lib.rs',
  'scripts/common/sync-doc-metrics.js',
];

for (const p of negativeTests) {
  assert.strictEqual(isTestFilePath(p), false, `Production path '${p}' must NOT be classified as test file`);
}
console.log(`✔ Verified ${positiveTests.length} positive and ${negativeTests.length} negative test paths.`);

// --- [2/7] Testing Fixtures and Mock Path Identification ---
console.log('\n--- [2/7] Testing Fixtures and Mock Path Identification ---');
const fixturePaths = [
  'tests/fixtures/sample-config.json',
  'auto-refactor/fixtures/corrupt-ast.ts',
  'src/__mocks__/fs-extra.ts',
  'testdata/input-corpus.txt',
  'tests/samples/legacy-module.js',
];

for (const p of fixturePaths) {
  assert.strictEqual(isFixtureOrMockPath(p), true, `Fixture path '${p}' must be recognized`);
  assert.strictEqual(classifyFilePath(p), 'fixture', `Category for fixture '${p}' must be 'fixture'`);
}
console.log(`✔ Verified ${fixturePaths.length} fixture and mock paths.`);

// --- [3/7] Testing Benchmark Path Identification ---
console.log('\n--- [3/7] Testing Benchmark Path Identification ---');
const benchPaths = [
  'benches/hashing_benchmark.rs',
  'scripts/benchmark.js',
  'src/perf.bench.ts',
  'benchmarks/throughput.go',
  'tests/.bench/latency.ts',
];

for (const p of benchPaths) {
  assert.strictEqual(isBenchmarkPath(p), true, `Benchmark path '${p}' must be recognized`);
  assert.strictEqual(classifyFilePath(p), 'benchmark', `Category for benchmark '${p}' must be 'benchmark'`);
}
console.log(`✔ Verified ${benchPaths.length} benchmark paths.`);

// --- [4/7] Testing Script and Gate Path Identification ---
console.log('\n--- [4/7] Testing Script and Gate Path Identification ---');
const scriptPaths = [
  'scripts/ps1/audit-all.ps1',
  'scripts/common/validate-code-density.js',
  'bin/auto-refactor.js',
  '.github/workflows/ci.yml',
  '.githooks/pre-commit',
  'tools/export-corpus.py',
];

for (const p of scriptPaths) {
  assert.strictEqual(isScriptOrGatePath(p), true, `Script/gate path '${p}' must be recognized`);
  assert.strictEqual(classifyFilePath(p), 'script', `Category for script '${p}' must be 'script'`);
}
console.log(`✔ Verified ${scriptPaths.length} script and workflow gate paths.`);

// --- [5/7] Testing Documentation Path Identification ---
console.log('\n--- [5/7] Testing Documentation Path Identification ---');
const docPaths = [
  'docs/01-architecture.md',
  'README.md',
  'docs/system-spec/rule-catalog.md',
  'auto-refactor/DOCS.md',
  'notes/release-summary.txt',
];

for (const p of docPaths) {
  assert.strictEqual(isDocumentationPath(p), true, `Doc path '${p}' must be recognized`);
  assert.strictEqual(classifyFilePath(p), 'documentation', `Category for doc '${p}' must be 'documentation'`);
}
console.log(`✔ Verified ${docPaths.length} documentation paths.`);

// --- [6/7] Testing Generated and Distribution Path Identification ---
console.log('\n--- [6/7] Testing Generated and Distribution Paths ---');
const distPaths = [
  'dist/api.js',
  'node_modules/typescript/lib/typescript.js',
  'target/release/taxis.exe',
  'build/bundle.js',
  'src/constants/rule-catalog.generated.ts',
];

for (const p of distPaths) {
  assert.strictEqual(isGeneratedOrDistPath(p), true, `Dist/gen path '${p}' must be recognized`);
  assert.strictEqual(classifyFilePath(p), 'generated', `Category for dist '${p}' must be 'generated'`);
}
console.log(`✔ Verified ${distPaths.length} distribution and generated code paths.`);

// --- [7/7] Testing Architecture Exemption Predicate ---
console.log('\n--- [7/7] Testing Architecture Exemption Predicate ---');
assert.strictEqual(isExemptFromArchitectureRules('src/core/scanner.ts'), false, 'Core source must NOT be exempt');
assert.strictEqual(isExemptFromArchitectureRules('tests/unit/scanner.test.ts'), true, 'Test must be exempt');
assert.strictEqual(isExemptFromArchitectureRules('scripts/audit.ps1'), true, 'Script must be exempt');
assert.strictEqual(isExemptFromArchitectureRules('fixtures/data.json'), true, 'Fixture must be exempt');
assert.strictEqual(isExemptFromArchitectureRules('dist/api.js'), true, 'Dist artifact must be exempt');
console.log('✔ Architecture exemption predicates verified.');

console.log('\n================================================================');
console.log('🎉 ALL 7 POLYGLOT PATH CLASSIFIER VERIFICATIONS PASSED!');
console.log('================================================================\n');
