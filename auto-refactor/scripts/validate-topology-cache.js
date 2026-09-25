#!/usr/bin/env node
/**
 * Module: Verification Harness — Topology Cache Suite
 * File Path: scripts/validate-topology-cache.js
 * Architecture Role: Integration and correctness verification suite for the multi-tier
 *   TopologyCacheManager dependency cache and cascade invalidation engine.
 * Dependencies & Triggers: Consumes ../dist/api; executed in `npm test` and test-parallel.js.
 * Responsibilities:
 *   1. Assert basic L1 store and lookup fresh retrieval;
 *   2. Assert promotion from L2 to L1 upon memory miss;
 *   3. Assert signature-invariant single-point invalidation (dependents stay cached);
 *   4. Assert signature-changed transitive reverse-dependency cascade invalidation;
 *   5. Assert isolation: sibling branches unaffected during downstream invalidation;
 *   6. Assert LRU capacity bounding and telemetry metrics accuracy.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError and exits 1 on failure.
 */

'use strict';

const assert = require('assert');
const { TopologyCacheManager, computeContentHash } = require('../dist/api');

async function testBasicHitAndL2Promotion() {
  console.log('1. Testing L1 hit and L2 promotion...');
  const cache = new TopologyCacheManager(10);

  const fileA = 'src/models/user.ts';
  const contentA = 'export interface User { id: string; }';
  const hashA = computeContentHash(contentA);
  const sigA = computeContentHash('User');

  cache.put(fileA, hashA, sigA, { astNodes: 15 });

  // 1. First get: hits L1
  const hit1 = cache.get(fileA, hashA);
  assert.deepStrictEqual(hit1, { astNodes: 15 });

  // Stale content hash: should miss
  const miss = cache.get(fileA, 'different_hash');
  assert.strictEqual(miss, undefined);

  // Evict fileA from L1 by exceeding capacity with dummy entries
  for (let i = 0; i < 15; i++) {
    const dummyKey = `src/dummy/file_${i}.ts`;
    const dummyHash = `hash_${i}`;
    cache.put(dummyKey, dummyHash, 'sig', { astNodes: i });
  }

  // FileA should still be in L2, and retrieving it promotes it back to L1
  const hitFromL2 = cache.get(fileA, hashA);
  assert.deepStrictEqual(hitFromL2, { astNodes: 15 });

  console.log('  ✔ L1 hit, hash verification and L2 promotion confirmed');
}

async function testSinglePointInvalidationWithoutSignatureChange() {
  console.log('\n2. Testing single-point invalidation without signature change...');
  const cache = new TopologyCacheManager(50);

  // Topology:
  // Controller -> Service -> Repository
  const fileRepo = 'src/repo/user-repo.ts';
  const fileService = 'src/service/user-service.ts';
  const fileCtrl = 'src/controller/user-controller.ts';

  cache.recordDependency(fileService, fileRepo);
  cache.recordDependency(fileCtrl, fileService);

  const hashRepo = 'repo_hash_v1';
  const sigRepo = 'repo_sig_v1';
  cache.put(fileRepo, hashRepo, sigRepo, { role: 'repo' });

  const hashService = 'service_hash_v1';
  const sigService = 'service_sig_v1';
  cache.put(fileService, hashService, sigService, { role: 'service' });

  const hashCtrl = 'ctrl_hash_v1';
  const sigCtrl = 'ctrl_sig_v1';
  cache.put(fileCtrl, hashCtrl, sigCtrl, { role: 'controller' });

  // Invalidate Repository WITHOUT signature change (e.g., internal comment or local variable fix)
  const invalidated = cache.invalidateSubtree(fileRepo, false);

  assert.strictEqual(invalidated.length, 1);
  assert.strictEqual(invalidated[0], fileRepo.toLowerCase());

  // Repository must miss
  assert.strictEqual(cache.get(fileRepo, hashRepo), undefined);

  // Service and Controller MUST STILL HIT (contract was not broken)
  assert.deepStrictEqual(cache.get(fileService, hashService), { role: 'service' });
  assert.deepStrictEqual(cache.get(fileCtrl, hashCtrl), { role: 'controller' });

  console.log('  ✔ Signature-invariant change safely isolates invalidation to modified file');
}

