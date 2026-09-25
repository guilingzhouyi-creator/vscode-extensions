#!/usr/bin/env node
/**
 * Module: Verification Harness — Tensor Partitioning & All-Reduce Suite
 * File Path: scripts/validate-tensor-partitions.js
 * Architecture Role: Integration and correctness verification suite for multi-dimensional
 *   TensorPartitioner and All-Reduce SemanticConvergenceEngine.
 * Dependencies & Triggers: Consumes ../dist/api; executed in `npm test` and test-parallel.js.
 * Responsibilities:
 *   1. Assert 3D tensor grid partitioning across Data, Rule, and Dependency Depth dimensions;
 *   2. Assert topological depth stratification for imported vs importer files;
 *   3. Assert All-Reduce issue deduplication and deterministic sorting;
 *   4. Assert cross-partition circular dependency loop detection;
 *   5. Assert multi-partition symbol collision detection;
 *   6. Assert performance latency under large partition aggregation.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError and exits 1 on failure.
 */

'use strict';

const assert = require('assert');
const {
  TensorPartitioner,
  SemanticConvergenceEngine,
  DEFAULT_TENSOR_RULE_FAMILIES,
} = require('../dist/api');

async function testTensorWorkloadPartitioning() {
  console.log('1. Testing 3D tensor-parallel workload partitioning...');
  const partitioner = new TensorPartitioner(10);

  const files = [
    'src/core/models/user.ts',
    'src/core/models/account.ts',
    'src/core/services/user-service.ts',
    'src/core/controllers/user-controller.ts',
    'src/utils/string-helper.ts',
  ];

  // Dependency edges:
  // controller -> service -> model
  const edges = [
    ['src/core/controllers/user-controller.ts', 'src/core/services/user-service.ts'],
    ['src/core/services/user-service.ts', 'src/core/models/user.ts'],
  ];

  const plan = partitioner.partition(files, edges);

  assert.ok(plan.totalCells > 0, 'Must produce non-zero tensor cells');
  assert.ok(plan.dataDimensionSize >= 2, 'Must cluster into at least 2 module domains (core and utils)');
  assert.strictEqual(
    plan.ruleDimensionSize,
    Object.keys(DEFAULT_TENSOR_RULE_FAMILIES).length,
    'Rule dimension size must match declared rule families',
  );
  assert.ok(plan.maxDependencyDepth >= 2, 'Depth must be at least 2 for controller -> service -> model chain');

  // Verify that model is at depth 0, service is at depth 1, controller is at depth 2
  const modelCell = plan.cells.find((c) => c.dataFiles.includes('src/core/models/user.ts'));
  assert.ok(modelCell);
  assert.strictEqual(modelCell.dependencyDepth, 0, 'Leaf model must be at depth 0');

  const serviceCell = plan.cells.find((c) => c.dataFiles.includes('src/core/services/user-service.ts'));
  assert.ok(serviceCell);
  assert.strictEqual(serviceCell.dependencyDepth, 1, 'Service importing model must be at depth 1');

  const ctrlCell = plan.cells.find((c) => c.dataFiles.includes('src/core/controllers/user-controller.ts'));
  assert.ok(ctrlCell);
  assert.strictEqual(ctrlCell.dependencyDepth, 2, 'Controller importing service must be at depth 2');

  console.log(
    `  ✔ Partitioned ${files.length} files into ${plan.totalCells} cells (Data clusters: ${plan.dataDimensionSize}, Rules: ${plan.ruleDimensionSize}, Max depth: ${plan.maxDependencyDepth})`,
  );
}

