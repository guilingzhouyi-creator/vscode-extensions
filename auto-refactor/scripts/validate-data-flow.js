#!/usr/bin/env node
/**
 * Module: Verification Harness — Data Flow & Lifecycle Metrics
 * File Path: scripts/validate-data-flow.js
 * Architecture Role: Integration suite validating the 7-stage DataFlowGraph, unbounded memory
 *   growth detection (O(t)/O(n) collection leaks), and the incremental coupling gate.
 * Dependencies & Triggers: `npm run validate-data-flow` (part of `npm test`); imports
 *   ../dist/api and drives `templates/consumer/run.mjs`.
 * Responsibilities: Assert 7-stage lifecycle pipeline traversal; assert O(t) timer and O(n) loop
 *   unbounded growth detection against 8 positive, boundary and NEGATIVE fixtures (prose, names,
 *   string braces, same-line callbacks, class fields); assert lexical metric semantics for LOC,
 *   complexity and coupling scope; assert consumer runner rejection of "deleted 500 lines but
 *   coupling increased" with exit code 1.
 * Exit Semantics & Design Rationale: Exits 0 on clean pass; throws and exits 1 on any assertion
 *   failure or contract regression so CI gates strictly block regressions.
 */
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'templates', 'consumer', 'run.mjs');

const {
  DataFlowGraph,
  detectUnboundedGrowth,
  computeEffectiveLoc,
  computeCoupling,
  computeComplexityProxy,
  computeIncrementalMetrics,
  countDuplicateLines,
} = require('../dist/api');

/** Test 1: Full 7-stage DataFlowGraph lifecycle construction and pipeline traversal. */
function testDataFlowGraphLifecycle() {
  console.log('[1/5] Testing DataFlowGraph 7-stage lifecycle pipeline...');
  const graph = new DataFlowGraph();

  const stages = [
    { id: 'n1', name: 'HttpRequestInput', stage: 'Source', lifetime: 'ephemeral' },
    { id: 'n2', name: 'validateRequest', stage: 'Validation', lifetime: 'scoped' },
    { id: 'n3', name: 'normalizePayload', stage: 'Transformation', lifetime: 'scoped' },
    { id: 'n4', name: 'saveRecord', stage: 'Storage', lifetime: 'persistent' },
    { id: 'n5', name: 'eventBus.emit', stage: 'Bus', lifetime: 'scoped' },
    { id: 'n6', name: 'auditHandler', stage: 'Consumer', lifetime: 'scoped' },
    { id: 'n7', name: 'externalLog', stage: 'SideEffect', lifetime: 'ephemeral' },
  ];

  for (const s of stages) {
    graph.addNode({
      id: s.id,
      name: s.name,
      filePath: 'src/pipeline/order.ts',
      stage: s.stage,
      ownership: 'order.domain',
      lifetime: s.lifetime,
    });
  }

  graph.addEdge({ from: 'n1', to: 'n2', transferType: 'direct' });
  graph.addEdge({ from: 'n2', to: 'n3', transferType: 'direct' });
  graph.addEdge({ from: 'n3', to: 'n4', transferType: 'storage' });
  graph.addEdge({ from: 'n4', to: 'n5', transferType: 'event' });
  graph.addEdge({ from: 'n5', to: 'n6', transferType: 'async' });
  graph.addEdge({ from: 'n6', to: 'n7', transferType: 'direct' });

  const traversedStages = graph.traceLifecycle('n1');
  assert.deepStrictEqual(
    traversedStages,
    ['Source', 'Validation', 'Transformation', 'Storage', 'Bus', 'Consumer', 'SideEffect'],
    'Lifecycle traversal must visit all 7 canonical stages in order',
  );

  const pipelines = graph.findPipelines();
  assert.strictEqual(pipelines.length, 1, 'Must identify 1 end-to-end pipeline');
  assert.strictEqual(pipelines[0].startNode.id, 'n1');
  assert.strictEqual(pipelines[0].endNode.id, 'n7');

  const stats = graph.stats();
  assert.strictEqual(stats.totalNodes, 7);
  assert.strictEqual(stats.totalEdges, 6);
  assert.strictEqual(stats.stageDistribution.Source, 1);
  assert.strictEqual(stats.stageDistribution.SideEffect, 1);
  console.log('  [PASS] 7-stage DataFlowGraph lifecycle pipeline verified');
}

