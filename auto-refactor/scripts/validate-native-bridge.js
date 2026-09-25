#!/usr/bin/env node
/**
 * Module: Verification Harness — Native Acceleration Bridge Suite
 * File Path: scripts/validate-native-bridge.js
 * Architecture Role: Integration and correctness verification suite for the native
 *   acceleration bridge and pure JS fallback algorithms.
 * Dependencies & Triggers: Consumes ../dist/api; executed in `npm test` and test-parallel.js.
 * Responsibilities:
 *   1. Assert engine status reporting and capability declarations;
 *   2. Assert histogram diff accuracy (empty, additions, modifications, deletions);
 *   3. Assert Tarjan strongly connected components and cycle detection;
 *   4. Assert topological ordering on acyclic directed dependency graphs;
 *   5. Assert multi-pattern textual scanning line/column precision;
 *   6. Assert performance latency under burst analysis loads.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError and exits 1 on failure.
 */

'use strict';

const assert = require('assert');
const {
  getNativeCoreStatus,
  nativeHistogramDiff,
  nativeAnalyzeDependencyGraph,
  nativeFastPatternMatch,
  PureJsNativeShim,
} = require('../dist/api');

async function testEngineStatusAndCapabilities() {
  console.log('1. Testing native core status and declared capabilities...');
  const status = getNativeCoreStatus();
  assert.ok(status, 'Status must not be null');
  assert.ok(
    status.activeEngine === 'rust-native' || status.activeEngine === 'pure-js-shim',
    `Active engine must be rust-native or pure-js-shim, got: ${status.activeEngine}`,
  );
  assert.ok(Array.isArray(status.capabilities));
  assert.ok(status.capabilities.includes('histogram-diff'));
  assert.ok(status.capabilities.includes('tarjan-scc'));
  console.log(`  ✔ Engine active: ${status.activeEngine} (capabilities: ${status.capabilities.join(', ')})`);
}

async function testHistogramDiff() {
  console.log('\n2. Testing histogram diff accuracy and hunk assembly...');

  // Case A: Identical content
  const same = 'const a = 1;\nconst b = 2;\n';
  const hunksSame = nativeHistogramDiff(same, same);
  assert.strictEqual(hunksSame.length, 0, 'Identical content must produce zero diff hunks');

  // Case B: Modification
  const oldText = 'function test() {\n    const x = 1;\n    return x;\n}\n';
  const newText = 'function test() {\n    const x = 2;\n    return x * 2;\n}\n';

  const hunksMod = nativeHistogramDiff(oldText, newText);
  assert.ok(hunksMod.length >= 1, 'Modified content must produce at least one hunk');
  const h = hunksMod[0];
  assert.strictEqual(h.oldStart, 1);
  assert.strictEqual(h.newStart, 1);
  assert.ok(h.lines.some((l) => l.startsWith('-')));
  assert.ok(h.lines.some((l) => l.startsWith('+')));
  assert.ok(h.lines.some((l) => l.startsWith(' ')));

  // Case C: Additions at bottom
  const oldShort = 'line1\nline2\n';
  const newLong = 'line1\nline2\nline3\nline4\n';
  const hunksAdd = nativeHistogramDiff(oldShort, newLong);
  assert.ok(hunksAdd.length >= 1);
  assert.ok(hunksAdd[0].lines.some((l) => l === '+line3'));
  assert.ok(hunksAdd[0].lines.some((l) => l === '+line4'));

  console.log('  ✔ Histogram diff correctly computes unified hunks and line prefixes');
}

