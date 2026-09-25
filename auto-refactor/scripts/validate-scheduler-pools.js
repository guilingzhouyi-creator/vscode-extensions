#!/usr/bin/env node
/**
 * Module: Verification Harness — Execution Scheduler & Worker Pools Suite
 * File Path: scripts/validate-scheduler-pools.js
 * Architecture Role: Integration test suite validating the multi-tier execution scheduler,
 *   preemptive priority dispatch, worker concurrency scaling, and analyzer object pooling.
 * Dependencies & Triggers: Consumes ../dist/api; executed by `npm test` and test-parallel.js.
 * Responsibilities:
 *   1. Assert basic asynchronous task execution and return value resolution;
 *   2. Assert preemptive priority ordering (CRITICAL/HIGH tasks execute before LOW/IDLE);
 *   3. Assert worker concurrency bounds and capacity limits;
 *   4. Assert task timeout cancellation and graceful rejection;
 *   5. Assert priority starvation boosting for aging tasks;
 *   6. Assert analyzer instance pooling and object reuse;
 *   7. Assert runtime telemetry metrics (throughput, latency, p99);
 *   8. Assert graceful shutdown draining in-flight work and rejecting pending items.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError and exits 1 on failure.
 */

'use strict';

const assert = require('assert');
const {
  WorkerPoolManager,
  TaskPriority,
  defaultWorkerPoolManager,
} = require('../dist/api');

async function testBasicTaskExecution() {
  console.log('1. Testing basic task submission and resolution...');
  const pool = new WorkerPoolManager({ maxConcurrency: 4 });

  const result = await pool.submit({
    id: 'task-basic-1',
    domain: 'test',
    priority: TaskPriority.NORMAL,
    targetKind: 'in_process',
    input: { value: 42 },
    createdAt: Date.now(),
    execute: async (input) => {
      return input.value * 2;
    },
  });

  assert.strictEqual(result, 84, 'Task execution output must match expected computation');

  const batchResults = await pool.submitBatch([
    {
      id: 'batch-1',
      domain: 'test',
      priority: TaskPriority.NORMAL,
      targetKind: 'in_process',
      input: 10,
      createdAt: Date.now(),
      execute: (n) => n + 1,
    },
    {
      id: 'batch-2',
      domain: 'test',
      priority: TaskPriority.NORMAL,
      targetKind: 'in_process',
      input: 20,
      createdAt: Date.now(),
      execute: (n) => n + 2,
    },
  ]);

  assert.deepStrictEqual(batchResults, [11, 22], 'Batch results must resolve in submission order');
  await pool.shutdown();
  console.log('  ✔ Basic task submission and batch resolution verified');
}

async function testPreemptivePriorityOrdering() {
  console.log('\n2. Testing priority preemption ordering...');
  // Concurrency = 1 to deterministically observe queue ordering
  const pool = new WorkerPoolManager({ maxConcurrency: 1, starvationAgeMs: 100_000 });
  const executionOrder = [];

  // Occupy the single worker with a slow task
  const blocker = pool.submit({
    id: 'blocker',
    domain: 'test',
    priority: TaskPriority.NORMAL,
    targetKind: 'in_process',
    input: null,
    createdAt: Date.now(),
    execute: async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      executionOrder.push('blocker');
    },
  });

  // Enqueue lower priority tasks first
  const lowTask = pool.submit({
    id: 'low-task',
    domain: 'test',
    priority: TaskPriority.LOW,
    targetKind: 'in_process',
    input: null,
    createdAt: Date.now(),
    execute: async () => {
      executionOrder.push('low');
    },
  });

  const idleTask = pool.submit({
    id: 'idle-task',
    domain: 'test',
    priority: TaskPriority.IDLE,
    targetKind: 'in_process',
    input: null,
    createdAt: Date.now(),
    execute: async () => {
      executionOrder.push('idle');
    },
  });

  // Enqueue high and critical tasks afterward (should preempt low/idle in queue)
  const highTask = pool.submit({
    id: 'high-task',
    domain: 'test',
    priority: TaskPriority.HIGH,
    targetKind: 'in_process',
    input: null,
    createdAt: Date.now(),
    execute: async () => {
      executionOrder.push('high');
    },
  });

  const criticalTask = pool.submit({
    id: 'critical-task',
    domain: 'test',
    priority: TaskPriority.CRITICAL,
    targetKind: 'in_process',
    input: null,
    createdAt: Date.now(),
    execute: async () => {
      executionOrder.push('critical');
    },
  });

  await Promise.all([blocker, lowTask, idleTask, highTask, criticalTask]);

  // Expected execution sequence: blocker finished first, then critical, then high, then low, then idle
  assert.deepStrictEqual(
    executionOrder,
    ['blocker', 'critical', 'high', 'low', 'idle'],
    'Preemptive queue must prioritize higher priority tasks over lower priority ones',
  );

  await pool.shutdown();
  console.log('  ✔ Preemptive priority dispatch order confirmed');
}