/** Test 2: Unbounded growth detection for O(t) timer and O(n) loop leaks. */
function testUnboundedGrowthDetection() {
  console.log('[2/5] Testing O(t) and O(n) unbounded growth detection (PRF-LEAK-001)...');

  // Fixture A: O(t) time-dependent leak in setInterval
  const timerLeakCode = [
    'const eventHistory = [];',
    'setInterval(() => {',
    '  const event = fetchEvent();',
    '  eventHistory.push(event);',
    '}, 1000);',
  ].join('\n');

  const timerIssues = detectUnboundedGrowth('src/timer.ts', timerLeakCode);
  assert.strictEqual(timerIssues.length, 1, 'Must detect 1 timer leak issue');
  assert.strictEqual(timerIssues[0].rule, 'PRF-LEAK-001');
  assert.strictEqual(timerIssues[0].detail.complexity, 'O(t)');
  assert.strictEqual(timerIssues[0].evidence?.requiresRuntime, true);
  assert.ok(timerIssues[0].message.includes('O(t) unbounded memory growth'));

  // Fixture B: O(n) input-dependent leak in loop
  const loopLeakCode = [
    'const entityCache = new Map();',
    'function ingestStream(items) {',
    '  for (const item of items) {',
    '    entityCache.set(item.id, item);',
    '  }',
    '}',
  ].join('\n');

  const loopIssues = detectUnboundedGrowth('src/loop.ts', loopLeakCode);
  assert.strictEqual(loopIssues.length, 1, 'Must detect 1 loop leak issue');
  assert.strictEqual(loopIssues[0].rule, 'PRF-LEAK-001');
  assert.strictEqual(loopIssues[0].detail.complexity, 'O(n)');
  assert.strictEqual(loopIssues[0].evidence?.requiresRuntime, true);
  assert.ok(loopIssues[0].message.includes('O(n) unbounded memory growth'));

  // Fixture C: bounded collection — the bound is real; the NAME must be irrelevant.
  const boundedCode = [
    'const samples = [];',
    'setInterval(() => {',
    '  samples.push(Math.random());',
    '  if (samples.length > 100) {',
    '    samples.shift();',
    '  }',
    '}, 1000);',
  ].join('\n');

  const boundedIssues = detectUnboundedGrowth('src/bounded.ts', boundedCode);
  assert.strictEqual(boundedIssues.length, 0, 'Explicitly bounded collection must stay silent');

  // Fixture D: a name containing `ringBuffer` grants NO exemption — only real bound evidence does.
  const namedButUnbounded = [
    'const ringBuffer = [];',
    'setInterval(() => {',
    '  ringBuffer.push(1);',
    '}, 1000);',
  ].join('\n');
  assert.strictEqual(
    detectUnboundedGrowth('src/named.ts', namedButUnbounded).length,
    1,
    'A collection must not be exempted by its NAME alone',
  );

  // Fixture E: prose must not silence the rule (a file-wide keyword scan used to do exactly that).
  const proseSilenced = [
    'const cache = [];',
    'setInterval(() => {',
    '  cache.push(1);',
    '}, 1000);',
    '// TODO: consider a limit later',
  ].join('\n');
  assert.strictEqual(
    detectUnboundedGrowth('src/prose.ts', proseSilenced).length,
    1,
    'An unrelated comment mentioning a "limit" must not exempt the collection',
  );

  // Fixture F: a brace inside a string literal must not close the timer scope early.
  const braceInString = [
    'const items = [];',
    'setInterval(() => {',
    "  console.log('}');",
    '  items.push(1);',
    '}, 10);',
  ].join('\n');
  assert.strictEqual(
    detectUnboundedGrowth('src/brace.ts', braceInString).length,
    1,
    'A `}` inside a string literal must not close the timer scope',
  );

  // Fixture G: a same-line callback must not leave its scope stuck for the following lines.
  // The delay is a named constant so this harness does not itself trip GOV-PRF-003.
  const oneLine = [
    'const TICK_MS = 250;',
    'const a = [];',
    'setInterval(() => { a.push(1); }, TICK_MS);',
    'a.push(2);',
  ].join('\n');
  const oneLineIssues = detectUnboundedGrowth('src/oneline.ts', oneLine);
  assert.strictEqual(oneLineIssues.length, 1, 'A same-line callback must not leak its scope');
  assert.strictEqual(oneLineIssues[0].location.start.line, 3, 'The finding must be the timer one');

  // Fixture H: class-field buffer accumulated in a loop (the most common real shape).
  const classField = [
    'class Cache {',
    '  private entries: string[] = [];',
    '  ingest(items: string[]): void {',
    '    for (const item of items) {',
    '      this.entries.push(item);',
    '    }',
    '  }',
    '}',
  ].join('\n');
  assert.strictEqual(
    detectUnboundedGrowth('src/field.ts', classField).length,
    1,
    'A class-field collection growing with input must be reported',
  );

  console.log('  [PASS] 8 positive/boundary/negative fixtures all match their expectation');
}

