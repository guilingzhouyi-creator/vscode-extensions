#!/usr/bin/env node
/**
 * Module: Static Quality Gate — Memory Governor & Tiered Cache Eviction Verification
 * File Path: scripts/validate-memory-governor.js
 * Architecture Role: Verification test suite asserting memory pressure calculations,
 *   tiered cache sweeps, fault tolerance, and unregister lifecycle in MemoryGovernor.
 * Dependencies & Triggers: `npm test`; tests `dist/core/memory/memory-governor`.
 * Responsibilities:
 *   1. Assert ProcessMemoryStats shape and non-negative MB values;
 *   2. Assert multi-tier registration (Ephemeral, Intermediate, Durable);
 *   3. Assert selective tier sweep behavior and cachesCleared counts;
 *   4. Assert fail-soft isolation when a cache clear function throws;
 *   5. Assert unregister callback removes the cache cleanly.
 * Exit Semantics & Design Rationale: Exits 0 on success, non-zero on assertion failure.
 */
'use strict';

const assert = require('assert');
const path = require('path');

console.log('🚀 [MEMORY-GOVERNOR] Starting Memory Governor & Eviction Verification Harness...\n');

const {
    MemoryGovernor,
    CacheEvictionTier,
    sharedMemoryGovernor,
} = require('../dist/core/memory/memory-governor');

console.log('--- [1/5] Testing ProcessMemoryStats Telemetry ---');
const gov = new MemoryGovernor({
    softHeapLimitMb: 1024,
    hardHeapLimitMb: 2048,
});

const stats = gov.getMemoryStats();
assert.ok(stats.rssMb > 0, 'RSS memory must be positive');
assert.ok(stats.heapUsedMb > 0, 'Heap used memory must be positive');
assert.ok(stats.heapTotalMb >= stats.heapUsedMb, 'Heap total must be >= heap used');
assert.strictEqual(stats.pressure, 'nominal', 'Under 1024MB limit, pressure must be nominal');
console.log(`✔ Memory stats nominal: RSS=${stats.rssMb}MB, HeapUsed=${stats.heapUsedMb}MB, Pressure=${stats.pressure}`);

console.log('--- [2/5] Testing Multi-Tier Cache Registration & Selective Sweeping ---');
let ephemeralCleared = 0;
let intermediateCleared = 0;
let durableCleared = 0;

gov.register({
    name: 'test-ephemeral',
    tier: CacheEvictionTier.Ephemeral,
    clear: () => {
        ephemeralCleared++;
    },
    getSize: () => 10,
});

gov.register({
    name: 'test-intermediate',
    tier: CacheEvictionTier.Intermediate,
    clear: () => {
        intermediateCleared++;
    },
    getSize: () => 20,
});

gov.register({
    name: 'test-durable',
    tier: CacheEvictionTier.Durable,
    clear: () => {
        durableCleared++;
    },
    getSize: () => 30,
});

assert.strictEqual(gov.registeredCount, 3, 'Must track 3 registered caches');

// Sweep only Ephemeral
const sweep1 = gov.sweep(CacheEvictionTier.Ephemeral);
assert.strictEqual(sweep1.cachesCleared, 1, 'Only 1 ephemeral cache should be cleared');
assert.strictEqual(ephemeralCleared, 1);
assert.strictEqual(intermediateCleared, 0);
assert.strictEqual(durableCleared, 0);
console.log('✔ Ephemeral tier sweep verified.');

// Sweep Intermediate and Durable
const sweep2 = gov.sweep([CacheEvictionTier.Intermediate, CacheEvictionTier.Durable]);
assert.strictEqual(sweep2.cachesCleared, 2, '2 caches should be cleared');
assert.strictEqual(ephemeralCleared, 1);
assert.strictEqual(intermediateCleared, 1);
assert.strictEqual(durableCleared, 1);
console.log('✔ Intermediate and Durable tier sweep verified.');

console.log('--- [3/5] Testing Unregister Lifecycle ---');
const unreg = gov.register({
    name: 'transient-cache',
    tier: CacheEvictionTier.Ephemeral,
    clear: () => {
        throw new Error('Should not be called after unregister');
    },
});
assert.strictEqual(gov.registeredCount, 4);

unreg();
assert.strictEqual(gov.registeredCount, 3, 'Registered count must decrement after unregister');

// Sweeping all tiers must not invoke unregistered cache
const sweep3 = gov.sweep([
    CacheEvictionTier.Ephemeral,
    CacheEvictionTier.Intermediate,
    CacheEvictionTier.Durable,
]);
assert.strictEqual(sweep3.cachesCleared, 3);
console.log('✔ Unregister lifecycle verified.');

console.log('--- [4/5] Testing Fail-Soft Error Isolation ---');
gov.register({
    name: 'faulty-cache',
    tier: CacheEvictionTier.Ephemeral,
    clear: () => {
        throw new Error('Exploding cache evictor');
    },
});

let okCleared = 0;
gov.register({
    name: 'healthy-cache',
    tier: CacheEvictionTier.Ephemeral,
    clear: () => {
        okCleared++;
    },
});

assert.doesNotThrow(() => {
    gov.sweep(CacheEvictionTier.Ephemeral);
}, 'Governor sweep must not propagate unhandled errors from failing caches');
assert.ok(okCleared >= 1, 'Healthy cache must still execute even when another throws');
console.log('✔ Fail-soft isolation verified.');

console.log('--- [5/5] Testing Global sharedMemoryGovernor Integration ---');
assert.ok(sharedMemoryGovernor instanceof MemoryGovernor, 'sharedMemoryGovernor must be singleton');
const sharedStats = sharedMemoryGovernor.getMemoryStats();
assert.ok(sharedStats.heapUsedMb > 0);
console.log(`✔ sharedMemoryGovernor operational with ${sharedMemoryGovernor.registeredCount} active cache(s).`);

console.log('\n🎉 [MEMORY-GOVERNOR] All 5 Verification Suites Passed!');
process.exit(0);