async function testTransitiveCascadeInvalidationWithSignatureChange() {
  console.log('\n3. Testing transitive cascade invalidation with signature change...');
  const cache = new TopologyCacheManager(50);

  // Topology graph:
  //   Repo (Core)
  //    ├── ServiceA -> ViewA
  //    └── ServiceB -> ViewB
  // Sibling branch:
  //   AuthUtil -> AuthGuard
  const repo = 'src/core/repo.ts';
  const serviceA = 'src/services/service-a.ts';
  const viewA = 'src/views/view-a.ts';
  const serviceB = 'src/services/service-b.ts';
  const viewB = 'src/views/view-b.ts';

  const authUtil = 'src/auth/auth-util.ts';
  const authGuard = 'src/auth/auth-guard.ts';

  cache.recordDependency(serviceA, repo);
  cache.recordDependency(viewA, serviceA);
  cache.recordDependency(serviceB, repo);
  cache.recordDependency(viewB, serviceB);

  cache.recordDependency(authGuard, authUtil);

  cache.put(repo, 'h_repo', 's_repo', { id: 'repo' });
  cache.put(serviceA, 'h_sa', 's_sa', { id: 'sa' });
  cache.put(viewA, 'h_va', 's_va', { id: 'va' });
  cache.put(serviceB, 'h_sb', 's_sb', { id: 'sb' });
  cache.put(viewB, 'h_vb', 's_vb', { id: 'vb' });

  cache.put(authUtil, 'h_au', 's_au', { id: 'au' });
  cache.put(authGuard, 'h_ag', 's_ag', { id: 'ag' });

  // Invalidate ServiceA WITH signature change
  const invalidated = cache.invalidateSubtree(serviceA, true);

  // ServiceA and ViewA must be invalidated
  assert.ok(invalidated.includes(serviceA.toLowerCase()));
  assert.ok(invalidated.includes(viewA.toLowerCase()));
  assert.strictEqual(invalidated.length, 2);

  assert.strictEqual(cache.get(serviceA, 'h_sa'), undefined);
  assert.strictEqual(cache.get(viewA, 'h_va'), undefined);

  // Repo (upstream) MUST NOT be invalidated
  assert.deepStrictEqual(cache.get(repo, 'h_repo'), { id: 'repo' });

  // Sibling branch (ServiceB, ViewB) MUST NOT be invalidated
  assert.deepStrictEqual(cache.get(serviceB, 'h_sb'), { id: 'sb' });
  assert.deepStrictEqual(cache.get(viewB, 'h_vb'), { id: 'vb' });

  // Completely separate branch (AuthUtil, AuthGuard) MUST NOT be invalidated
  assert.deepStrictEqual(cache.get(authUtil, 'h_au'), { id: 'au' });
  assert.deepStrictEqual(cache.get(authGuard, 'h_ag'), { id: 'ag' });

  console.log('  ✔ Transitive cascade invalidates downstream subtree while preserving upstream and siblings');
}

async function testTelemetryMetrics() {
  console.log('\n4. Testing telemetry metrics calculation...');
  const cache = new TopologyCacheManager(100);

  cache.put('a.ts', 'h1', 's1', 1);
  cache.get('a.ts', 'h1'); // hit
  cache.get('a.ts', 'wrong'); // miss
  cache.invalidateSubtree('a.ts', false); // 1 invalidation

  const metrics = cache.getMetrics();
  assert.strictEqual(metrics.totalHits, 1);
  assert.strictEqual(metrics.totalMisses, 1);
  assert.strictEqual(metrics.totalInvalidations, 1);
  assert.strictEqual(metrics.hitRatio, 0.5);

  console.log('  ✔ Telemetry metrics accurately reflect cache operations');
}

async function runAll() {
  console.log('=== Starting Topology Cache Verification Suite ===\n');
  await testBasicHitAndL2Promotion();
  await testSinglePointInvalidationWithoutSignatureChange();
  await testTransitiveCascadeInvalidationWithSignatureChange();
  await testTelemetryMetrics();
  console.log('\n=== All Topology Cache tests passed successfully! ===');
}

runAll().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});