/** Test 3: Incremental coupling metrics and rejection of "deleted lines but coupling increased". */
function testIncrementalCouplingGate() {
  console.log('[3/5] Testing incremental coupling gate ("deleted 500 lines but coupling up")...');

  // Construct a 550-line file with only 2 EXTERNAL dependencies
  const oldLines = [
    "import { HelperA } from '@acme/helpers-a';",
    "import { HelperB } from '@acme/helpers-b';",
    'export class MonolithicWorker {',
  ];
  for (let i = 0; i < 530; i++) {
    oldLines.push(`  public step${i}(): number { return ${i} * 2; }`);
  }
  oldLines.push('}');
  const oldContent = oldLines.join('\n');

  // Construct a 40-line refactored file with 7 EXTERNAL dependencies (high coupling)
  const newContent = [
    "import { HelperA } from '@acme/helpers-a';",
    "import { HelperB } from '@acme/helpers-b';",
    "import { SubModuleC } from '@acme/modules-c';",
    "import { ExternalServiceD } from '@acme/services-d';",
    "import { EventBusE } from '@acme/events-e';",
    "import { StorageAdapterF } from '@acme/storage-f';",
    "import { ConfigG } from '@acme/config-g';",
    'export class RefactoredWorker {',
    '  public execute(): void {',
    '    ExternalServiceD.call(ConfigG.get());',
    '    EventBusE.emit(SubModuleC.process());',
    '  }',
    '}',
  ].join('\n');

  const metrics = computeIncrementalMetrics(oldContent, newContent);
  assert.ok(
    metrics.effectiveLocDelta < -500,
    `effectiveLocDelta should be < -500, got ${metrics.effectiveLocDelta}`,
  );
  assert.ok(metrics.couplingDelta > 0, `couplingDelta should be > 0, got ${metrics.couplingDelta}`);
  assert.strictEqual(metrics.verdict, 'FAILED', 'Must reject when lines deleted but coupling rose');
  assert.ok(
    metrics.rejectionRationale?.includes('Anti-pattern rejected'),
    `Rationale must explain rejection: ${metrics.rejectionRationale}`,
  );
  assert.ok(
    metrics.rejectionRationale?.includes('maintainability invariant'),
    'Rationale must cite maintainability invariant',
  );

  // Clean refactor: lines decreased AND external coupling decreased
  const cleanRefactor = [
    "import { HelperA } from '@acme/helpers-a';",
    'export class CleanWorker {',
    '  public run(): number { return 42; }',
    '}',
  ].join('\n');
  const cleanMetrics = computeIncrementalMetrics(oldContent, cleanRefactor);
  assert.strictEqual(cleanMetrics.verdict, 'PASSED', 'Clean refactor must pass');

  // A LOCAL extraction must not read as increased coupling: relative specifiers are internal.
  const localExtraction = [
    "import { HelperA } from '@acme/helpers-a';",
    "import { HelperB } from '@acme/helpers-b';",
    "import { Extracted } from './extracted-locally';",
    'export class ThinWorker {',
    '  public run(): number { return Extracted.value(); }',
    '}',
  ].join('\n');
  const localMetrics = computeIncrementalMetrics(oldContent, localExtraction);
  assert.strictEqual(localMetrics.couplingDelta, 0, 'A relative import adds no external coupling');
  assert.strictEqual(
    localMetrics.verdict,
    'PASSED',
    'Extracting a LOCAL module must not be rejected as increased coupling',
  );

  console.log('  [PASS] Anti-pattern rejected; local extraction correctly accepted');
}

