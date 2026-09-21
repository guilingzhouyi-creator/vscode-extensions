#!/usr/bin/env node
/**
 * Module: Verification Harness — Resource & Object Pooling Lifecycle Auditor
 * File Path: scripts/validate-resource-pooling-auditor.js
 * Architecture Role: Verification test suite asserting lifecycle and economic ROI pooling checks:
 *   PRF-POL-001 (unpooled hotspot allocation), PRF-POL-002 (unsound pool implementation),
 *   and PRF-POL-003 (negative-ROI excessive pooling of tiny objects).
 * Dependencies & Triggers: Consumes resource-pooling-auditor from dist/core/intelligence;
 *   invoked by test-parallel.js runner.
 * Responsibilities: Assert unpooled allocations in hot loops, lifecycle contracts
 *   (reset_state + capacity), micro-object negative-ROI penalties, and clean sound pool execution.
 * Exit Semantics & Design Rationale: Process exits 0 on all assertions passing, 1 on failure.
 */

'use strict';

const { evaluateResourcePooling } = require('../dist/core/intelligence/resource-pooling-auditor');

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

function testUnpooledHotspotAllocations() {
  console.log('--- 1. Testing Unpooled Hotspot Allocations (PRF-POL-001) ---');
  const sites = [
    {
      id: 'alloc-1',
      filePath: 'src/physics/collision.ts',
      functionName: 'solveCollisions',
      line: 45,
      isInLoopOrHotPath: true,
      allocatedType: 'ContactManifold',
      fieldCount: 16,
      isPrimitiveOrTiny: false,
      hasExpensiveConstructor: true,
      estimatedAllocFrequency: 'loop_hot',
    },
    {
      id: 'alloc-2',
      filePath: 'src/physics/math.ts',
      functionName: 'dotProduct',
      line: 12,
      isInLoopOrHotPath: true,
      allocatedType: 'Vector2',
      fieldCount: 2,
      isPrimitiveOrTiny: true,
      hasExpensiveConstructor: false,
      estimatedAllocFrequency: 'loop_hot',
    },
    {
      id: 'alloc-3',
      filePath: 'src/config/loader.ts',
      functionName: 'loadAppConfig',
      line: 80,
      isInLoopOrHotPath: false,
      allocatedType: 'FullSystemTopology',
      fieldCount: 30,
      isPrimitiveOrTiny: false,
      hasExpensiveConstructor: true,
      estimatedAllocFrequency: 'init_cold',
    },
  ];

  const result = evaluateResourcePooling(sites, []);
  assert(result.unpooledHotspots.length === 1, 'Identified exactly 1 unpooled hotspot allocation');
  assert(result.issues.length === 1, 'Emitted exactly 1 PRF-POL-001 issue');
  assert(result.issues[0].rule === 'PRF-POL-001', 'Issue rule matches PRF-POL-001');
  assert(
    result.issues[0].detail.allocatedType === 'ContactManifold',
    'Cites ContactManifold as hotspot type',
  );
}

function testUnsoundPoolImplementations() {
  console.log('--- 2. Testing Unsound Pool Implementations (PRF-POL-002) ---');
  const pools = [
    {
      id: 'pool-unsound',
      filePath: 'src/network/buffer_manager.ts',
      poolName: 'NetworkPacketPool',
      line: 25,
      poolKind: 'buffer_pool',
      poolScope: 'global_shared',
      targetType: 'PacketBuffer',
      targetIsTinyOrPrimitive: false,
      hasResetContract: false,
      hasCapacityCap: false,
      isGlobalWithoutRegistration: false,
    },
  ];

  const result = evaluateResourcePooling([], pools);
  assert(
    result.issues.length === 1,
    'Emitted PRF-POL-002 for unsound pool missing reset hook and capacity cap',
  );
  assert(result.issues[0].rule === 'PRF-POL-002', 'Issue rule matches PRF-POL-002');
  assert(result.issues[0].severity === 'error', 'Unsound pool issue severity is error');
  assert(result.issues[0].detail.hasResetContract === false, 'Records missing reset contract');
  assert(result.issues[0].detail.hasCapacityCap === false, 'Records missing capacity cap');
}

function testNegativeRoiExcessivePooling() {
  console.log('--- 3. Testing Negative-ROI Micro-Object Excessive Pooling (PRF-POL-003) ---');
  const pools = [
    {
      id: 'pool-micro',
      filePath: 'src/math/vector_pool.ts',
      poolName: 'Vector2Pool',
      line: 15,
      poolKind: 'object_pool',
      poolScope: 'global_shared',
      targetType: 'Vector2',
      targetIsTinyOrPrimitive: true,
      hasResetContract: true,
      hasCapacityCap: true,
      isGlobalWithoutRegistration: false,
    },
  ];

  const result = evaluateResourcePooling([], pools);
  assert(result.issues.length === 1, 'Emitted PRF-POL-003 for negative-ROI tiny object pooling');
  assert(result.issues[0].rule === 'PRF-POL-003', 'Issue rule matches PRF-POL-003');
  assert(result.issues[0].severity === 'warning', 'Negative-ROI issue severity is warning');
  assert(
    result.issues[0].detail.targetType === 'Vector2',
    'Cites Vector2 as the tiny object penalized',
  );
}

function testSoundResourcePools() {
  console.log('--- 4. Testing Sound & Economic Resource Pool Pass ---');
  const soundPools = [
    {
      id: 'pool-sound',
      filePath: 'src/db/connection_pool.ts',
      poolName: 'DatabaseConnectionPool',
      line: 30,
      poolKind: 'connection_pool',
      poolScope: 'global_shared',
      targetType: 'DbConnection',
      targetIsTinyOrPrimitive: false,
      hasResetContract: true,
      hasCapacityCap: true,
      isGlobalWithoutRegistration: false,
    },
    {
      id: 'pool-sound-obj',
      filePath: 'src/gameplay/actor_pool.ts',
      poolName: 'ActorInstancePool',
      line: 40,
      poolKind: 'object_pool',
      poolScope: 'local_private',
      targetType: 'ActorEntity',
      targetIsTinyOrPrimitive: false,
      hasResetContract: true,
      hasCapacityCap: true,
      isGlobalWithoutRegistration: false,
    },
  ];

  const result = evaluateResourcePooling([], soundPools);
  assert(
    result.issues.length === 0,
    'Sound pools with reset hooks and capacity caps pass with 0 issues',
  );
}

function runTests() {
  testUnpooledHotspotAllocations();
  testUnsoundPoolImplementations();
  testNegativeRoiExcessivePooling();
  testSoundResourcePools();
  console.log(`\nResults: ${passedCount}/${totalCount} assertions passed.`);
}

runTests();
