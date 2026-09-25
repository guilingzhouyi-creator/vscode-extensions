#!/usr/bin/env node
/**
 * Module: Verification Harness — Ring Buffer Bus Suite
 * File Path: scripts/validate-ring-buffer-bus.js
 * Architecture Role: Integration and performance validation suite for the high-throughput
 *   RingBufferBus circular transport queue.
 * Dependencies & Triggers: Consumes ../dist/api; executed in `npm test` and test-parallel.js.
 * Responsibilities:
 *   1. Assert capacity power-of-two normalization and initial state;
 *   2. Assert FIFO ordering and continuous wrap-around cursor invariance;
 *   3. Assert overflow handling under 'reject' and 'drop_oldest' policies;
 *   4. Assert allocation-free bulk drainage via drainInto();
 *   5. Assert runtime telemetry accuracy (high-water mark, drops, rejections);
 *   6. Assert high-throughput execution under rapid push/pop stress cycles.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError and exits 1 on failure.
 */

'use strict';

const assert = require('assert');
const { RingBufferBus } = require('../dist/api');

async function testCapacityAndFifoOrdering() {
  console.log('1. Testing capacity normalization and basic FIFO ordering...');
  // Request capacity 20 -> should normalize to 32 (next power of 2)
  const bus = new RingBufferBus(20, 'reject');
  assert.strictEqual(bus.capacity(), 32, 'Capacity must be normalized to power of two');
  assert.strictEqual(bus.size(), 0);
  assert.ok(bus.isEmpty());
  assert.strictEqual(bus.isFull(), false);

  for (let i = 0; i < 10; i++) {
    const accepted = bus.push(i);
    assert.strictEqual(accepted, true, `Item ${i} must be accepted`);
  }

  assert.strictEqual(bus.size(), 10);
  assert.strictEqual(bus.peek(), 0, 'Peek must inspect oldest element without removing');
  assert.strictEqual(bus.size(), 10, 'Peek must not alter size');

  for (let i = 0; i < 10; i++) {
    const val = bus.pop();
    assert.strictEqual(val, i, `Popped value must match FIFO sequence index ${i}`);
  }

  assert.ok(bus.isEmpty());
  assert.strictEqual(bus.pop(), undefined, 'Popping empty buffer must return undefined');
  console.log('  ✔ FIFO ordering and capacity normalization confirmed');
}

async function testContinuousWrapAround() {
  console.log('\n2. Testing continuous wrap-around across circular slots...');
  const capacity = 16;
  const bus = new RingBufferBus(capacity, 'reject');

  // Push 10, pop 10, repeated 100 times to continuously rotate head and tail indices
  for (let cycle = 0; cycle < 100; cycle++) {
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(bus.push(cycle * 10 + i), true);
    }
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(bus.pop(), cycle * 10 + i);
    }
  }

  assert.ok(bus.isEmpty());
  console.log('  ✔ Continuous wrap-around cursor rotation invariant verified');
}

async function testOverflowPolicies() {
  console.log('\n3. Testing overflow handling (reject vs drop_oldest)...');

  // Policy A: 'reject'
  const rejectBus = new RingBufferBus(16, 'reject');
  for (let i = 0; i < 16; i++) {
    assert.strictEqual(rejectBus.push(i), true);
  }
  assert.ok(rejectBus.isFull());
  // 17th item must be rejected
  assert.strictEqual(rejectBus.push(999), false);
  const rejectMetrics = rejectBus.getMetrics();
  assert.strictEqual(rejectMetrics.totalRejected, 1);
  assert.strictEqual(rejectMetrics.currentSize, 16);

  // Policy B: 'drop_oldest'
  const dropBus = new RingBufferBus(16, 'drop_oldest');
  for (let i = 0; i < 16; i++) {
    assert.strictEqual(dropBus.push(i), true);
  }
  assert.ok(dropBus.isFull());

  // Push 2 more items: items 0 and 1 should be dropped
  dropBus.push(16);
  dropBus.push(17);

  const dropMetrics = dropBus.getMetrics();
  assert.strictEqual(dropMetrics.totalDropped, 2);
  assert.strictEqual(dropMetrics.currentSize, 16);
  // Oldest should now be 2
  assert.strictEqual(dropBus.pop(), 2, 'Oldest item must be 2 after dropping 0 and 1');
  console.log('  ✔ Overflow policies (reject & drop_oldest) operate as specified');
}

async function testDrainageAndBulkTransfer() {
  console.log('\n4. Testing drainInto and drainAll bulk transfers...');
  const bus = new RingBufferBus(64, 'reject');
  for (let i = 0; i < 30; i++) {
    bus.push(i);
  }

  // Pre-allocated array to avoid allocations
  const sink = [];
  const drained = bus.drainInto(sink, 10);
  assert.strictEqual(drained, 10);
  assert.strictEqual(sink.length, 10);
  assert.strictEqual(sink[0], 0);
  assert.strictEqual(sink[9], 9);
  assert.strictEqual(bus.size(), 20);

  // Drain remaining 20
  const remaining = bus.drainAll();
  assert.strictEqual(remaining.length, 20);
  assert.strictEqual(remaining[0], 10);
  assert.strictEqual(remaining[19], 29);
  assert.ok(bus.isEmpty());
  console.log('  ✔ Bulk drainage transfers data without slot leaks');
}

async function testHighThroughputStress() {
  console.log('\n5. Running high-throughput stress cycle (50,000 operations)...');
  const bus = new RingBufferBus(512, 'drop_oldest');
  const iterations = 50_000;
  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    bus.push(i);
    if ((i & 1) === 0) {
      bus.pop();
    }
  }

  const durationMs = Math.max(1, Date.now() - start);
  const opsPerSec = Math.round((iterations / durationMs) * 1000);
  const metrics = bus.getMetrics();

  assert.strictEqual(metrics.totalPushed, iterations);
  assert.ok(metrics.highWaterMark <= 512);

  console.log(
    `  ✔ Processed ${iterations} operations in ${durationMs}ms (~${opsPerSec.toLocaleString()} ops/sec)`,
  );
}

async function runAll() {
  console.log('=== Starting Ring Buffer Bus Verification Suite ===\n');
  await testCapacityAndFifoOrdering();
  await testContinuousWrapAround();
  await testOverflowPolicies();
  await testDrainageAndBulkTransfer();
  await testHighThroughputStress();
  console.log('\n=== All Ring Buffer Bus tests passed successfully! ===');
}

runAll().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});