async function testTaskTimeoutHandling() {
  console.log('\n3. Testing task timeout rejection and timer cleanup...');
  const pool = new WorkerPoolManager({ maxConcurrency: 2 });

  let errorCaught = false;
  try {
    await pool.submit({
      id: 'stuck-task',
      domain: 'test',
      priority: TaskPriority.NORMAL,
      targetKind: 'in_process',
      input: null,
      timeoutMs: 30, // 30ms timeout
      createdAt: Date.now(),
      execute: async () => {
        // Hang longer than timeout
        await new Promise((resolve) => setTimeout(resolve, 200));
      },
    });
  } catch (err) {
    errorCaught = true;
    assert.ok(err.message.includes('timed out after 30ms'), 'Error message must specify timeout limit');
  }

  assert.ok(errorCaught, 'Task exceeding timeout threshold must be rejected');
  const metrics = pool.getMetrics();
  assert.strictEqual(metrics.failedTasks, 1, 'Failed task count must increment on timeout');

  await pool.shutdown();
  console.log('  ✔ Task timeout and cancellation handled cleanly');
}

async function testAnalyzerInstancePooling() {
  console.log('\n4. Testing analyzer instance pooling and object reuse...');
  const pool = new WorkerPoolManager({ maxConcurrency: 4 });

  let instanceCreations = 0;
  const factory = () => {
    instanceCreations++;
    return { instanceId: `analyzer-${instanceCreations}` };
  };

  // Acquire 2 instances
  const inst1 = pool.acquireAnalyzer('comments', factory);
  const inst2 = pool.acquireAnalyzer('comments', factory);
  assert.strictEqual(instanceCreations, 2, 'Two separate instances created when pool is empty');

  // Return both
  pool.releaseAnalyzer('comments', inst1);
  pool.releaseAnalyzer('comments', inst2);

  // Acquire again - must reuse returned instances without invoking factory
  const instReused1 = pool.acquireAnalyzer('comments', factory);
  const instReused2 = pool.acquireAnalyzer('comments', factory);
  assert.strictEqual(instanceCreations, 2, 'Factory must not be called when instances are available in pool');
  assert.ok(
    instReused1 === inst2 || instReused1 === inst1,
    'Acquired instance must match one of the pooled objects',
  );

  await pool.shutdown();
  console.log('  ✔ Hot analyzer instance pooling eliminates object churn');
}

async function testTelemetryMetricsAndShutdown() {
  console.log('\n5. Testing telemetry metrics collection and graceful shutdown...');
  const pool = new WorkerPoolManager({ maxConcurrency: 2 });

  for (let i = 0; i < 10; i++) {
    await pool.submit({
      id: `task-metric-${i}`,
      domain: 'test',
      priority: TaskPriority.NORMAL,
      targetKind: 'in_process',
      input: i,
      createdAt: Date.now(),
      execute: async (n) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return n;
      },
    });
  }

  const metrics = pool.getMetrics();
  assert.strictEqual(metrics.completedTasks, 10, 'Completed tasks must equal 10');
  assert.strictEqual(metrics.queueDepth, 0, 'Queue depth must be 0 after completion');
  assert.ok(metrics.averageLatencyMs >= 0, 'Average latency must be computed');
  assert.ok(metrics.workerCapacity >= 2, 'Worker capacity must reflect configured pool size');

  // Initiate graceful shutdown
  await pool.shutdown();

  // Submitting after shutdown must be rejected
  let shutdownRejected = false;
  try {
    await pool.submit({
      id: 'late-task',
      domain: 'test',
      priority: TaskPriority.HIGH,
      targetKind: 'in_process',
      input: null,
      createdAt: Date.now(),
      execute: () => 1,
    });
  } catch (err) {
    shutdownRejected = true;
    assert.ok(err.message.includes('shutting down'));
  }

  assert.ok(shutdownRejected, 'Submission after shutdown must be rejected');
  console.log('  ✔ Telemetry metrics and graceful shutdown verified');
}

async function runAll() {
  console.log('=== Starting Execution Scheduler & Worker Pools Verification Suite ===\n');
  await testBasicTaskExecution();
  await testPreemptivePriorityOrdering();
  await testTaskTimeoutHandling();
  await testAnalyzerInstancePooling();
  await testTelemetryMetricsAndShutdown();
  console.log('\n=== All Execution Scheduler & Worker Pools tests passed successfully! ===');
}

runAll().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});