/** Test 5: Lexical metric semantics — prose must not distort LOC, complexity or coupling. */
function testLexicalMetricSemantics() {
  console.log('[5/5] Testing lexical metric semantics (comments, strings, coupling scope)...');

  // Code sharing a line with a block comment must still count.
  const sharedLine = ['/* note */ const y = 2;', 'const z = 3;', ''].join('\n');
  assert.strictEqual(
    computeEffectiveLoc(sharedLine),
    2,
    'code on a comment-shared line must count',
  );

  // Whole-line comments are not code, in either comment family.
  assert.strictEqual(
    computeEffectiveLoc('// note\n# note\n\n'),
    0,
    'comment-only lines must not count as code',
  );

  // Complexity must ignore branches inside comments and string literals.
  assert.strictEqual(
    computeComplexityProxy('// if (a) { } && || ??\nconst a = 1;'),
    1,
    'branches inside a comment must not raise complexity',
  );
  assert.strictEqual(
    computeComplexityProxy('const s = "if && || ? :";'),
    1,
    'branches inside a string literal must not raise complexity',
  );

  // Coupling counts EXTERNAL modules only.
  assert.strictEqual(computeCoupling("import { X } from './local';"), 0);
  assert.strictEqual(computeCoupling("import { X } from '../up';"), 0);
  assert.strictEqual(computeCoupling("import fs from 'node:fs';"), 1);

  // A specifier inside a comment or a string literal is not a dependency, and the per-line scan
  // cannot bridge a statement boundary.
  assert.strictEqual(computeCoupling("// from 'ghost-pkg'"), 0);
  assert.strictEqual(computeCoupling('const s = "import x from \'ghost-pkg\';";'), 0);
  assert.strictEqual(computeCoupling("import { X } from 'real-pkg';"), 1);

  // Duplication rides the shared line-hash substrate, so repeats are visible without re-parsing.
  const dupBase = ['function a() { return 1; }', 'function b() { return 2; }', ''].join('\n');
  const dupAdded = [
    'function a() { return 1; }',
    'function b() { return 2; }',
    'function c() { return 1; }',
    'function c() { return 1; }',
    '',
  ].join('\n');
  assert.strictEqual(countDuplicateLines(dupBase), 0, 'no repeated line means no duplication');
  assert.strictEqual(countDuplicateLines(dupAdded), 1, 'the repeated line must be counted once');

  const relaxedDup = computeIncrementalMetrics(dupBase, dupAdded);
  assert.strictEqual(relaxedDup.duplicationDelta, 1, 'duplicationDelta must track the new repeat');
  assert.ok(
    relaxedDup.maintainabilityDelta < 0,
    'added duplication must lower the maintainability delta',
  );
  assert.strictEqual(
    relaxedDup.verdict,
    'PASSED',
    'without a declared floor, duplication alone must not re-gate an existing consumer',
  );

  const flooredDup = computeIncrementalMetrics(dupBase, dupAdded, { minMaintainabilityDelta: 0 });
  assert.strictEqual(flooredDup.verdict, 'FAILED', 'a declared maintainability floor is enforced');
  assert.ok(
    flooredDup.rejectionRationale?.includes('declared floor'),
    `Floor rejection must explain itself: ${flooredDup.rejectionRationale}`,
  );

  console.log('  [PASS] LOC/complexity ignore prose; coupling counts external modules only');
}

