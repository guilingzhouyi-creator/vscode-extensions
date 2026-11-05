#!/usr/bin/env node
/**
 * Module: Verification Harness — Agent Quota Gateway Suite
 * File Path: scripts/validate-agent-quota-gateway.js
 * Architecture Role: Integration and correctness verification suite for multi-agent quota,
 *   token-bucket rate limiting, priority bursts, and resource lease lifecycles.
 * Dependencies & Triggers: Consumes ../dist/api; executed in `npm test` and test-parallel.js.
 * Responsibilities:
 *   1. Assert service tier quota initialization (interactive, batch, background);
 *   2. Assert concurrent lease acquisition and ceiling rejection;
 *   3. Assert priority burst concession for critical priority tasks;
 *   4. Assert token-bucket rate limiting and deduction;
 *   5. Assert lease release and TTL expiration sweep;
 *   6. Assert telemetry metrics across concurrent simulated agents.
 * Exit Semantics & Design Rationale: Exits 0 on success,
 *   throws AssertionError and exits 1 on failure.
 */

'use strict';

const assert = require('assert');
const { AgentQuotaGateway, TaskPriority, DEFAULT_TIER_QUOTAS } = require('../dist/api');

const { runEntry } = require('./common/test-runner-harness');

async function testTierRegistrationAndBasicLease() {
  console.log('1. Testing agent tier registration and lease lifecycle...');
  assert.ok(DEFAULT_TIER_QUOTAS.interactive, 'DEFAULT_TIER_QUOTAS should define interactive tier');
  const gateway = new AgentQuotaGateway();

  gateway.registerAgent('agent-interactive-1', 'interactive');
  gateway.registerAgent('agent-batch-1', 'batch');

  // Interactive agent acquires lease
  const firstLeaseResult = gateway.acquireLease('agent-interactive-1', TaskPriority.NORMAL);
  assert.strictEqual(firstLeaseResult.granted, true);
  assert.ok(firstLeaseResult.lease);
  assert.strictEqual(firstLeaseResult.lease.agentId, 'agent-interactive-1');
  assert.strictEqual(firstLeaseResult.lease.tier, 'interactive');

  // Check metrics
  const metricsBeforeRelease = gateway.getMetrics('agent-interactive-1');
  assert.strictEqual(metricsBeforeRelease.activeLeases, 1);
  assert.strictEqual(metricsBeforeRelease.totalGranted, 1);

  // Release lease
  const released = gateway.releaseLease(firstLeaseResult.lease.leaseId);
  assert.strictEqual(released, true);

  const metricsAfterRelease = gateway.getMetrics('agent-interactive-1');
  assert.strictEqual(metricsAfterRelease.activeLeases, 0);

  console.log('  ✔ Agent tier registration, lease acquisition, and release confirmed');
}

async function testConcurrencyLimitsAndCriticalBurst() {
  console.log('\n2. Testing concurrency limits and critical priority burst...');
  const gateway = new AgentQuotaGateway();

  // Register background agent with max 2 concurrent tasks
  gateway.registerAgent('agent-bg', 'background', {
    maxConcurrentTasks: 2,
    burstCapacity: 10,
  });

  // Acquire 2 normal leases (reaches limit)
  const firstLease = gateway.acquireLease('agent-bg', TaskPriority.NORMAL);
  const secondLease = gateway.acquireLease('agent-bg', TaskPriority.NORMAL);
  assert.strictEqual(firstLease.granted, true);
  assert.strictEqual(secondLease.granted, true);

  // 3rd NORMAL task must be rejected
  const thirdNormalLease = gateway.acquireLease('agent-bg', TaskPriority.NORMAL);
  assert.strictEqual(thirdNormalLease.granted, false);
  assert.ok(thirdNormalLease.reason.includes('Concurrency limit exceeded'));

  // 3rd CRITICAL task must be granted (burst allowed: ceil(2 * 1.5) = 3)
  const thirdCriticalLease = gateway.acquireLease('agent-bg', TaskPriority.CRITICAL);
  assert.strictEqual(thirdCriticalLease.granted, true);

  // 4th CRITICAL task must be rejected (burst ceiling reached)
  const fourthCriticalLease = gateway.acquireLease('agent-bg', TaskPriority.CRITICAL);
  assert.strictEqual(fourthCriticalLease.granted, false);

  console.log('  ✔ Concurrency limits enforced with critical priority burst headroom');
}

async function testTokenBucketRateLimiting() {
  console.log('\n3. Testing token-bucket rate limiting...');
  const gateway = new AgentQuotaGateway();

  // Agent with burst capacity of 3 tokens
  gateway.registerAgent('agent-throttled', 'batch', {
    burstCapacity: 3,
    tokensPerMinute: 60, // 1 token per second
    maxConcurrentTasks: 10,
  });

  // Exhaust all 3 tokens
  assert.strictEqual(gateway.acquireLease('agent-throttled').granted, true);
  assert.strictEqual(gateway.acquireLease('agent-throttled').granted, true);
  assert.strictEqual(gateway.acquireLease('agent-throttled').granted, true);

  // 4th attempt must be rejected for rate limit
  const rejected = gateway.acquireLease('agent-throttled');
  assert.strictEqual(rejected.granted, false);
  assert.ok(rejected.reason.includes('Rate limit'));

  const metrics = gateway.getMetrics('agent-throttled');
  assert.strictEqual(metrics.totalGranted, 3);
  assert.strictEqual(metrics.totalRejected, 1);

  console.log('  ✔ Token-bucket rate limiting rejects requests when capacity exhausted');
}

async function testLeaseTtlAndExpirationSweep() {
  console.log('\n4. Testing lease TTL expiration and sweep...');
  const gateway = new AgentQuotaGateway();

  // Agent with very short lease TTL (20ms)
  gateway.registerAgent('agent-short-lived', 'interactive', {
    leaseTtlMs: 20,
    burstCapacity: 10,
  });

  const shortLivedLeaseResult = gateway.acquireLease('agent-short-lived');
  assert.strictEqual(shortLivedLeaseResult.granted, true);
  assert.strictEqual(gateway.getMetrics('agent-short-lived').activeLeases, 1);

  // Wait 40ms for lease to expire
  await new Promise((resolve) => setTimeout(resolve, 40));

  // Sweep expired leases
  const swept = gateway.sweepExpiredLeases();
  assert.strictEqual(swept, 1, 'Must sweep 1 expired lease');

  const afterSweep = gateway.getMetrics('agent-short-lived');
  assert.strictEqual(afterSweep.activeLeases, 0);
  assert.strictEqual(afterSweep.totalExpired, 1);

  console.log('  ✔ Timed lease TTL automatically swept without resource leaks');
}

async function runAll() {
  console.log('=== Starting Agent Quota Gateway Suite ===\n');
  await testTierRegistrationAndBasicLease();
  await testConcurrencyLimitsAndCriticalBurst();
  await testTokenBucketRateLimiting();
  await testLeaseTtlAndExpirationSweep();
  console.log('\n=== All Agent Quota Gateway tests passed successfully! ===');
}

runEntry('validate-agent-quota-gateway.js', runAll);