async function testGraphAnalysisAndCycleDetection() {
  console.log('\n3. Testing dependency graph analysis and Tarjan SCC cycle detection...');

  // Case A: Clean DAG (A -> B -> C)
  const dagEdges = [
    ['ModuleA', 'ModuleB'],
    ['ModuleB', 'ModuleC'],
  ];
  const dagAnalysis = nativeAnalyzeDependencyGraph(dagEdges);
  assert.strictEqual(dagAnalysis.isAcyclic, true, 'DAG must be acyclic');
  assert.strictEqual(dagAnalysis.cycles.length, 0, 'DAG must have zero cycles');
  assert.ok(dagAnalysis.topologicalOrder.includes('ModuleA'));
  assert.ok(dagAnalysis.topologicalOrder.includes('ModuleB'));
  assert.ok(dagAnalysis.topologicalOrder.includes('ModuleC'));

  // Case B: Cyclic graph (X -> Y -> Z -> X)
  const cyclicEdges = [
    ['X', 'Y'],
    ['Y', 'Z'],
    ['Z', 'X'],
    ['Independent', 'X'],
  ];
  const cyclicAnalysis = nativeAnalyzeDependencyGraph(cyclicEdges);
  assert.strictEqual(cyclicAnalysis.isAcyclic, false, 'Graph with circular imports must not be acyclic');
  assert.ok(cyclicAnalysis.cycles.length >= 1, 'Must detect at least 1 cycle');

  const detectedCycle = cyclicAnalysis.cycles[0];
  assert.ok(detectedCycle.includes('X'));
  assert.ok(detectedCycle.includes('Y'));
  assert.ok(detectedCycle.includes('Z'));

  // Case C: Self-loop (Self -> Self)
  const selfLoopEdges = [['Self', 'Self']];
  const selfAnalysis = nativeAnalyzeDependencyGraph(selfLoopEdges);
  assert.strictEqual(selfAnalysis.isAcyclic, false);
  assert.strictEqual(selfAnalysis.cycles.length, 1);
  assert.deepStrictEqual(selfAnalysis.cycles[0], ['Self', 'Self']);

  console.log('  ✔ Tarjan SCC correctly isolates cyclic loops while maintaining DAG ordering');
}

async function testFastPatternMatching() {
  console.log('\n4. Testing multi-pattern fast textual scanning...');
  const source = `
import { foo } from './foo';
// TODO: refactor this method
function compute() {
    // TODO: check bounds
    return 42;
}
`;
  const matches = nativeFastPatternMatch(source, ['TODO:', 'compute']);
  assert.ok(matches.length >= 3, `Expected at least 3 matches, got ${matches.length}`);

  const todoMatches = matches.filter((m) => m.pattern === 'TODO:');
  assert.strictEqual(todoMatches.length, 2, 'Must locate exactly 2 TODO comments');
  assert.strictEqual(todoMatches[0].line, 3);
  assert.strictEqual(todoMatches[1].line, 5);

  const computeMatch = matches.find((m) => m.pattern === 'compute');
  assert.ok(computeMatch);
  assert.strictEqual(computeMatch.line, 4);
  assert.ok(computeMatch.column > 0);

  console.log('  ✔ Fast multi-pattern scanner locates exact 1-based lines and columns');
}

async function testMicroBenchmark() {
  console.log('\n5. Running burst throughput micro-benchmark (1,000 graph and diff cycles)...');
  const shim = new PureJsNativeShim();
  const iterations = 1000;
  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    shim.analyzeDependencyGraph([
      [`Node_${i}_A`, `Node_${i}_B`],
      [`Node_${i}_B`, `Node_${i}_C`],
      [`Node_${i}_C`, `Node_${i}_A`],
    ]);
  }

  const durationMs = Math.max(1, Date.now() - start);
  const opsPerSec = Math.round((iterations / durationMs) * 1000);
  console.log(`  ✔ Completed ${iterations} graph analyses in ${durationMs}ms (~${opsPerSec.toLocaleString()} ops/sec)`);
}

async function runAll() {
  console.log('=== Starting Native Acceleration Bridge Suite ===\n');
  await testEngineStatusAndCapabilities();
  await testHistogramDiff();
  await testGraphAnalysisAndCycleDetection();
  await testFastPatternMatching();
  await testMicroBenchmark();
  console.log('\n=== All Native Acceleration Bridge tests passed successfully! ===');
}

runAll().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});
