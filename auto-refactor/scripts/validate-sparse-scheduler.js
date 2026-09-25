/**
 * Module: Verification Harness — Seven-Stage Sparse Review Scheduler
 * File Path: scripts/validate-sparse-scheduler.js
 * Architecture Role: Verifies dynamic semantic partitioning, workload balancing, context caching,
 *   reviewer cascade event bus, and seven-stage sparse review orchestration.
 * Dependencies & Triggers: Consumes ../dist/api; executed in CI / test-parallel.
 * Responsibilities:
 *   1. Assert defaultDynamicPartitioner groups files by module affinity without rigid slicing;
 *   2. Assert ReviewContextCache stores and retrieves entries by content hash;
 *   3. Assert ReviewEventBus dispatches cascade events across specialized reviewer domains;
 *   4. Assert defaultSparseOrchestrator completes the full 7-stage review cycle with timings.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const {
  defaultDynamicPartitioner,
  ReviewContextCache,
  ReviewEventBus,
  SparseOrchestrator,
} = require('../dist/api');

async function testDynamicPartitioner() {
  console.log('1. Testing DynamicPartitioner module clustering and workload balancing...');

  const mockFiles = [
    'src/core/cache/memory-store.ts',
    'src/core/cache/disk-store.ts',
    'src/core/cache/lru-policy.ts',
    'src/core/ast/parser.ts',
    'src/core/ast/predicates.ts',
    'src/core/ast/projector.ts',
    'src/utils/format.ts',
    'src/utils/logger.ts',
    'src/api.ts',
  ];

  const contents = new Map();
  for (const f of mockFiles) {
    contents.set(f, `// File: ${f}\nexport function doWork() { return 1; }`);
  }

  const partitions = defaultDynamicPartitioner.createPartitions(mockFiles, contents);

  assert.ok(partitions.length >= 3, `Expected at least 3 partitions, got ${partitions.length}`);

  // Partitions should group by directory module affinity
  const cachePart = partitions.find((p) => p.id.includes('core-cache'));
  assert.ok(cachePart, 'Expected a partition for core/cache');
  assert.strictEqual(cachePart.primaryFiles.length, 3);
  assert.ok(cachePart.estimatedWorkload > 0);
  assert.ok(cachePart.activeDomains.length >= 4);

  const astPart = partitions.find((p) => p.id.includes('core-ast'));
  assert.ok(astPart, 'Expected a partition for core/ast');
  assert.strictEqual(astPart.primaryFiles.length, 3);
  assert.strictEqual(astPart.dominantRole, 'algorithm_computation');

  console.log(
    `  ✔ Successfully clustered ${mockFiles.length} files into ${partitions.length} semantic partitions`,
  );
}

async function testReviewContextCache() {
  console.log('\n2. Testing ReviewContextCache fingerprint lookup and LRU retention...');

  const cache = new ReviewContextCache();
  const filePath = 'src/service.ts';
  const hash = 'h123_45';

  const entry = {
    filePath,
    contentHash: hash,
    role: 'business_module',
    density: {
      physicalLines: 10,
      effectiveCodeLines: 8,
      effectiveDensity: 0.8,
      commentRatio: 0.1,
      blankRatio: 0.1,
      dataConfigRatio: 0,
      classificationCounts: {
        EFFECTIVE_CODE: 8,
        COMMENT_LINE: 1,
        BLANK_LINE: 1,
        FORMATTED_WRAP: 0,
        AUTO_GENERATED: 0,
        DATA_DECLARATION: 0,
        CONFIG_DECLARATION: 0,
        TEMPLATE_DSL: 0,
        FRAMEWORK_SCAFFOLD: 0,
      },
      isLowDensityDocumented: false,
    },
    localFindings: [],
    durationMs: 2,
    cachedAt: Date.now(),
  };

  cache.set(entry);

  // Exact hash match -> hit
  const hit = cache.get(filePath, hash);
  assert.ok(hit, 'Should hit cache on identical content hash');
  assert.strictEqual(hit.filePath, filePath);

  // Hash mismatch -> miss
  const miss = cache.get(filePath, 'h999_altered');
  assert.strictEqual(miss, undefined, 'Should miss cache on altered content hash');

  const metrics = cache.getMetrics();
  assert.strictEqual(metrics.hits, 1);
  assert.strictEqual(metrics.misses, 1);
  assert.strictEqual(metrics.hitRatio, 0.5);

  console.log('  ✔ ReviewContextCache accurately tracks hits/misses and fingerprint invalidation');
}

async function testReviewEventBus() {
  console.log('\n3. Testing ReviewEventBus cascade dispatching...');

  const bus = new ReviewEventBus();
  const capturedEvents = [];

  const unsubscribe = bus.subscribe('LOGIC_AND_COMPLEXITY', (evt) => {
    capturedEvents.push(evt);
  });

  bus.dispatch({
    eventId: 'evt-1',
    kind: 'DOC_CODE_CONTRACT_MISMATCH',
    sourceDomain: 'DOCUMENTATION',
    targetDomain: 'LOGIC_AND_COMPLEXITY',
    affectedFiles: ['src/core/cache.ts'],
    reason: 'Comment claims pure utility but function has side effects',
  });

  assert.strictEqual(capturedEvents.length, 1);
  assert.strictEqual(capturedEvents[0].eventId, 'evt-1');
  assert.strictEqual(capturedEvents[0].kind, 'DOC_CODE_CONTRACT_MISMATCH');

  unsubscribe();
  bus.dispatch({
    eventId: 'evt-2',
    kind: 'DOC_CODE_CONTRACT_MISMATCH',
    sourceDomain: 'DOCUMENTATION',
    targetDomain: 'LOGIC_AND_COMPLEXITY',
    affectedFiles: ['src/core/other.ts'],
    reason: 'Another event',
  });

  assert.strictEqual(
    capturedEvents.length,
    1,
    'Unsubscribed listener should not receive second event',
  );
  console.log('  ✔ ReviewEventBus coordinates cross-reviewer domain event dispatching smoothly');
}

async function testSparseOrchestratorEndToEnd() {
  console.log('\n4. Testing SparseOrchestrator seven-stage end-to-end pipeline...');

  const orchestrator = new SparseOrchestrator();
  const fileContents = new Map();

  const files = [
    'src/core/cache.ts',
    'src/core/store.ts',
    'src/utils/string-helper.ts',
    'src/config/limits.ts',
  ];

  fileContents.set(
    'src/core/cache.ts',
    '/** Module: Pure Utility */\nexport function setVal() { global.flag = true; }',
  );
  fileContents.set('src/core/store.ts', 'export function query() { return 42; }');
  fileContents.set(
    'src/utils/string-helper.ts',
    'export function trim(s: string) { return s.trim(); }',
  );
  fileContents.set('src/config/limits.ts', 'export const MAX_RETRY = 5;');

  const result = await orchestrator.orchestrate(files, fileContents, {
    enableSecondaryCheck: true,
  });

  assert.strictEqual(result.totalFiles, 4);
  assert.ok(result.partitionCount >= 2);
  assert.ok(result.stageTimingsMs.structureAnalysis >= 0);
  assert.ok(result.stageTimingsMs.partitioning >= 0);
  assert.ok(result.stageTimingsMs.localAnalysis >= 0);
  assert.ok(result.stageTimingsMs.secondaryCheck >= 0);
  assert.ok(result.stageTimingsMs.globalInvariant >= 0);
  assert.ok(result.stageTimingsMs.scoring >= 0);

  // Sparse savings ratio must be positive
  assert.ok(result.sparseActivationSavingsRatio > 0);

  // Cascade event was triggered by Pure Utility contract mismatch
  assert.ok(result.cascadeEventCount >= 1, 'Contract mismatch should trigger cascade event');
  const cascadeFinding = result.findings.find((f) => f.analyzer === 'cascade-recheck');
  assert.ok(cascadeFinding, 'Expected cascade-recheck finding generated in stage 5');
  assert.strictEqual(cascadeFinding.location.file, 'src/core/cache.ts');

  console.log(`  ✔ Seven-stage orchestration completed across ${result.partitionCount} partitions`);
  console.log(`    - Savings ratio: ${result.sparseActivationSavingsRatio * 100}%`);
  console.log(`    - Cascade events: ${result.cascadeEventCount}`);
  console.log(`    - Total findings: ${result.findings.length}`);
}

async function runAll() {
  console.log('=== Starting Scale-Adaptive Sparse Scheduler Verification Suite ===\n');
  await testDynamicPartitioner();
  await testReviewContextCache();
  await testReviewEventBus();
  await testSparseOrchestratorEndToEnd();
  console.log('\n=== All Sparse Scheduler tests passed successfully! ===');
}

runAll().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});