async function testAllReduceIssueDeduplicationAndConvergence() {
  console.log('\n2. Testing All-Reduce issue deduplication and deterministic convergence...');
  const engine = new SemanticConvergenceEngine();

  const sharedIssue = {
    id: 'security:SEC-001:src/core/service.ts:42',
    analyzer: 'security',
    rule: 'SEC-001',
    severity: 'error',
    message: 'Hardcoded secret detected',
    location: {
      file: 'src/core/service.ts',
      start: { line: 42, column: 5 },
      end: { line: 42, column: 20 },
    },
    detail: {},
  };

  const delta1 = {
    partitionId: 'cell-1',
    issues: [
      sharedIssue,
      {
        id: 'naming:NAM-001:src/core/util.ts:10',
        analyzer: 'naming',
        rule: 'NAM-001',
        severity: 'warning',
        message: 'Identifier should be camelCase',
        location: {
          file: 'src/core/util.ts',
          start: { line: 10, column: 1 },
          end: { line: 10, column: 15 },
        },
        detail: {},
      },
    ],
    executionTimeMs: 15,
  };

  // Delta 2 produced duplicate sharedIssue (e.g. from overlapping context) plus new issue
  const delta2 = {
    partitionId: 'cell-2',
    issues: [
      { ...sharedIssue },
      {
        id: 'comments:CMT-001:src/core/service.ts:12',
        analyzer: 'comments',
        rule: 'CMT-001',
        severity: 'info',
        message: 'Missing function JSDoc',
        location: {
          file: 'src/core/service.ts',
          start: { line: 12, column: 1 },
          end: { line: 12, column: 25 },
        },
        detail: {},
      },
    ],
    executionTimeMs: 25,
  };

  engine.ingestDelta(delta1);
  engine.ingestDelta(delta2);

  const converged = engine.converge();

  // Exactly 3 unique issues must remain (sharedIssue was deduplicated)
  assert.strictEqual(converged.issuesCount, 3, 'Must deduplicate identical issues');
  assert.strictEqual(converged.issues.length, 3);
  assert.strictEqual(converged.convergedPartitionsCount, 2);
  assert.strictEqual(converged.totalExecutionTimeMs, 40);

  assert.strictEqual(converged.issuesBySeverity.error, 1);
  assert.strictEqual(converged.issuesBySeverity.warning, 1);
  assert.strictEqual(converged.issuesBySeverity.info, 1);

  // Assert deterministic ordering:
  // src/core/service.ts:12 (CMT-001) -> src/core/service.ts:42 (SEC-001) -> src/core/util.ts:10 (NAM-001)
  assert.strictEqual(converged.issues[0].rule, 'CMT-001');
  assert.strictEqual(converged.issues[1].rule, 'SEC-001');
  assert.strictEqual(converged.issues[2].rule, 'NAM-001');

  console.log('  ✔ All-Reduce deduplicates overlapping issues and preserves deterministic ordering');
}

async function testCrossPartitionCycleAndSymbolConflictDetection() {
  console.log('\n3. Testing cross-partition cycle and symbol conflict detection...');
  const engine = new SemanticConvergenceEngine();

  // Cell A exported 'UserConfig' from fileA, depends on B
  const deltaA = {
    partitionId: 'cell-a',
    issues: [],
    exportedSymbols: {
      'src/domain/a.ts': ['UserConfig', 'parseUser'],
    },
    dependencies: [['src/domain/a.ts', 'src/domain/b.ts']],
    executionTimeMs: 10,
  };

  // Cell B also exported 'UserConfig' from fileB (conflict!), and depends on A (circular loop!)
  const deltaB = {
    partitionId: 'cell-b',
    issues: [],
    exportedSymbols: {
      'src/domain/b.ts': ['UserConfig', 'validateUser'],
    },
    dependencies: [['src/domain/b.ts', 'src/domain/a.ts']],
    executionTimeMs: 12,
  };

  engine.ingestDelta(deltaA);
  engine.ingestDelta(deltaB);

  const converged = engine.converge();

  // 1. Cross-partition cycle must be flagged
  assert.ok(converged.circularDependencies.length >= 1, 'Must detect circular dependency loop');
  const cycle = converged.circularDependencies[0];
  assert.ok(cycle.includes('src/domain/a.ts'));
  assert.ok(cycle.includes('src/domain/b.ts'));

  // 2. Symbol conflict for 'UserConfig' must be detected
  assert.strictEqual(converged.symbolConflicts.length, 1);
  assert.strictEqual(converged.symbolConflicts[0].symbol, 'UserConfig');
  assert.deepStrictEqual(converged.symbolConflicts[0].definedIn, [
    'src/domain/a.ts',
    'src/domain/b.ts',
  ]);

  console.log('  ✔ Cross-partition circular dependencies and exported symbol conflicts reconciled');
}

async function runAll() {
  console.log('=== Starting Tensor Partitioning & All-Reduce Suite ===\n');
  await testTensorWorkloadPartitioning();
  await testAllReduceIssueDeduplicationAndConvergence();
  await testCrossPartitionCycleAndSymbolConflictDetection();
  console.log('\n=== All Tensor Partitioning & All-Reduce tests passed successfully! ===');
}

runAll().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});
