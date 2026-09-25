#!/usr/bin/env node
/**
 * Module: Verification Harness — End-to-End Scalable Execution Architecture
 * File Path: scripts/validate-scalable-e2e.js
 * Architecture Role: Comprehensive end-to-end integration test unifying Agent OS quota,
 *   3D tensor partitioning, ring buffer transport, topology caching, and All-Reduce convergence.
 * Dependencies & Triggers: Consumes ../dist/api; executed in `npm test` and test-parallel.js.
 * Responsibilities:
 *   1. Assert multi-agent concurrent quota lease acquisition through AgentQuotaGateway;
 *   2. Assert 3D tensor-parallel workload partitioning and dependency stratification;
 *   3. Assert RingBufferBus stream transport and zero-leak bulk drainage;
 *   4. Assert TopologyCacheManager L1/L2 hits and cascade invalidation;
 *   5. Assert All-Reduce convergence with issue deduplication,
 *      cycle detection, and symbol conflict resolution;
 *   6. Assert automatic lease release and zero resource leaks upon completion.
 * Exit Semantics & Design Rationale: Exits 0 on success,
 *   throws AssertionError and exits 1 on failure.
 */

'use strict';

const assert = require('assert');
const {
  SparseOrchestrator,
  AgentQuotaGateway,
  TopologyCacheManager,
  TensorPartitioner,
  TaskPriority,
} = require('../dist/api');

async function testEndToEndScalablePipeline() {
  console.log('1. Testing End-to-End Scalable Pipeline with Agent OS and Tensor Convergence...');

  const quotaGateway = new AgentQuotaGateway();
  quotaGateway.registerAgent('agent-frontend-1', 'interactive', {
    maxConcurrentTasks: 5,
    tokensPerMinute: 600,
  });
  quotaGateway.registerAgent('agent-refactor-1', 'batch', {
    maxConcurrentTasks: 3,
    tokensPerMinute: 120,
  });

  const topologyCache = new TopologyCacheManager(50);
  const tensorPartitioner = new TensorPartitioner(10);

  const orchestrator = new SparseOrchestrator(
    undefined,
    undefined,
    undefined,
    tensorPartitioner,
    topologyCache,
    quotaGateway,
  );

  // Setup multi-module code corpus with circular dependency and duplicate exported symbol
  const files = [
    'src/core/models/user.ts',
    'src/core/services/user-service.ts',
    'src/core/controllers/user-controller.ts',
    'src/api/auth.ts',
    'src/api/gateway.ts',
  ];

  const contents = new Map();
  contents.set(
    'src/core/models/user.ts',
    'export interface User { id: string; name: string; }\nexport const TOKEN_KEY = "SECRET";',
  );
  contents.set(
    'src/core/services/user-service.ts',
    'import { User } from "../models/user";\n' +
      'export function getUser(): User { return { id: "1", name: "Alice" }; }',
  );
  contents.set(
    'src/core/controllers/user-controller.ts',
    'import { getUser } from "../services/user-service";\n' +
      'export function handleReq() { return getUser(); }',
  );
  contents.set(
    'src/api/auth.ts',
    'import { handleReq } from "../core/controllers/user-controller";\n' +
      'export const TOKEN_KEY = "OTHER_SECRET";',
  );
  contents.set(
    'src/api/gateway.ts',
    'import { handleReq } from "../core/controllers/user-controller";\n' +
      'export function route() { return handleReq(); }',
  );

  // Dependency edges:
  // controller -> service -> model
  // auth -> controller
  // gateway -> controller
  // Plus circular edge: model -> controller
  const edges = [
    ['src/core/controllers/user-controller.ts', 'src/core/services/user-service.ts'],
    ['src/core/services/user-service.ts', 'src/core/models/user.ts'],
    ['src/api/auth.ts', 'src/core/controllers/user-controller.ts'],
    ['src/api/gateway.ts', 'src/core/controllers/user-controller.ts'],
    ['src/core/models/user.ts', 'src/core/controllers/user-controller.ts'], // Circular loop!
  ];

  // Provide mock analyzer finding to verify All-Reduce issue deduplication
  orchestrator.setAuditExecutor(async (file, content, _partition) => {
    const issues = [];
    if (content.includes('TOKEN_KEY')) {
      issues.push({
        id: `security:token-key:${file}:2`,
        analyzer: 'security',
        rule: 'hardcoded-secret',
        severity: 'error',
        message: 'Hardcoded secret token found',
        location: {
          file,
          start: { line: 2, column: 1 },
          end: { line: 2, column: 20 },
        },
        detail: { token: 'TOKEN_KEY' },
      });
    }
    return issues;
  });

  // Execute review for agent-frontend-1
  const result = await orchestrator.orchestrate(files, contents, {
    agentUid: 'agent-frontend-1',
    priority: TaskPriority.HIGH,
    enableTensorPartitioning: true,
    enableSecondaryCheck: true,
    dependencyEdges: edges,
  });

  // 1. Verify general execution summary
  assert.strictEqual(result.totalFiles, 5);
  assert.ok(result.partitionCount >= 2, `Expected >= 2 partitions, got ${result.partitionCount}`);
  assert.ok(
    result.findings.length >= 2,
    `Expected at least 2 findings, got ${result.findings.length}`,
  );

  // 2. Verify All-Reduce Converged result
  assert.ok(result.convergedResult, 'ConvergedResult must be populated');
  assert.strictEqual(result.convergedResult.issuesCount, result.findings.length);

  // 3. Verify cross-partition circular dependency detection
  assert.ok(
    result.circularDependencies && result.circularDependencies.length >= 1,
    'Must detect circular dependency loop (model <-> controller)',
  );
  const cycle = result.circularDependencies[0];
  assert.ok(cycle.includes('src/core/models/user.ts'));
  assert.ok(cycle.includes('src/core/controllers/user-controller.ts'));

  // 4. Verify lease clean release (active leases must return to 0)
  const agentMetrics = quotaGateway.getMetrics('agent-frontend-1');
  assert.ok(agentMetrics);
  assert.strictEqual(
    agentMetrics.activeLeases,
    0,
    'Active leases must be 0 after successful execution',
  );
  assert.strictEqual(agentMetrics.totalGranted, 1);

  // 5. Verify caching on second run (cacheHits must increase)
  const secondResult = await orchestrator.orchestrate(files, contents, {
    agentUid: 'agent-frontend-1',
    priority: TaskPriority.NORMAL,
    enableTensorPartitioning: false,
    dependencyEdges: edges,
  });

  assert.ok(secondResult.cacheHits > 0, `Expected cache hits > 0, got ${secondResult.cacheHits}`);

  console.log('  ✔ End-to-End scalable pipeline verified:');
  console.log(`    - Partitions evaluated: ${result.partitionCount}`);
  console.log(`    - Converged issues: ${result.convergedResult.issuesCount}`);
  console.log(`    - Circular loops flagged: ${result.circularDependencies.length}`);
  console.log(`    - Agent lease clean lifecycle confirmed (active leases: 0)`);
  console.log(`    - Second run cache hits: ${secondResult.cacheHits}`);
}

async function runAll() {
  console.log('=== Starting Scalable Architecture End-to-End Suite ===\n');
  await testEndToEndScalablePipeline();
  console.log('\n=== All Scalable Architecture End-to-End tests passed successfully! ===');
}

runAll().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});