/** Test 4: End-to-end integration with templates/consumer/run.mjs --coupling-gate. */
function testConsumerRunnerCouplingGate() {
  console.log('[4/5] Testing templates/consumer/run.mjs --coupling-gate execution...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coupling-gate-test-'));

  try {
    const oldFile = path.join(tmpDir, 'old-impl.ts');
    const newFile = path.join(tmpDir, 'new-impl.ts');
    const cleanFile = path.join(tmpDir, 'clean-impl.ts');

    // 530 lines with 2 imports
    const oldLines = ["import { A } from 'pkg-a';", "import { B } from 'pkg-b';"];
    for (let i = 0; i < 520; i++) oldLines.push(`const v${i} = ${i};`);
    fs.writeFileSync(oldFile, oldLines.join('\n'));

    // 25 lines with 6 EXTERNAL dependencies
    const newLines = [
      "import { A } from 'pkg-a';",
      "import { B } from 'pkg-b';",
      "import { C } from 'pkg-c';",
      "import { D } from 'pkg-d';",
      "import { E } from 'pkg-e';",
      "import { F } from 'pkg-f';",
      'export function run(): void {}',
    ];
    fs.writeFileSync(newFile, newLines.join('\n'));

    // 20 lines with 1 external dependency
    const cleanLines = ["import { A } from 'pkg-a';", 'export function run(): void {}'];
    fs.writeFileSync(cleanFile, cleanLines.join('\n'));

    // Run 1: Should FAIL with exit code 1
    const failResult = spawnSync(
      process.execPath,
      [
        RUNNER,
        '--engine',
        ROOT,
        '--root',
        tmpDir,
        '--coupling-gate',
        '--compare-before',
        oldFile,
        '--compare-after',
        newFile,
      ],
      { encoding: 'utf8' },
    );

    assert.strictEqual(
      failResult.status,
      1,
      `Consumer runner must exit 1 on coupling gate violation, got ${failResult.status}`,
    );
    assert.ok(
      failResult.stderr.includes('coupling-gate FAILED'),
      `stderr must report failure: ${failResult.stderr}`,
    );
    assert.ok(
      failResult.stderr.includes('Anti-pattern rejected'),
      `stderr must include rejection rationale: ${failResult.stderr}`,
    );

    // Run 2: Should PASS with exit code 0
    const passResult = spawnSync(
      process.execPath,
      [
        RUNNER,
        '--engine',
        ROOT,
        '--root',
        tmpDir,
        '--coupling-gate',
        '--compare-before',
        oldFile,
        '--compare-after',
        cleanFile,
      ],
      { encoding: 'utf8' },
    );

    assert.strictEqual(
      passResult.status,
      0,
      `Consumer runner must exit 0 on clean refactor, got ${passResult.status}`,
    );
    assert.ok(
      passResult.stdout.includes('coupling-gate PASSED'),
      `stdout must report pass: ${passResult.stdout}`,
    );

    console.log('  [PASS] Consumer runner --coupling-gate CLI contract verified');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main() {
  console.log('\n=== Batch B7: DataFlow Lifecycle & Incremental Coupling Gate Validation ===');
  testDataFlowGraphLifecycle();
  testUnboundedGrowthDetection();
  testIncrementalCouplingGate();
  testConsumerRunnerCouplingGate();
  testLexicalMetricSemantics();
  console.log('\nAll Batch B7 assertions PASSED successfully.\n');
}

main();
